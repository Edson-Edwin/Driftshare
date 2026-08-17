(() => {
  const CHUNK_SIZE = 256 * 1024; // 256KB per frame — good balance for LAN throughput
  const HIGH_WATER_MARK = 8 * 1024 * 1024; // pause sending if socket buffer exceeds this

  const $ = (sel) => document.querySelector(sel);
  const peerListEl = $('#peerList');
  const peerCountEl = $('#peerCount');
  const meNameEl = $('#meName');
  const targetLabelEl = $('#targetLabel');
  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const transferListEl = $('#transferList');
  const toastsEl = $('#toasts');
  const offerModal = $('#offerModal');
  const offerTitle = $('#offerTitle');
  const offerMeta = $('#offerMeta');

  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const deviceType = isMobile ? 'mobile' : 'desktop';

  function defaultName() {
    const adjectives = ['Swift', 'Quiet', 'Amber', 'Copper', 'North', 'Lunar', 'Ember', 'Slate'];
    const noun = isMobile ? 'Phone' : 'Laptop';
    const a = adjectives[Math.floor(Math.random() * adjectives.length)];
    return `${a} ${noun}`;
  }

  let myName = localStorage.getItem('driftshare-name') || defaultName();
  let myId = null;
  let peers = [];
  let selectedPeerId = null;

  const transfers = new Map(); // transferId -> transfer state object
  const sendQueue = []; // { file, targetId }
  let sending = false;
  let incoming = null; // active receive state
  const offerQueue = [];

  meNameEl.textContent = myName;

  // ---------------- WebSocket ----------------
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    send({ type: 'hello', name: myName, deviceType });
  });

  ws.addEventListener('close', () => {
    toast('Disconnected from network. Reload to reconnect.', true);
  });

  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      handleBinaryChunk(event.data);
      return;
    }
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  });

  function send(obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        myId = msg.id;
        break;
      case 'peers':
        peers = msg.peers;
        renderPeers();
        break;
      case 'file-offer':
        offerQueue.push(msg);
        maybeShowNextOffer();
        break;
      case 'file-accept':
        onFileAccept(msg);
        break;
      case 'file-reject':
        onFileRejected(msg);
        break;
      case 'file-busy':
        onFileBusy(msg);
        break;
      case 'file-error':
        onFileError(msg);
        break;
      case 'file-end':
        onFileEndReceived(msg);
        break;
      case 'file-received':
        onFileReceivedAck(msg);
        break;
      case 'file-cancel':
        onFileCancelled(msg);
        break;
    }
  }

  // ---------------- Peer list ----------------
  function renderPeers() {
    peerCountEl.textContent = String(peers.length);
    if (peers.length === 0) {
      peerListEl.innerHTML = '<p class="empty-state">No other devices found yet. Open this page on another device connected to the same Wi-Fi.</p>';
      return;
    }
    peerListEl.innerHTML = '';
    for (const p of peers) {
      const card = document.createElement('div');
      card.className = 'peer-card' + (p.id === selectedPeerId ? ' selected' : '');
      card.dataset.id = p.id;
      card.innerHTML = `
        <div class="peer-icon">${p.deviceType === 'mobile' ? '📱' : '💻'}</div>
        <div class="peer-info">
          <div class="peer-name">${escapeHtml(p.name)}</div>
          <div class="peer-sub">${p.id}</div>
        </div>
        <span class="peer-badge">target</span>
      `;
      card.addEventListener('click', () => selectPeer(p.id));
      peerListEl.appendChild(card);
    }
  }

  function selectPeer(id) {
    selectedPeerId = id;
    renderPeers();
    const p = peers.find((x) => x.id === id);
    targetLabelEl.textContent = p ? `sending to ${p.name}` : 'select a device →';
  }

  // ---------------- Rename ----------------
  $('#renameBtn').addEventListener('click', () => {
    const next = prompt('Device name', myName);
    if (next && next.trim()) {
      myName = next.trim().slice(0, 40);
      localStorage.setItem('driftshare-name', myName);
      meNameEl.textContent = myName;
      send({ type: 'rename', name: myName });
    }
  });

  // ---------------- Drag & drop / file picking ----------------
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    queueFiles(files);
  });
  fileInput.addEventListener('change', () => {
    queueFiles([...fileInput.files]);
    fileInput.value = '';
  });

  function queueFiles(files) {
    if (!files.length) return;
    if (!selectedPeerId) {
      toast('Select a device on the left first.', true);
      return;
    }
    for (const file of files) {
      sendQueue.push({ file, targetId: selectedPeerId });
    }
    pumpSendQueue();
  }

  // ---------------- Sending ----------------
  function pumpSendQueue() {
    if (sending || sendQueue.length === 0) return;
    sending = true;
    const { file, targetId } = sendQueue.shift();
    startSend(file, targetId);
  }

  function startSend(file, targetId) {
    const transferId = randomId();
    const peer = peers.find((p) => p.id === targetId);
    const t = {
      id: transferId,
      direction: 'out',
      name: file.name,
      size: file.size,
      peerName: peer ? peer.name : targetId,
      status: 'offering',
      bytesDone: 0,
      file,
      targetId,
    };
    transfers.set(transferId, t);
    renderTransfer(t);

    send({
      type: 'file-offer',
      targetId,
      transferId,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    });
  }

  async function onFileAccept(msg) {
    const t = transfers.get(msg.transferId);
    if (!t) return;
    t.status = 'sending';
    updateTransfer(t);

    const file = t.file;
    let offset = 0;

    while (offset < file.size) {
      // Backpressure: don't let the socket buffer balloon.
      while (ws.bufferedAmount > HIGH_WATER_MARK) {
        await sleep(20);
      }
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buf = await slice.arrayBuffer();
      ws.send(buf);
      offset += buf.byteLength;
      t.bytesDone = offset;
      updateTransfer(t);
    }

    send({ type: 'file-end', targetId: t.targetId, transferId: t.id });
    t.status = 'verifying';
    updateTransfer(t);
  }

  function onFileRejected(msg) {
    const t = transfers.get(msg.transferId);
    if (!t) return;
    t.status = 'rejected';
    updateTransfer(t);
    toast(`${t.peerName} declined "${t.name}".`, true);
    sending = false;
    pumpSendQueue();
  }

  function onFileBusy(msg) {
    const t = transfers.get(msg.transferId);
    if (!t) return;
    t.status = 'busy';
    updateTransfer(t);
    toast(`${t.peerName} is mid-transfer — try again shortly.`, true);
    sending = false;
    pumpSendQueue();
  }

  function onFileError(msg) {
    const t = transfers.get(msg.transferId);
    if (!t) return;
    t.status = 'error';
    updateTransfer(t);
    toast(msg.reason || 'Transfer failed.', true);
    sending = false;
    pumpSendQueue();
  }

  function onFileReceivedAck(msg) {
    const t = transfers.get(msg.transferId);
    if (!t) return;
    t.status = 'done';
    updateTransfer(t);
    sending = false;
    pumpSendQueue();
  }

  function onFileCancelled(msg) {
    const t = transfers.get(msg.transferId);
    if (t) {
      t.status = 'cancelled';
      updateTransfer(t);
    }
    if (incoming && incoming.transferId === msg.transferId) incoming = null;
    sending = false;
    pumpSendQueue();
  }

  // ---------------- Receiving ----------------
  function maybeShowNextOffer() {
    if (offerModal.classList.contains('hidden') === false) return; // already showing one
    const next = offerQueue.shift();
    if (!next) return;
    showOffer(next);
  }

  function showOffer(offer) {
    offerTitle.textContent = offer.name;
    offerMeta.textContent = `from ${offer.fromName} · ${formatBytes(offer.size)}`;
    offerModal.classList.remove('hidden');

    const onAccept = () => {
      cleanup();
      incoming = {
        transferId: offer.transferId,
        fromId: offer.fromId,
        fromName: offer.fromName,
        name: offer.name,
        size: offer.size,
        mime: offer.mime,
        chunks: [],
        bytesDone: 0,
      };
      send({ type: 'file-accept', targetId: offer.fromId, transferId: offer.transferId });

      const t = {
        id: offer.transferId,
        direction: 'in',
        name: offer.name,
        size: offer.size,
        peerName: offer.fromName,
        status: 'receiving',
        bytesDone: 0,
      };
      transfers.set(offer.transferId, t);
      renderTransfer(t);
    };

    const onReject = () => {
      cleanup();
      send({ type: 'file-reject', targetId: offer.fromId, transferId: offer.transferId });
    };

    function cleanup() {
      offerModal.classList.add('hidden');
      $('#offerAccept').removeEventListener('click', onAccept);
      $('#offerReject').removeEventListener('click', onReject);
      setTimeout(maybeShowNextOffer, 150);
    }

    $('#offerAccept').addEventListener('click', onAccept, { once: true });
    $('#offerReject').addEventListener('click', onReject, { once: true });
  }

  function handleBinaryChunk(buf) {
    if (!incoming) return;
    incoming.chunks.push(buf);
    incoming.bytesDone += buf.byteLength;
    const t = transfers.get(incoming.transferId);
    if (t) {
      t.bytesDone = incoming.bytesDone;
      updateTransfer(t);
    }
  }

  function onFileEndReceived(msg) {
    if (!incoming || incoming.transferId !== msg.transferId) return;
    const t = transfers.get(incoming.transferId);

    try {
      const blob = new Blob(incoming.chunks, { type: incoming.mime || 'application/octet-stream' });
      if (blob.size !== incoming.size) {
        // Bytes we actually received don't match what the sender promised —
        // don't hand the user a corrupt/truncated file silently.
        throw new Error(`Received ${formatBytes(blob.size)}, expected ${formatBytes(incoming.size)}.`);
      }
      if (t) {
        t.status = 'done';
        t.blob = blob; // keep the Blob itself; object URL is created fresh at click time
        updateTransfer(t);
      }
    } catch (err) {
      if (t) {
        t.status = 'error';
        updateTransfer(t);
      }
      toast(`Couldn't finish "${incoming.name}": ${err.message}`, true);
    }

    send({ type: 'file-received', targetId: incoming.fromId, transferId: incoming.transferId });
    incoming = null;
  }

  // Delegated click handler: creates the object URL and triggers the download
  // at the moment of the real user click, then revokes it. This is the
  // reliable pattern for blob downloads — a static href baked into innerHTML
  // ahead of time is what was causing "failed to download" for some files.
  transferListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-download-id]');
    if (!btn) return;
    const t = transfers.get(btn.dataset.downloadId);
    if (!t || !t.blob) return;

    try {
      const url = URL.createObjectURL(t.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = t.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      toast(`Download failed: ${err.message}`, true);
    }
  });

  // ---------------- Transfer list UI ----------------
  function renderTransfer(t) {
    if (transferListEl.querySelector('.empty-state')) transferListEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'transfer-card';
    card.id = `t-${t.id}`;
    transferListEl.prepend(card);
    updateTransfer(t);
  }

  const STATUS_LABEL = {
    offering: 'waiting for accept…',
    sending: 'sending',
    receiving: 'receiving',
    verifying: 'finishing…',
    done: 'complete',
    rejected: 'declined',
    busy: 'device busy',
    error: 'failed',
    cancelled: 'cancelled',
  };

  function updateTransfer(t) {
    const card = document.getElementById(`t-${t.id}`);
    if (!card) return;
    const pct = t.size ? Math.min(100, Math.round((t.bytesDone / t.size) * 100)) : 0;
    const arrow = t.direction === 'out' ? '→' : '←';
    const barClass = t.status === 'done' ? 'done' : ['rejected', 'error', 'cancelled', 'busy'].includes(t.status) ? 'error' : '';

    card.innerHTML = `
      <div class="transfer-row">
        <span class="transfer-name">${arrow} ${escapeHtml(t.name)}</span>
        <span class="transfer-stat">${formatBytes(t.bytesDone)} / ${formatBytes(t.size)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${barClass}" style="width:${pct}%"></div></div>
      <div class="transfer-footer">
        <span>${t.direction === 'out' ? 'to' : 'from'} ${escapeHtml(t.peerName)} · ${STATUS_LABEL[t.status] || t.status}</span>
        ${t.blob ? `<button type="button" class="link-btn" data-download-id="${t.id}">save file</button>` : ''}
      </div>
    `;
  }

  // ---------------- Utils ----------------
  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  function formatBytes(n) {
    if (!n && n !== 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
})();
