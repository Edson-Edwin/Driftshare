# DriftShare

Fast local file transfer between devices on the same Wi-Fi. No internet, no accounts,
no cloud upload — files move device-to-device over your router.

## Run it

```bash
npm install
npm start
```

The terminal prints two URLs:

```
Local:   http://localhost:4000
Network: http://192.168.x.x:4000   <-- open this on other devices
```

Open the **Network** URL on your laptop, phone, and any other device connected to the
same Wi-Fi. Each one shows up in the "Nearby" list on every other device within a
second or two. Click a device, drop a file on it (or use "choose files"), and the
receiver gets an accept/decline prompt.

If a device can't see the others, check that your Wi-Fi router doesn't have **AP/client
isolation** enabled (some public and guest networks block device-to-device traffic by
design — home networks are almost always fine).

## How it works (v1 — WebSocket relay)

```
Browser A  ──hello──▶  Node server  ◀──hello──  Browser B
                         (peer list broadcast to all)

Browser A  ──file-offer──▶  server  ──▶  Browser B
Browser B  ◀──file-accept── server  ◀──  Browser B
Browser A  ──[binary chunks]──▶  server  ──▶  Browser B   (relayed as-is, no re-encoding)
Browser A  ──file-end──▶  server  ──▶  Browser B  ──file-received ack──▶  server ──▶ A
```

- One Node process does two jobs: `express` serves the static page, and a `ws`
  WebSocket server handles both **signaling** (who's online, offer/accept/reject) and
  **the file bytes themselves** — chunked into 256KB frames and relayed straight
  through the server without ever touching disk.
- Every device registers a short id and name on connect; the server rebroadcasts the
  peer list on every join/leave so discovery feels instant.
- To keep chunk-routing unambiguous, each socket allows one outbound stream and one
  inbound stream at a time. Sending multiple files just queues them client-side —
  you won't notice unless you're blasting many large files to many people at once.
- All transfer happens in-memory on the receiving browser tab (via `Blob`), then
  offers a normal download link — nothing is written to the server's disk.

This is intentionally simple: since traffic goes A → server → B, it's bounded by your
router's switching speed, which on any decent modern Wi-Fi is still very fast for
photos, docs, and moderate video — just not wire-speed peer-to-peer.

## v2 — true peer-to-peer (recommended next step)

For AirDrop-level speed, keep this server for **signaling only** and move the actual
bytes onto a **WebRTC `RTCDataChannel`**, which lets the two browsers exchange data
directly (server only relays the SDP offer/answer + ICE candidates, then gets out of
the way):

1. Replace the `file-offer` / `file-accept` flow with an SDP offer/answer exchange
   over the existing WebSocket ("signaling channel").
2. Each browser creates an `RTCPeerConnection`, opens a `createDataChannel('file')`,
   and swaps ICE candidates through the server.
3. Once the data channel opens, stream the file directly between browsers — no relay
   hop, so throughput is limited only by the two devices and the Wi-Fi itself, and
   large transfers no longer cost the server any bandwidth.
4. Keep this WebSocket server exactly as-is for peer discovery (the "Nearby" list) —
   only the transport for chunk 3 (the actual bytes) changes.

Since both devices are on the same LAN, `RTCPeerConnection` will usually negotiate a
direct local-network path without needing a STUN/TURN server at all.

## Project layout

```
server.js          Express static server + WebSocket signaling/relay
public/index.html  UI shell
public/style.css   Monochrome, protocol-inspired styling
public/client.js   Peer discovery, drag-drop, chunked send/receive logic
```

## Notes

- Works great for text files, photos, PDFs, zips, video — anything a browser can
  hold as a `Blob`. Very large files (multi-GB) will hold that much memory in the
  receiving tab since v1 buffers in RAM before offering the download; v2's streaming
  data channel removes that ceiling too.
- Device names are stored in the browser's `localStorage` so a device keeps its name
  across reloads. Click "edit" next to your name to change it.
- No files are ever written to the server — it only ever holds bytes in transit.
