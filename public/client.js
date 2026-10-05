(() => {
  'use strict';
  const P = window.DriftProtocol;
  const $ = selector => document.querySelector(selector);
  const transfers = new Map(), sessions = new Map(), incoming = new Map();
  const queue = [], offers = [];
  const selectedPeerIds = new Set(), activeRecipients = new Set();
  const MAX_OUTGOING = 4;
  let peers = [], myId = null;
  let reconnectToken = '';
  let ws, reconnectTimer, reconnectAttempt = 0, authenticated = false;
  let currentOffer = null, joinUrls = [], qrObjectUrl = null, reservedMemory = 0;
  const stored = (key, fallback = '') => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const deviceLabel = P.deviceLabel(navigator.userAgent, navigator.userAgentData?.platform || navigator.platform, navigator.maxTouchPoints);
  let myName = stored('driftshare-name');
  if (!myName || /^(this device|unknown device)$/i.test(myName.trim())) {
    myName = `${deviceLabel} · ${String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0')}`;
    try { localStorage.setItem('driftshare-name', myName); } catch { /* still identifiable for this session */ }
  }
  let accessCode = new URLSearchParams(location.hash.slice(1)).get('code') || '';
  try {
    if (accessCode) sessionStorage.setItem('driftshare-code', accessCode);
    else accessCode = sessionStorage.getItem('driftshare-code') || '';
  } catch { /* private browsing may disable storage */ }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const deviceType = /phone|tablet|iPad/i.test(deviceLabel) ? 'mobile' : 'desktop';
  const canRtc = typeof window.RTCPeerConnection === 'function';
  const canSaveDirectly = window.isSecureContext && typeof window.showSaveFilePicker === 'function';
  $('#meName').textContent = myName;
  $('#saveDirectly').checked = canSaveDirectly;
  $('#saveDirectly').disabled = !canSaveDirectly;
  function needsRelay() { return !canRtc || currentOffer?.rtcAvailable === false || $('#useRelay').checked; }
  function updateStorageNote() {
    const required = !canRtc || currentOffer?.rtcAvailable === false;
    $('#useRelay').disabled = required;
    $('#saveDirectly').disabled = !canSaveDirectly || needsRelay();
    const large = currentOffer && reservedMemory + currentOffer.size > P.MAX_MEMORY;
    $('#storageNote').textContent = needsRelay() || (large && !(canSaveDirectly && $('#saveDirectly').checked)) ?
      'Up to 5 GB. This file will stream through your LAN host into the browser’s Downloads. If it does not start, tap “start download”.' :
      canSaveDirectly && $('#saveDirectly').checked ? 'Up to 5 GB. Save directly to your device over WebRTC.' :
      'Up to 5 GB per file. Small files use direct WebRTC; large files stream through your LAN host into Downloads.';
  }
  $('#saveDirectly').addEventListener('change', updateStorageNote);
  $('#useRelay').addEventListener('change', updateStorageNote);
  updateStorageNote();

  // A wake lock is best-effort and never makes background transfers dependable.
  let wakeLock = null, wakePending = false, wakeAttempted = false;
  const hasActiveTransfers = () => [...transfers.values()].some(t => !P.terminal(t.status) && !['queued', 'paused'].includes(t.status));
  function updateWakeLock() {
    const active = hasActiveTransfers();
    $('#activityNote').textContent = active && wakeLock ? 'Keeping the screen awake. Keep this tab open until transfers finish.' :
      active ? 'Keep this tab visible and your device awake until transfers finish.' : 'Works through a modern browser. Keep both devices on the same network.';
    if (!active || document.visibilityState !== 'visible') {
      if (!active) wakeAttempted = false;
      const previous = wakeLock; wakeLock = null; previous?.release().catch(() => {});
      return;
    }
    if (!navigator.wakeLock?.request || wakeLock || wakePending || wakeAttempted) return;
    wakePending = true; wakeAttempted = true;
    navigator.wakeLock.request('screen').then(async lock => {
      if (!hasActiveTransfers() || document.visibilityState !== 'visible') { await lock.release(); return; }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) { wakeLock = null; updateWakeLock(); } });
      updateWakeLock();
    }).catch(() => { /* Power saving or browser policy may deny the request. */ }).finally(() => { wakePending = false; });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakeAttempted = false;
    updateWakeLock();
  });

  function id() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function send(message) {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message)); return true;
  }
  function setConnection(state) {
    const labels = { connected: 'Connected', connecting: 'Connecting', offline: 'Disconnected', locked: 'Join link required' };
    $('#connectionStatus').className = `connection connection--${state}`;
    $('#connectionStatus').querySelector('span:last-child').textContent = labels[state];
  }
  function connect() {
    clearTimeout(reconnectTimer);
    if (ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState)) return;
    setConnection('connecting');
    const socket = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    socket.addEventListener('open', () => send({ type: 'hello', name: myName, deviceType, rtcAvailable: canRtc, reconnectToken, code: accessCode }));
    socket.addEventListener('message', event => {
      if (ws !== socket || typeof event.data !== 'string') return;
      try { handleMessage(JSON.parse(event.data)); } catch { toast('An invalid control message was ignored.', true); }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', event => {
      if (ws !== socket) return;
      authenticated = false; myId = null; peers = []; selectedPeerIds.clear();
      // Fail the entire queue before cleanup can start another transfer.
      queue.length = 0;
      for (const t of transfers.values()) if (!P.terminal(t.status)) {
        if (t.resumable) pauseRelay(t);
        else finish(t, 'error', 'Connection lost. Reconnect, choose a device, and retry.', false);
      }
      for (const session of [...sessions.values()]) closeSession(session);
      offers.length = 0; dismissOffer(); renderPeers(); setConnection('offline');
      if (event.code !== 1008) reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** reconnectAttempt++, 10000));
      else { setConnection('locked'); openModal($('#authModal')); }
    });
  }
  window.addEventListener('online', connect);
  $('#reconnectBtn').addEventListener('click', connect);
  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'auth-required') {
      setConnection('locked'); openModal($('#authModal'));
      if (msg.retryAfter) toast('Too many incorrect codes. Try again in one minute.', true);
      else if (accessCode) toast('Incorrect join code. Use the current 4-digit code from the host.', true);
      return;
    }
    if (msg.type === 'welcome') {
      if (reconnectToken && msg.reconnectToken && msg.reconnectToken !== reconnectToken) {
        for (const pending of transfers.values()) if (pending.resumable && !P.terminal(pending.status)) finish(pending, 'error', 'Resume session expired or host restarted. Send this file again.', false);
      }
      myId = msg.id; reconnectToken = msg.reconnectToken || reconnectToken; authenticated = true; reconnectAttempt = 0; joinUrls = msg.joinUrls || [];
      closeModal($('#authModal')); setConnection('connected'); pumpQueue(); return;
    }
    if (msg.type === 'peers') {
      peers = msg.peers;
      for (const peerId of selectedPeerIds) if (!peers.some(p => p.id === peerId)) selectedPeerIds.delete(peerId);
      renderPeers(); return;
    }
    if (!P.validId(msg.transferId)) return;
    const t = transfers.get(msg.transferId);
    switch (msg.type) {
      case 'file-offer':
        if (!P.validOffer({ ...msg, targetId: myId }) || !P.validId(msg.fromId) || incoming.has(msg.transferId) ||
            currentOffer?.transferId === msg.transferId || offers.some(o => o.transferId === msg.transferId)) return;
        offers.push(msg); showNextOffer(); break;
      case 'file-accept':
        if (t && (t.status === 'offering' || (t.resumable && !P.terminal(t.status) && msg.transport === 'relay'))) {
          (msg.transport === 'relay' ? uploadRelay(t, msg.uploadToken, msg.offset || 0, msg.resumable) : startRtc(t)).catch(error => {
            if (t.resumable && error.name !== 'AbortError') pauseRelay(t); else if (!t.resumable) finish(t, 'error', error.message);
          });
        }
        break;
      case 'relay-ready':
        if (t?.direction === 'in' && t.relay && typeof msg.downloadUrl === 'string' &&
            new RegExp(`^/relay/${t.id}\\?token=[a-f0-9]{64}$`).test(msg.downloadUrl)) {
          t.resumable = msg.resumable === true; t.downloadUrl = msg.downloadUrl; t.lastActivity = performance.now(); updateTransfer(t); startRelayDownload(t);
        }
        break;
      case 'relay-progress':
        if (t && !P.terminal(t.status) && Number.isSafeInteger(msg.bytes) && (msg.resumed || msg.bytes >= t.bytesDone) && msg.bytes <= t.size) {
          if (msg.resumed && msg.bytes > 0) t.resumedFrom = msg.bytes;
          t.reason = ''; t.relay = true; t.route = 'via LAN host'; t.lastActivity = performance.now();
          t.startedAt ||= t.lastActivity; t.sampleAt ||= t.lastActivity; t.sampleBytes ||= 0;
          if (t.direction === 'in') { t.downloadStarted = true; t.status = 'receiving'; }
          progress(t, msg.bytes);
        }
        break;
      case 'relay-paused': if (t && !P.terminal(t.status)) pauseRelay(t); break;
      case 'relay-complete':
        if (t?.relay) { progress(t, t.size); finish(t, 'done', 'Sent to browser Downloads. Check the download there to confirm it saved.', false); }
        break;
      case 'rtc-signal': handleSignal(msg).catch(error => { if (t) finish(t, 'error', error.message); }); break;
      case 'file-received':
        // The data-channel acknowledgment includes the checksum and is authoritative.
        break;
      case 'file-reject': if (t) finish(t, 'rejected', 'The recipient declined.', false); removeOffer(msg.transferId); break;
      case 'file-error': if (t) finish(t, 'error', msg.reason || 'Transfer failed.', false); removeOffer(msg.transferId); break;
      case 'file-cancel': if (t) finish(t, 'cancelled', 'Cancelled by the other device.', false); removeOffer(msg.transferId); break;
    }
  }
  $('#authForm').addEventListener('submit', event => {
    event.preventDefault();
    const value = $('#accessCode').value.trim();
    if (!/^\d{4}$/.test(value)) { toast('Enter the 4-digit join code.', true); return; }
    accessCode = value;
    try { sessionStorage.setItem('driftshare-code', accessCode); } catch { /* optional */ }
    if (ws?.readyState === WebSocket.OPEN) send({ type: 'hello', name: myName, deviceType, rtcAvailable: canRtc, reconnectToken, code: accessCode });
    else connect();
  });
  function renderPeers() {
    $('#peerCount').textContent = peers.length;
    const list = $('#peerList'); list.replaceChildren();
    if (!peers.length) { const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = 'Open the private join link on another device on this Wi-Fi.'; list.append(p); }
    for (const peer of peers) {
      const card = document.createElement('button'); card.type = 'button';
      card.className = 'peer-card' + (selectedPeerIds.has(peer.id) ? ' selected' : '');
      card.setAttribute('aria-pressed', String(selectedPeerIds.has(peer.id)));
      card.innerHTML = `<span class="peer-icon">${peer.deviceType === 'mobile' ? '📱' : '💻'}</span><span class="peer-info"><span class="peer-name">${escapeHtml(peer.name)}</span><span class="peer-sub">${peer.deviceType === 'mobile' ? 'Phone or tablet' : 'Computer'} · ${escapeHtml(peer.id.slice(0, 8))}</span></span><span class="peer-badge">✓</span>`;
      card.addEventListener('click', () => {
        if (selectedPeerIds.has(peer.id)) selectedPeerIds.delete(peer.id); else selectedPeerIds.add(peer.id);
        renderPeers();
      }); list.append(card);
    }
    const selected = peers.filter(peer => selectedPeerIds.has(peer.id));
    $('#targetLabel').textContent = selected.length > 1 ? `Sending to ${selected.length} devices` : selected.length ? `Sending to ${selected[0].name}` : 'Choose devices';
  }
  $('#renameBtn').addEventListener('click', () => {
    const value = prompt('Device name', myName)?.trim();
    if (!value) return; myName = value.slice(0, 40);
    try { localStorage.setItem('driftshare-name', myName); } catch { /* optional */ }
    $('#meName').textContent = myName; send({ type: 'rename', name: myName });
  });
  async function updateJoin() {
    const address = Number($('#joinAddress').value || 0);
    $('#joinUrl').textContent = joinUrls[address] || '';
    $('#joinQr').hidden = true; $('#qrNote').textContent = 'Creating QR code…';
    try {
      const response = await fetch(`/join-qr.svg?address=${address}`, { headers: { Authorization: `Bearer ${accessCode}` } });
      if (!response.ok) throw new Error('QR unavailable. Copy the private link below.');
      const blob = await response.blob();
      if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
      qrObjectUrl = URL.createObjectURL(blob); $('#joinQr').src = qrObjectUrl;
      $('#joinQr').hidden = false; $('#qrNote').textContent = 'Share only with devices you trust.';
    } catch (error) { $('#qrNote').textContent = error.message; }
  }
  $('#joinBtn').addEventListener('click', () => {
    if (!authenticated) { openModal($('#authModal')); return; }
    $('#joinCode').textContent = accessCode;
    $('#joinAddress').replaceChildren(...joinUrls.map((url, index) => {
      const option = document.createElement('option'); option.value = index; option.textContent = new URL(url).host; return option;
    }));
    openModal($('#joinModal')); updateJoin();
  });
  $('#joinAddress').addEventListener('change', updateJoin);
  $('#copyJoin').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#joinUrl').textContent); toast('Private join link copied.'); }
    catch { const range = document.createRange(); range.selectNodeContents($('#joinUrl')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Link selected. Use your device’s Copy command.'); }
  });
  $('#joinClose').addEventListener('click', () => closeModal($('#joinModal')));

  const dropzone = $('#dropzone');
  for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('drag-over'); });
  for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('drag-over'); });
  dropzone.addEventListener('drop', event => prepareFiles([...(event.dataTransfer?.files || [])]));
  $('#chooseFiles').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', () => { prepareFiles([...$('#fileInput').files]); $('#fileInput').value = ''; });
  document.addEventListener('paste', event => {
    if (event.target.closest('input,textarea,[contenteditable]')) return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { event.preventDefault(); prepareFiles(files); }
  });
  let preparation = null;
  $('#chooseFolder').hidden = !('webkitdirectory' in $('#folderInput'));
  $('#chooseFolder').addEventListener('click', () => $('#folderInput').click());
  $('#folderInput').addEventListener('change', () => { prepareFiles([...$('#folderInput').files], true); $('#folderInput').value = ''; });
  $('#cancelPrepare').addEventListener('click', () => preparation?.abort());
  async function prepareFiles(files, folder = false) {
    if (!files.length) return;
    if (!folder && !$('#bundleFiles').checked) { queueFiles(files); return; }
    if (preparation) { toast('Wait for the current ZIP preparation or cancel it first.', true); return; }
    if (!authenticated || !selectedPeerIds.size) { toast('Choose the receiving devices first.', true); return; }
    const targets = [...selectedPeerIds];
    preparation = new AbortController(); $('#cancelPrepare').hidden = false;
    try {
      $('#prepareStatus').textContent = 'Preparing ZIP. Reading file checksums…';
      let lastUpdate = 0;
      const file = await window.DriftArchive.create(files, {
        name: folder ? `${files[0].webkitRelativePath.split('/')[0].slice(0, 240)}.zip` : 'DriftShare-files.zip', signal: preparation.signal,
        onProgress: (done, total) => { if (performance.now() - lastUpdate > 200) { lastUpdate = performance.now(); $('#prepareStatus').textContent = `Preparing ZIP: ${formatBytes(done)} / ${formatBytes(total)}`; } }
      });
      queueFiles([file], targets); $('#prepareStatus').textContent = `ZIP ready: ${files.length} files. Folder paths are preserved; empty folders are omitted.`;
    } catch (error) {
      $('#prepareStatus').textContent = error.name === 'AbortError' ? 'ZIP preparation cancelled.' : error.message;
    } finally { preparation = null; $('#cancelPrepare').hidden = true; }
  }
  function queueFiles(files, targetIds = [...selectedPeerIds]) {
    if (!files.length) return;
    const targets = peers.filter(peer => targetIds.includes(peer.id));
    if (!authenticated || !targets.length) { toast('Connect and choose one or more receiving devices first.', true); return; }
    if (queue.length + files.length * targets.length > 1000) { toast('Add at most 1,000 queued deliveries at a time (files × devices).', true); return; }
    for (const file of files) {
      if (file.size > P.MAX_FILE) { toast(`“${file.name}” exceeds the 5 GB limit.`, true); continue; }
      for (const peer of targets) {
        // Share the File reference; each recipient has independent consent and progress.
        const t = { id: id(), direction: 'out', file, name: file.name, size: file.size, mime: file.type || 'application/octet-stream',
          peerId: peer.id, peerName: peer.name, status: 'queued', bytesDone: 0 };
        if (!P.validOffer({ ...t, transferId: t.id, targetId: t.peerId })) { toast(`Cannot send ${file.name}: unsupported file metadata.`, true); continue; }
        transfers.set(t.id, t); queue.push(t); renderTransfer(t);
      }
    }
    pumpQueue();
  }
  function pumpQueue() {
    if (!authenticated) return;
    while (activeRecipients.size < MAX_OUTGOING) {
      // Serialize files for each recipient without blocking other recipients.
      const index = queue.findIndex(t => !activeRecipients.has(t.peerId));
      if (index === -1) break;
      const [t] = queue.splice(index, 1);
      if (P.terminal(t.status)) continue;
      activeRecipients.add(t.peerId); t.active = true; t.status = 'offering'; t.lastActivity = performance.now();
      updateTransfer(t);
      send({ type: 'file-offer', targetId: t.peerId, transferId: t.id, name: t.name, size: t.size, mime: t.mime });
    }
  }
  function startRelayDownload(t) {
    if (!t.downloadUrl || t.downloadStarted || P.terminal(t.status)) return;
    const link = document.createElement('a'); link.href = t.downloadUrl; link.download = t.name;
    document.body.append(link); link.click(); link.remove();
  }
  function pauseRelay(t) {
    if (P.terminal(t.status)) return;
    t.status = 'paused'; t.resumable = true; t.abort?.abort();
    t.reason = 'Keep both tabs open. Reconnect, then use Resume in the receiving browser’s Downloads within 15 minutes. Closing a tab or restarting the host loses this resume session.';
    t.speed = 0; t.sampleAt = null; updateTransfer(t);
  }
  async function uploadRelay(t, token, offset = 0, resumable = false) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > t.size) throw new Error('Invalid resume position.');
    t.resumable = resumable === true; t.reason = '';
    t.bytesDone = offset; t.sampleBytes = offset; t.sampleAt = performance.now();
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid upload authorization.');
    t.relay = true; t.route = 'via LAN host'; t.status = 'sending'; t.lastActivity = performance.now();
    const attempt = t.abort = new AbortController(); updateTransfer(t);
    try {
      const response = await fetch(`/relay/${t.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: offset ? t.file.slice(offset) : t.file, signal: attempt.signal });
      if (t.abort !== attempt) return;
      if (!response.ok) throw new Error('LAN download failed. Check the receiving browser and retry.');
    } catch (error) {
      // A delayed rejection from an interrupted upload must not stop its replacement.
      if (t.abort === attempt) throw error;
    }
    // Completion comes from signaling after the host finishes the download stream.
  }

  // One reusable connection per direction and peer; opposite-direction sends cannot
  // cause SDP glare. Each file gets an independent reliable, ordered data channel.
  function getSession(t) {
    const key = `${t.direction}:${t.peerId}`;
    let session = sessions.get(key);
    if (session && !['closed', 'failed'].includes(session.pc.connectionState)) {
      clearTimeout(session.idleTimer); session.transferId = t.id; return session;
    }
    const pc = new RTCPeerConnection({ iceServers: [] });
    session = { key, pc, direction: t.direction, peerId: t.peerId, transferId: t.id, pending: [], signalChain: Promise.resolve(), users: new Set() };
    sessions.set(key, session);
    pc.addEventListener('icecandidate', event => {
      if (event.candidate) send({ type: 'rtc-signal', targetId: session.peerId, transferId: session.transferId, signal: { type: 'candidate', candidate: event.candidate } });
    });
    pc.addEventListener('datachannel', event => {
      const transferId = event.channel.label.replace(/^file:/, '');
      const receiver = transfers.get(transferId);
      if (!event.channel.label.startsWith('file:') || !receiver || receiver.direction !== 'in' || receiver.peerId !== session.peerId || receiver.status !== 'connecting' || receiver.channel) { event.channel.close(); return; }
      attachChannel(receiver, event.channel, session);
    });
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        for (const transferId of [...session.users]) finish(transfers.get(transferId), 'error', 'Direct connection interrupted. Retry this file.');
        if (sessions.get(key) === session) sessions.delete(key);
      }
    });
    return session;
  }
  function closeSession(session) {
    clearTimeout(session.idleTimer);
    if (sessions.get(session.key) === session) sessions.delete(session.key);
    session.pc.close();
  }
  async function startRtc(t) {
    t.status = 'connecting'; t.lastActivity = performance.now(); updateTransfer(t);
    const session = getSession(t);
    attachChannel(t, session.pc.createDataChannel(`file:${t.id}`, { ordered: true }), session);
    if (!session.pc.localDescription) {
      await session.pc.setLocalDescription(await session.pc.createOffer());
      if (!P.terminal(t.status)) send({ type: 'rtc-signal', targetId: t.peerId, transferId: t.id, signal: { type: 'sdp', description: session.pc.localDescription } });
    }
  }
  async function handleSignal(msg) {
    const t = transfers.get(msg.transferId);
    if (!t || P.terminal(t.status) || t.peerId !== msg.fromId || !['connecting', 'sending', 'receiving', 'verifying'].includes(t.status)) return;
    const session = getSession(t); t.session = session; session.users.add(t.id);
    session.signalChain = session.signalChain.then(async () => {
      if (P.terminal(t.status)) return;
      const s = msg.signal;
      if (s.type === 'candidate') {
        if (session.pc.remoteDescription) await session.pc.addIceCandidate(s.candidate);
        else session.pending.push(s.candidate);
      } else if (s.type === 'sdp') {
        await session.pc.setRemoteDescription(s.description);
        for (const candidate of session.pending.splice(0)) await session.pc.addIceCandidate(candidate);
        if (s.description.type === 'offer') {
          await session.pc.setLocalDescription(await session.pc.createAnswer());
          send({ type: 'rtc-signal', targetId: t.peerId, transferId: t.id, signal: { type: 'sdp', description: session.pc.localDescription } });
        }
      }
    });
    await session.signalChain;
  }
  function control(t, msg) {
    if (t.channel?.readyState !== 'open') throw new Error('The transfer channel closed.');
    t.channel.send(JSON.stringify(msg));
  }
  function attachChannel(t, channel, session) {
    t.channel = channel; t.session = session; session.users.add(t.id);
    channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 256 * 1024;
    t.abort = new AbortController(); t.ack = 0; t.sent = 0; t.crc = 0xffffffff;
    channel.addEventListener('bufferedamountlow', () => t.wake?.());
    channel.addEventListener('open', () => {
      t.lastActivity = t.startedAt = performance.now();
      t.sampleAt = t.startedAt; t.sampleBytes = 0;
      t.status = t.direction === 'out' ? 'sending' : 'receiving'; updateTransfer(t);
      if (t.direction === 'out') sendFile(t).catch(error => finish(t, 'error', error.message));
      else { try { control(t, { type: 'ready', window: P.WINDOW }); } catch (error) { finish(t, 'error', error.message); } }
      session.pc.getStats().then(stats => {
        let pair; stats.forEach(report => { if (report.type === 'transport' && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId); });
        if (pair) { const local = stats.get(pair.localCandidateId); t.route = `direct · ${local?.protocol || 'WebRTC'}`; updateTransfer(t); }
      }).catch(() => {});
    });
    channel.addEventListener('error', () => finish(t, 'error', 'The transfer channel failed.'));
    channel.addEventListener('close', () => {
      // Receiver may still be flushing its final disk write.
      if (!P.terminal(t.status) && !t.endQueued) finish(t, 'error', 'The transfer channel closed before completion.');
    });
    channel.addEventListener('message', event => {
      if (P.terminal(t.status)) return;
      t.lastActivity = performance.now();
      if (event.data instanceof ArrayBuffer) {
        if (t.direction !== 'in') { finish(t, 'error', 'Unexpected file data.'); return; }
        receiveChunk(t, event.data); return;
      }
      let msg;
      try { if (typeof event.data !== 'string' || event.data.length > 4096) throw Error(); msg = JSON.parse(event.data); if (!msg || typeof msg !== 'object') throw Error(); }
      catch { finish(t, 'error', 'Invalid transfer message.'); return; }
      if (msg.type === 'error' || msg.type === 'cancel') {
        finish(t, msg.type === 'cancel' ? 'cancelled' : 'error', typeof msg.reason === 'string' ? msg.reason.slice(0, 200) : 'The other device stopped the transfer.', false);
        return;
      }
      if (t.direction === 'out') {
        if (msg.type === 'ready' && !t.ready && Number.isSafeInteger(msg.window) && msg.window >= P.CHUNK && msg.window <= P.WINDOW) {
          t.ready = true; t.window = msg.window; t.wake?.();
        } else if (msg.type === 'ack' && Number.isSafeInteger(msg.bytes) && msg.bytes >= t.ack && msg.bytes <= t.sent) {
          t.ack = msg.bytes; progress(t, msg.bytes); t.wake?.();
        } else if (msg.type === 'complete' && t.status === 'verifying' && msg.bytes === t.size && msg.checksum === t.digest) {
          progress(t, t.size); finish(t, 'done', '', false);
        } else { finish(t, 'error', 'Invalid transfer acknowledgment.'); }
      } else if (msg.type === 'end' && !t.endQueued) {
        t.endQueued = true;
        const state = incoming.get(t.id);
        state.chain = state.chain.then(() => completeReceive(t, msg)).catch(error => finish(t, 'error', error.message));
      } else { finish(t, 'error', 'Unexpected transfer message.'); }
    });
  }
  function waitUntil(t, predicate) {
    if (t.abort.signal.aborted || P.terminal(t.status)) return Promise.reject(new Error('Transfer stopped.'));
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); t.abort.signal.removeEventListener('abort', check); if (t.wake === check) t.wake = null; };
      const check = () => {
        clearTimeout(timer);
        if (t.abort.signal.aborted || t.channel.readyState !== 'open') { cleanup(); reject(new Error('Transfer stopped.')); }
        else if (predicate()) { cleanup(); resolve(); }
        else timer = setTimeout(check, 100);
      };
      t.wake = check; t.abort.signal.addEventListener('abort', check, { once: true }); check();
    });
  }
  async function sendFile(t) {
    await waitUntil(t, () => t.ready);
    const maximum = t.session.pc.sctp?.maxMessageSize;
    const chunkSize = Math.min(P.CHUNK, maximum > 0 ? maximum : P.CHUNK);
    if (chunkSize < 1024) throw new Error('The negotiated message size is too small.');
    let offset = 0;
    while (offset < t.size) {
      if (P.terminal(t.status)) return;
      // Read one MiB at a time to avoid a file-read promise per network packet.
      const block = new Uint8Array(await t.file.slice(offset, offset + 1024 * 1024).arrayBuffer());
      if (!block.length) throw new Error('The source file could not be read.');
      for (let at = 0; at < block.length; at += chunkSize) {
        const chunk = block.subarray(at, Math.min(at + chunkSize, block.length));
        await waitUntil(t, () => t.sent - t.ack + chunk.length <= t.window && t.channel.bufferedAmount <= P.WINDOW);
        if (P.terminal(t.status)) return;
        t.crc = P.checksum(t.crc, chunk); t.channel.send(chunk); t.sent += chunk.length;
      }
      offset += block.length;
    }
    await waitUntil(t, () => t.ack === t.size);
    t.digest = P.digest(t.crc); t.status = 'verifying'; t.lastActivity = performance.now(); updateTransfer(t);
    control(t, { type: 'end', bytes: t.size, checksum: t.digest });
  }

  function showNextOffer() {
    if (currentOffer) return;
    const offer = offers.shift(); if (!offer) return;
    currentOffer = offer;
    $('#useRelay').checked = !canRtc || offer.rtcAvailable === false;
    $('#offerTitle').textContent = offer.name;
    $('#offerMeta').textContent = `from ${offer.fromName} · ${formatBytes(offer.size)}`;
    updateStorageNote();
    $('#offerAccept').disabled = false; openModal($('#offerModal'));
  }
  function dismissOffer() { currentOffer = null; closeModal($('#offerModal')); $('#offerAccept').disabled = false; }
  function removeOffer(transferId) {
    for (let index = offers.length - 1; index >= 0; index--) if (offers[index].transferId === transferId) offers.splice(index, 1);
    if (currentOffer?.transferId === transferId) { dismissOffer(); showNextOffer(); }
  }
  $('#offerReject').addEventListener('click', () => {
    if (!currentOffer) return;
    send({ type: 'file-reject', transferId: currentOffer.transferId, targetId: currentOffer.fromId });
    dismissOffer(); showNextOffer();
  });
  $('#offerAccept').addEventListener('click', acceptOffer);
  async function acceptOffer() {
    const offer = currentOffer; if (!offer) return;
    $('#offerAccept').disabled = true;
    let writer, relay = false;
    try {
      if (needsRelay()) {
        relay = true;
      } else if (canSaveDirectly && $('#saveDirectly').checked) {
        // Must be invoked directly by the Accept gesture, before any await.
        const handle = await window.showSaveFilePicker({ suggestedName: offer.name.replace(/[\\/]/g, '_') });
        if (currentOffer !== offer) return;
        writer = await handle.createWritable();
      } else if (reservedMemory + offer.size > P.MAX_MEMORY) {
        relay = true;
      }
      if (currentOffer !== offer || !authenticated) { await writer?.abort(); return; }
      const t = { id: offer.transferId, direction: 'in', peerId: offer.fromId, peerName: offer.fromName,
        name: offer.name, mime: offer.mime, size: offer.size, status: 'connecting', bytesDone: 0,
        lastActivity: performance.now(), disk: Boolean(writer), relay, route: relay ? 'via LAN host' : '', memoryReservation: writer || relay ? 0 : offer.size };
      reservedMemory += t.memoryReservation;
      if (!relay) incoming.set(t.id, { writer, chunks: [], received: 0, written: 0, pending: 0, lastAck: 0, chain: Promise.resolve() });
      transfers.set(t.id, t); renderTransfer(t);
      send({ type: 'file-accept', transferId: t.id, targetId: t.peerId, transport: relay ? 'relay' : 'rtc', resumable: relay });
      dismissOffer(); showNextOffer();
    } catch (error) {
      await writer?.abort().catch(() => {});
      if (error.name !== 'AbortError') toast(error.message, true);
      if (currentOffer === offer) $('#offerAccept').disabled = false;
    }
  }
  function receiveChunk(t, buffer) {
    const state = incoming.get(t.id);
    if (!state || t.endQueued || !buffer.byteLength || buffer.byteLength > P.CHUNK ||
        state.received + buffer.byteLength > t.size || state.pending + buffer.byteLength > P.WINDOW + P.CHUNK) {
      finish(t, 'error', 'The sender exceeded the agreed file size or receive window.'); return;
    }
    state.received += buffer.byteLength; state.pending += buffer.byteLength;
    state.chain = state.chain.then(async () => {
      if (P.terminal(t.status)) return;
      t.crc = P.checksum(t.crc, new Uint8Array(buffer));
      if (state.writer) await state.writer.write(buffer); else state.chunks.push(buffer);
      if (P.terminal(t.status)) return;
      state.written += buffer.byteLength; state.pending -= buffer.byteLength; t.lastActivity = performance.now();
      progress(t, state.written);
      if (state.written - state.lastAck >= 256 * 1024 || state.written === t.size) {
        control(t, { type: 'ack', bytes: state.written }); state.lastAck = state.written;
      }
    }).catch(error => finish(t, 'error', `Could not receive file: ${error.message}`));
  }
  async function completeReceive(t, msg) {
    if (P.terminal(t.status)) return;
    const state = incoming.get(t.id);
    if (state.written !== t.size || msg.bytes !== t.size || msg.checksum !== P.digest(t.crc)) throw new Error('File integrity check failed. Please retry.');
    t.status = 'verifying'; updateTransfer(t);
    if (state.writer) await state.writer.close();
    else t.blob = new Blob(state.chunks, { type: t.mime || 'application/octet-stream' });
    if (P.terminal(t.status)) return;
    control(t, { type: 'complete', bytes: t.size, checksum: P.digest(t.crc) });
    send({ type: 'file-received', transferId: t.id, targetId: t.peerId });
    finish(t, 'done', '', false);
  }
  function finish(t, status, reason = '', notify = true) {
    if (!t || P.terminal(t.status)) return;
    t.status = status; t.reason = reason; t.endedAt = performance.now();
    const queuedIndex = queue.indexOf(t);
    if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
    t.abort?.abort(); clearTimeout(t.renderTimer);
    if (notify && status !== 'done') {
      // Deliver the reason before closing the ordered channel; signaling may take
      // a different network path and arrive after the close event.
      if (t.channel?.readyState === 'open') {
        try { control(t, { type: status === 'cancelled' ? 'cancel' : 'error', reason }); } catch { /* signaling remains available */ }
      }
      send({ type: status === 'cancelled' ? 'file-cancel' : 'file-error', transferId: t.id, targetId: t.peerId, reason });
    }
    const state = incoming.get(t.id);
    if (state) {
      incoming.delete(t.id); state.chunks.length = 0;
      if (status !== 'done') state.writer?.abort().catch(() => {});
    }
    if (status !== 'done') releaseMemory(t);
    if (status === 'done' && t.direction === 'out') t.file = null;
    if (t.session) {
      t.session.users.delete(t.id);
      if (!t.session.users.size) t.session.idleTimer = setTimeout(() => closeSession(t.session), 60000);
    }
    // SCTP closes a channel after its pending reliable messages are transmitted.
    t.channel?.close();
    if (t.active) { t.active = false; activeRecipients.delete(t.peerId); }
    updateTransfer(t); pumpQueue();
  }
  function releaseMemory(t) { reservedMemory = Math.max(0, reservedMemory - (t.memoryReservation || 0)); t.memoryReservation = 0; t.blob = null; }
  function progress(t, bytes) {
    t.bytesDone = bytes;
    if (!t.renderTimer) t.renderTimer = setTimeout(() => { t.renderTimer = null; updateTransfer(t); }, 125);
  }
  setInterval(() => {
    const now = performance.now();
    for (const t of transfers.values()) {
      if (P.terminal(t.status) || ['queued', 'paused'].includes(t.status)) continue;
      if (now - t.lastActivity > (t.status === 'offering' ? 120000 : 45000)) { if (t.resumable) pauseRelay(t); else finish(t, 'error', 'Transfer stalled. Check both devices and retry.'); continue; }
      if (t.status !== 'offering' && (!t.lastKeepalive || now - t.lastKeepalive >= 15000)) {
        send({ type: 'file-keepalive', transferId: t.id, targetId: t.peerId }); t.lastKeepalive = now;
      }
      if (t.sampleAt) {
        const rate = (t.bytesDone - t.sampleBytes) / ((now - t.sampleAt) / 1000);
        t.speed = t.speed === undefined ? rate : t.speed * 0.5 + rate * 0.5;
        t.sampleAt = now; t.sampleBytes = t.bytesDone; updateTransfer(t);
      }
    }
  }, 1000);

  const labels = { paused: 'paused · resume in browser Downloads', queued: 'queued', offering: 'waiting for acceptance', connecting: 'connecting', sending: 'sending', receiving: 'receiving', verifying: 'checking and saving', done: 'complete', rejected: 'declined', error: 'failed', cancelled: 'cancelled' };
  function renderTransfer(t) {
    $('#transferList').querySelector('.empty-state')?.remove();
    const card = document.createElement('article'); card.id = `t-${t.id}`; card.className = 'transfer-card'; $('#transferList').prepend(card); updateTransfer(t);
  }
  function updateTransfer(t) {
    updateSummary(); updateWakeLock();
    const card = document.getElementById(`t-${t.id}`); if (!card) return;
    const percent = t.size ? Math.min(100, t.bytesDone / t.size * 100) : t.status === 'done' ? 100 : 0;
    const active = !P.terminal(t.status);
    const eta = t.speed > 0 && t.bytesDone < t.size ? ` · ${formatTime((t.size - t.bytesDone) / t.speed)} left` : '';
    const rate = active && t.speed > 0 ? ` · ${formatBytes(t.speed)}/s${eta}` : '';
    const elapsed = t.status === 'done' && t.startedAt ? ` · ${formatTime((t.endedAt - t.startedAt) / 1000)}` : '';
    card.innerHTML = `<div class="transfer-row"><span class="transfer-name">${t.direction === 'out' ? '→' : '←'} ${escapeHtml(t.name)}</span><span class="transfer-stat">${formatBytes(t.bytesDone)} / ${formatBytes(t.size)}</span></div>
      <div class="bar-track" role="progressbar" aria-label="${escapeHtml(t.name)}" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100"><div class="bar-fill ${t.status === 'done' ? 'done' : active ? '' : 'error'}" style="width:${percent}%"></div></div>
      <div class="transfer-footer"><span>${t.direction === 'out' ? 'to' : 'from'} ${escapeHtml(t.peerName)} · ${t.status === 'done' && t.relay ? 'sent to browser Downloads' : labels[t.status]}${t.status === 'done' && t.disk ? ' · saved to disk' : ''}${rate}${elapsed}${t.route ? ` · ${escapeHtml(t.route)}` : ''}</span><span class="transfer-actions">
      ${active && t.downloadUrl && !t.downloadStarted ? `<button class="link-btn" data-action="download" data-id="${escapeHtml(t.id)}">start download</button>` : ''}
      ${active ? `<button class="link-btn link-btn--danger" data-action="cancel" data-id="${escapeHtml(t.id)}">cancel</button>` : ''}
      ${t.blob ? `<button class="link-btn" data-action="save" data-id="${escapeHtml(t.id)}">save file</button>` : ''}
      ${!active && t.file ? `<button class="link-btn" data-action="retry" data-id="${escapeHtml(t.id)}">retry</button>` : ''}
      ${!active ? `<button class="link-btn" data-action="dismiss" data-id="${escapeHtml(t.id)}">remove</button>` : ''}</span></div>${t.reason ? `<p class="transfer-reason${t.status === 'done' ? ' transfer-info' : ''}">${escapeHtml(t.reason)}</p>` : ''}`;
    $('#queueStatus').textContent = `${activeRecipients.size}/${MAX_OUTGOING} outgoing active · ${queue.length} queued · ${formatBytes(reservedMemory)} in memory`;
  }
  function updateSummary() {
    const groups = new Map();
    for (const t of transfers.values()) {
      if (t.direction !== 'out') continue;
      const group = groups.get(t.peerId) || { name: t.peerName, done: 0, failed: 0, waiting: 0 };
      if (t.status === 'done') group.done++; else if (P.terminal(t.status)) group.failed++; else group.waiting++;
      groups.set(t.peerId, group);
    }
    $('#deliverySummary').textContent = [...groups.values()].map(g => `${g.name}: ${g.done} delivered, ${g.failed} unsuccessful, ${g.waiting} pending`).join(' · ');
  }
  $('#exportResults').addEventListener('click', () => {
    const results = [...transfers.values()].map(t => ({ name: t.name, device: t.peerName, direction: t.direction,
      bytes: t.size, status: t.status, route: t.route || '', resumedFrom: t.resumedFrom || 0,
      seconds: t.startedAt && t.endedAt ? (t.endedAt - t.startedAt) / 1000 : null,
      completion: t.relay ? 'sent to browser Downloads; verify saved file separately' : 'receiver length/CRC checked and output finalized' }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), results }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'driftshare-results.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  function dismissTransfer(t) {
    if (!P.terminal(t.status)) return;
    releaseMemory(t); t.file = null; transfers.delete(t.id); updateSummary(); document.getElementById(`t-${t.id}`)?.remove();
    $('#queueStatus').textContent = `${activeRecipients.size}/${MAX_OUTGOING} outgoing active · ${queue.length} queued · ${formatBytes(reservedMemory)} in memory`;
  }
  $('#transferList').addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const t = transfers.get(button.dataset.id); if (!t) return;
    if (button.dataset.action === 'download') startRelayDownload(t);
    if (button.dataset.action === 'cancel') finish(t, 'cancelled', 'Cancelled.', !['queued', 'paused'].includes(t.status));
    if (button.dataset.action === 'dismiss') dismissTransfer(t);
    if (button.dataset.action === 'retry') {
      const targetId = peers.some(peer => peer.id === t.peerId) ? t.peerId : selectedPeerIds.size === 1 ? [...selectedPeerIds][0] : null;
      if (!targetId) { toast('The original recipient is offline. Select exactly one device to retry this delivery.', true); return; }
      if (t.file) queueFiles([t.file], [targetId]);
    }
    if (button.dataset.action === 'save' && t.blob) {
      const url = URL.createObjectURL(t.blob); const link = document.createElement('a'); link.href = url; link.download = t.name;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  });
  $('#clearCompleted').addEventListener('click', () => {
    if ([...transfers.values()].some(t => t.blob) && !confirm('Remove completed files from browser memory? Save any files you want to keep first.')) return;
    for (const t of [...transfers.values()]) if (P.terminal(t.status)) dismissTransfer(t);
  });
  window.addEventListener('beforeunload', event => {
    if ([...transfers.values()].some(t => !P.terminal(t.status) || t.blob)) { event.preventDefault(); event.returnValue = ''; }
  });

  function openModal(modal) {
    if (!modal.classList.contains('hidden')) return;
    modal.previousFocus = document.activeElement; modal.classList.remove('hidden');
    modal.querySelector('input:not([disabled]),button,select')?.focus();
  }
  function closeModal(modal) { if (modal.classList.contains('hidden')) return; modal.classList.add('hidden'); modal.previousFocus?.focus(); }
  document.addEventListener('keydown', event => {
    const modal = [...document.querySelectorAll('.modal:not(.hidden)')].at(-1); if (!modal) return;
    if (event.key === 'Escape' && modal.id === 'joinModal') closeModal(modal);
    if (event.key !== 'Tab') return;
    const items = [...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select')];
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  function toast(message, error = false) {
    const el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.textContent = message;
    $('#toasts').append(el); setTimeout(() => el.remove(), 6000);
  }
  function formatBytes(bytes) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; let index = 0;
    while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index++; }
    return `${bytes.toFixed(index ? 1 : 0)} ${units[index]}`;
  }
  function formatTime(seconds) { return seconds < 60 ? `${Math.max(1, Math.ceil(seconds))}s` : `${Math.ceil(seconds / 60)}m`; }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
  connect();
})();
