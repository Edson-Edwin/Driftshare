const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** @type {Map<string, import('ws').WebSocket>} */
const peers = new Map();

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastPeerList() {
  const list = [...peers.values()].map((ws) => ({
    id: ws.id,
    name: ws.name,
    deviceType: ws.deviceType,
  }));
  for (const ws of peers.values()) {
    safeSend(ws, { type: 'peers', peers: list.filter((p) => p.id !== ws.id) });
  }
}

wss.on('connection', (ws) => {
  ws.id = shortId();
  ws.name = 'Unknown device';
  ws.deviceType = 'desktop';
  ws.isAlive = true;
  ws.relayTo = null; // ws this socket is currently streaming OUT to
  ws.busy = false; // true while this socket is receiving a transfer

  ws.on('pong', () => {
    ws.isAlive = true;
    ws.missedHeartbeat = false;
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Raw file chunk — relay verbatim to whoever this sender is currently streaming to.
      if (ws.relayTo && ws.relayTo.readyState === ws.relayTo.OPEN) {
        ws.relayTo.send(data, { binary: true });
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'hello': {
        ws.name = (msg.name || 'Unknown device').slice(0, 40);
        ws.deviceType = msg.deviceType === 'mobile' ? 'mobile' : 'desktop';
        peers.set(ws.id, ws);
        safeSend(ws, { type: 'welcome', id: ws.id });
        broadcastPeerList();
        break;
      }

      case 'rename': {
        ws.name = (msg.name || ws.name).slice(0, 40);
        broadcastPeerList();
        break;
      }

      case 'file-offer': {
        const target = peers.get(msg.targetId);
        if (!target) {
          safeSend(ws, { type: 'file-error', transferId: msg.transferId, reason: 'Device is offline.' });
          return;
        }
        if (target.busy) {
          safeSend(ws, { type: 'file-busy', transferId: msg.transferId, targetId: msg.targetId });
          return;
        }
        safeSend(target, {
          type: 'file-offer',
          transferId: msg.transferId,
          fromId: ws.id,
          fromName: ws.name,
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
        });
        break;
      }

      case 'file-accept': {
        const sender = peers.get(msg.targetId); // original sender's id
        if (!sender) return;
        ws.busy = true; // this (receiver) socket now expects a binary stream
        sender.relayTo = ws;
        safeSend(sender, { type: 'file-accept', transferId: msg.transferId, fromId: ws.id });
        break;
      }

      case 'file-reject': {
        const sender = peers.get(msg.targetId);
        if (sender) safeSend(sender, { type: 'file-reject', transferId: msg.transferId, fromId: ws.id });
        break;
      }

      case 'file-end': {
        const target = peers.get(msg.targetId);
        ws.relayTo = null;
        if (target) safeSend(target, { type: 'file-end', transferId: msg.transferId, fromId: ws.id });
        break;
      }

      case 'file-received': {
        // Receiver confirms assembly is done; free it up for the next transfer.
        ws.busy = false;
        const sender = peers.get(msg.targetId);
        if (sender) safeSend(sender, { type: 'file-received', transferId: msg.transferId });
        break;
      }

      case 'file-cancel': {
        const target = peers.get(msg.targetId);
        ws.relayTo = null;
        ws.busy = false;
        if (target) safeSend(target, { type: 'file-cancel', transferId: msg.transferId, fromId: ws.id });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    peers.delete(ws.id);
    for (const p of peers.values()) {
      if (p.relayTo === ws) p.relayTo = null;
    }
    broadcastPeerList();
  });
});

// Keep backgrounded devices connected; only prune after two missed heartbeats.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      if (ws.missedHeartbeat) ws.terminate();
      else {
        ws.missedHeartbeat = true;
        ws.ping();
      }
      continue;
    }
    ws.isAlive = false;
    ws.missedHeartbeat = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nDriftShare running on port ${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const addr of getLanAddresses()) {
    console.log(`  Network: http://${addr}:${PORT}   <-- open this on other devices (same Wi-Fi)`);
  }
  console.log('');
});
