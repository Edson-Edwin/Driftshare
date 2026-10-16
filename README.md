# DriftShare

Browser file sharing on a local network, up to **5 GB per file (5,000,000,000 bytes)**.
Node serves the UI, authenticates devices, and exchanges signaling. Direct transfers
use encrypted WebRTC. When a large file cannot be saved directly by the browser, a
LAN-host relay streams it into a normal browser download, without storing a host file
or assembling the full file in the receiving tab.

## Start and join

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open one of the **private join links printed in the terminal**, then share that link
with your other devices on the same network. The `#code=...` fragment is the access
credential; keep the full link private. The app remembers the code for the current
browser session and removes it from the address bar after loading. A new random **4-digit code**
is generated every server restart unless `ACCESS_CODE` is configured. You can also open
the host address without the fragment and type these four digits. The terminal and
Join panel both display the code.

For offline HTTPS, run `npm run start:secure` (Node.js 22+ and OpenSSL on the host).
The launcher generates a private local CA and a 30-day certificate for the host's
current LAN addresses, renewing it on startup when needed. It defaults to port 4443.
No internet or public domain is used. It prints a public `driftshare-root.cer` and its
SHA-256 fingerprint. Transfer **only this public certificate** to your own receiving
devices and trust it once, verifying the fingerprint against the host terminal.
Do not distribute `root.key` or `server.key`. The launcher does not modify OS trust
stores. Windows/macOS/Linux and Android/iOS have different certificate-trust flows;
without that trust step browsers will still warn. If installing trust is not acceptable,
this fully offline browser design cannot promise warning-free HTTPS.
Private CA files live in ignored `.driftshare-tls/`; back them up securely. Set
`DRIFTSHARE_TLS_DIR` to use another private directory. Restart the launcher after a LAN
IP change. It renews on startup, so restart it before the 30-day server certificate expires.
`npm run start:secure -- --setup-only` generates certificates without starting a server.
For device-specific trust steps use the official [Windows certificate guide](https://learn.microsoft.com/en-us/skype-sdk/sdn/articles/installing-the-trusted-root-certificate),
[Mac Keychain guide](https://support.apple.com/en-euro/guide/keychain-access/kyca2431/mac),
[Android certificate guide](https://support.google.com/pixelphone/answer/2844832/add-amp-remove-certificates),
and [iPhone/iPad trust guide](https://support.apple.com/en-us/102390).
On iOS, installing a certificate profile alone does not enable SSL trust; the separate
full-trust setting is required. Linux certificate stores vary by distribution/browser;
import your verified public CA using that browser's certificate settings if needed.

Use **Join** to show a QR code or copy a private link. When the host has several network
interfaces, select the address reachable by the receiving device. QR generation uses
the host's `qrencode` executable; when unavailable, the copyable link still works.
No external font or QR service is contacted.

Devices receive persistent labels such as “Android phone · 4821” or “Windows PC · 7053”.
Old “This device” labels are migrated automatically; custom names are preserved.
Use Rename for a personal label. Browsers cannot read the actual operating-system
computer name.

Select one or more nearby devices, then select, drop, or paste files. Click a selected
device again to deselect it. Each recipient accepts or declines their own copy. Both tabs must stay open. Keep mobile devices awake and the tabs
in the foreground; browsers may suspend background transfers.

Use **choose folder** to send a ZIP preserving its relative paths, or check **Bundle
selected files into one ZIP / one acceptance** before selecting files. Each recipient
accepts that one archive. ZIPs use store mode (no compression), at most 1,000 files,
and a 5 GB archive limit including metadata. Preparation reads CRCs incrementally from each file stream,
then builds the archive from Blob parts. Where supported, checksum reads reuse a 64 KiB BYOB buffer to reduce temporary memory.
It adds a full source-file read before sending;
preparation can be cancelled. Empty directories are omitted. Unsafe paths, duplicate
case-insensitive paths and Windows-invalid names are rejected rather than overwritten.
Desktop/mobile ZIP extraction behavior and large Blob handling still need device testing.
Per-device delivery totals and **Export results** help identify unsuccessful recipients.

## Transfer behavior

- Files queue visibly; up to four recipients run concurrently, with one outgoing file
  per recipient at a time. Additional recipients wait for a slot. Selection changes
  apply to new files only. Devices can also receive while sending. Each delivery has
  separate progress, cancellation, and retry; one failure does not cancel the others.
  Pending acceptance occupies a slot until accepted, declined, cancelled, or expired.
  All copies share network bandwidth: sending to more devices multiplies traffic.
- Connections are reused across consecutive files to avoid repeated ICE/DTLS setup.
  Separate connections per sending direction avoid simultaneous-negotiation conflicts.
  Idle connections are closed after one minute.
- The sender reads 1 MiB blocks and transmits messages up to 64 KiB, respecting the
  negotiated SCTP maximum. Receiver credits bound outstanding payload to 2 MiB.
  Credit is returned after receiving/writing data, not merely buffering it for sending.
- Progress, smoothed speed, and ETA use receiver-confirmed bytes. “Complete” requires
  exact length, matching incremental CRC32, and successful output finalization. CRC32
  detects accidental corruption; it is not a cryptographic authentication mechanism.
  WebRTC's DTLS supplies transport encryption and integrity.
- On supported secure browsers, **Save directly to disk** asks for the destination
  before accepting and writes chunks through a native file writer. It does not assemble
  the entire file in JavaScript memory. Disk-full and write errors fail both ends.
- Small files can use Blob downloads with a **128 MiB aggregate in-memory payload budget**.
  This is a memory budget, **not the file-size limit**. Files that exceed the remaining
  budget automatically use the LAN-host download stream when direct saving is not selected.
  Use **save file**, then **remove** or **Clear finished** to release retained small files.
- Select **Use browser Downloads via LAN host** in the incoming offer to use native
  Downloads for any file size, including when WebRTC is blocked by network policy.
  This route is automatically selected if either browser lacks the WebRTC API.
  An available API does not guarantee connectivity; a failed direct transfer still
  needs a retry with the recipient choosing this option.
- During active transfers the app requests a screen wake lock where available. It
  releases it when idle and requests it again on returning to the visible tab.
  Unsupported or denied wake locks do not block transfers; keep devices awake manually.
  This does not guarantee background or locked-screen operation on phones.
- The LAN-host fallback works with ordinary HTTP browser downloads, including when the
  direct-save API is unavailable. The offer explains the route before acceptance. If
  automatic downloads are blocked, click **start download** in the transfer card.
  The sender uploads a File body; Node pipes it to the recipient using bounded buffers
  and backpressure. Per-transfer download capabilities and per-attempt upload capabilities restrict access.
  No temporary file is created on the host. The host can see relayed bytes, and HTTP
  relay traffic is unencrypted; use HTTPS on untrusted networks.
- Relay status reports **sent to browser Downloads**, not a confirmed disk save: browsers
  do not expose native-download completion to the page. Check the browser’s Downloads
  for success, cancellation, or disk errors. Keep both tabs open during the stream.
- Cancel works for queued, offered, and active transfers. Retry a failed outgoing file
  to its original recipient when online. If that recipient disconnected, select exactly
  one replacement device before retrying. Retry never broadcasts to all selected devices.
  Retry starts from the beginning; partial transfer
  resumption for WebRTC/disk-writer transfers and across page reloads is not implemented.
- Source files that have not completed remain available for retry until removed or the
  page reloads. Completed outgoing file references are released.
- Interrupted LAN-host downloads retain their consent and resume capability for 15
  minutes. Keep both original tabs and the host running, reconnect, then use **Resume**
  in the recipient's browser Downloads manager when it offers that action. The host
  accepts a single byte range through EOF; the sender sends `File.slice(offset)` and
  the host returns HTTP 206 with ETag/Content-Range. No host file is stored. Upload
  tokens rotate between attempts; explicit Cancel invalidates the session.
  A browser may restart rather than resume, and a new download started from the page
  starts at zero. This cannot recover after closing/reloading the source tab, host
  restart, expiry, or after the host has already reported completion. WebRTC transfers
  still restart on retry. A paused delivery occupies its recipient slot until resumed,
  cancelled or expired. The range protocol and actual Chromium Downloads interruption/recovery are tested.
  Other browsers and physical phones still need native Resume validation.
- Offers expire after two minutes. Transfers fail after 45 seconds without useful
  activity. Closing/reloading a device cancels ordinary transfers; resumable relay sessions expire after 15 minutes if their original tabs cannot reconnect.

## HTTPS and large files

Plain `http://192.168.x.x` is convenient for trusted LAN testing but does **not** provide
an authenticated, encrypted page/signaling connection. The private access code does not
prevent interception on an untrusted HTTP network. Use HTTPS for untrusted networks.

Direct WebRTC disk saving needs a secure context and a browser with `showSaveFilePicker`.
The LAN-host fallback supports large files without that API or HTTPS; it adds a host
network hop and uses the browser’s normal download manager.
Browser support varies; the app detects it. `localhost` may qualify as secure for local
testing, but a remote device's LAN HTTP address does not. A certificate warning bypass
is not a substitute for a certificate trusted by the receiving device.

```sh
TLS_CERT=/path/to/trusted-cert.pem TLS_KEY=/path/to/private-key.pem npm start
```

Use a certificate valid for the hostname/IP you share and trusted by every device.
If using a TLS-terminating reverse proxy, forward WebSocket upgrades and set
`PUBLIC_URL` to its HTTPS origin. Keep the backend reachable only through the trusted
proxy when using this configuration. For large relayed files, disable proxy request/response
buffering, allow request bodies up to 5 GB, and configure adequate transfer timeouts.
The app disables Node’s overall request-upload deadline and enforces inactivity deadlines
instead, so a steadily progressing 5 GB upload may run for more than five minutes.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Listening port |
| `HOST` | `0.0.0.0` | Listening interface |
| `ACCESS_CODE` | Random 4-digit code | Optional fixed code containing exactly four digits |
| `TLS_CERT`, `TLS_KEY` | Unset | Certificate and key for native HTTPS |
| `PUBLIC_URL` | Detected LAN addresses | Explicit public HTTP(S) origin, including proxy HTTPS origin |

Do not expose this LAN service directly to the public internet. It does not include
internet discovery, TURN relay, accounts, or per-user permissions. Everyone with the
private join link can see the connected device list and send offers. Device names are
labels rather than independently verified identities.

## Security and reliability controls

The server validates metadata and message types, rejects duplicate transfer IDs,
requires registration/authentication, authorizes each transfer participant, and accepts
RTC signaling only after the recipient accepts. Browser origins are checked on upgrade.
WebSocket messages are capped at 64 KiB, connections at 64, and outstanding offers/
transfers per participant/recipient at eight. Incorrect codes are limited to five attempts per minute per connection IP across
reconnects and the QR endpoint. Rate limits, authentication deadlines,
heartbeat cleanup, transfer expiration, and socket error handlers bound common failures.

The receiver checks chunk size, advertised file length, and outstanding receive bytes.
The UI escapes untrusted values, uses keyboard-accessible peer buttons and file input,
traps modal focus, and shows connection status on small screens. The response CSP blocks
third-party scripts, framing, and inline script execution.

## Verification

```sh
npm run check
npm test
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
npm run test:compatibility
npm run test:large
npm run test:resume
npm run test:archive-large
```

To use an existing Chrome installation instead:

```sh
CHROME_PATH=/usr/bin/google-chrome npm run test:browser
```

The Node tests cover validation, authentication, duplicate IDs, participant authorization,
consent before negotiation, disconnect cleanup, origin checks, and HTTP security headers.
The browser suite uses isolated Chromium contexts and real WebRTC connections to verify:

- Empty files and a 17 MiB random file, verified byte-for-byte by SHA-256 after downloading.
- One reused connection across a file batch and simultaneous bidirectional sending.
- Multi-recipient selection, four-recipient concurrency, independent cancellation and
  decline, per-recipient queue order, and targeted retry.
- Cancellation before acceptance, checksum rejection, and disk-write failures.
- Excess-byte rejection and a deliberately stalled writer: the sender stops at
  2 MiB outstanding, and cancelling releases both sides.
- Streaming to a real OPFS file writer and verifying its committed bytes. Only the
  interactive save picker is replaced for automation; the browser writer remains native.
- A 129 MiB native browser download through the host, checked by SHA-256; files above
  5 GB rejected before offering; device-label migration and persistence.
- Disconnect/retry, browser exceptions, and mobile-width layout.

`npm run test:large` streams an actual 5,000,000,000-byte generated payload through the
relay over loopback. It hashes both ends and measures server-process memory growth,
without creating a 5 GB fixture or download on disk. This is a Node HTTP transfer test;
the automated browser download test uses 129 MiB.

These are same-machine functional checks, **not a LAN throughput benchmark or proof of
Safari/iOS/Firefox interoperability**. Test those browsers on physical devices before
claiming support, particularly screen locking, background suspension, and large files.
See the browser documentation for [direct file saving](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)
and [negotiated data-channel message limits](https://developer.mozilla.org/en-US/docs/Web/API/RTCSctpTransport/maxMessageSize).

## Speed: what changed and how to measure it

Connection reuse reduces setup overhead for batches. Larger source reads reduce the
number of asynchronous disk reads; bounded credits prevent a fast sender overwhelming
a slower receiver. Streaming to disk avoids whole-file JavaScript memory growth.
Actual improvement depends on the devices, browser, storage, and network.

Replacing Node would not change the direct WebRTC file-byte path. The relay path does
pass through Node; profile that path separately, including host network bandwidth.
Adding more parallel channels or larger buffers is not automatically faster, and a
browser cannot exceed the slowest effective network or storage link. For example,
1 Gbit/s is at most 125 MB/s before protocol overhead.

For a defensible comparison, use the same two physical devices and network, a random or
already-compressed 100 MiB/1 GiB file, and a batch of 100 small files. Measure both
first-file setup and total time through receiver finalization, verify output hashes,
record peak memory/CPU, and repeat at least five times. Compare median and slow runs
against the other application under identical conditions. Also test a slow receiver,
Wi-Fi loss, and multiple senders. Never call same-machine loopback numbers Wi-Fi speed.

## Cross-platform support and release checks

The browser client targets current Windows, macOS, Linux, Android, iOS and iPadOS
browsers. One Windows/macOS/Linux computer runs the Node host; receiving devices do
not need Node or an installed app. This is a compatibility target, not certification
of every operating-system/browser combination or every 5 GB phone download.

| Platform | Browsers to validate | Receive path |
| --- | --- | --- |
| Windows | Edge, Chrome, Firefox | WebRTC for small files; direct disk saving where detected; native Downloads fallback |
| macOS | Safari, Chrome, Firefox | Same capability-based selection |
| Linux | Chrome/Chromium, Firefox | Same capability-based selection |
| Android | Chrome, Firefox, Samsung Internet | Native Downloads for large files; keep app visible |
| iPhone / iPad | Safari, plus any other browser claimed as supported | Native Downloads for large files; test on physical devices |

Use **choose files** on phones; drag-and-drop and clipboard file access are optional.
If native downloads are blocked, tap **start download**. Large files require enough
free device storage. The browser's Downloads UI is authoritative for relay save errors.
HTTPS is necessary for secure page/signaling/relay traffic, and for wake lock and
native direct-saving APIs where supported. Sharing a LAN URL over plain HTTP does
not enable those secure-context APIs on other devices.

`npm run test:compatibility` checks Chromium-to-Chromium/Firefox/WebKit transfers,
default routing, forced native downloads in both directions, absent-WebRTC fallback,
SHA-256 equality, mobile-width and short-screen consent layout, and mocked wake-lock
release/denial. These are
2 MiB transfer checks, not 5 GB mobile validation. `DRIFTSHARE_BROWSERS` can select a
comma-separated engine subset. `.github/workflows/compatibility.yml` runs the suites
on Windows, macOS and Linux when pushed to GitHub; adding the workflow does not mean
those remote checks have already passed. Playwright WebKit is not actual iOS Safari.

Before claiming a platform is supported, record its OS/browser version and test:

- Send and receive an empty file, photo, 129 MiB file and actual 5 GB file; verify hashes.
- Send to four devices including a slow phone; decline/cancel one and verify the rest.
- Deny download permission, fill storage, switch apps, lock the screen and lose Wi-Fi;
  verify an understandable failure and successful retry instead of false completion.
- Test touch controls, filenames in multiple languages, portrait/landscape layout,
  HTTPS trust, device discovery and QR/link joining on the actual network.

## Repeatable physical-device benchmark

Use a Windows laptop with Chrome and an Android phone with Chrome as the first pair.
Record actual OS/browser/app versions, Wi-Fi band, link rate, host placement and route.
Also test Mac/Safari, Linux/Firefox and iPhone/Safari before making broader claims.
Install LocalSend and host PairDrop locally before going offline; all measurements
must use the same devices, direction, network, payload and save destination.

```sh
node scripts/benchmark.cjs generate ./benchmark-files 104857600
node scripts/benchmark.cjs generate ./benchmark-files 1073741824
node scripts/benchmark.cjs compare ./benchmark-files/fixture-104857600.bin.json ./runs.json
```

Generation writes random payloads incrementally and records their SHA-256 hashes.
It refuses to overwrite existing fixtures. Run each app/route at least five times,
including receiver save completion; hash every received file. Keep ZIP preparation
and human acceptance timing consistent and record them separately. Compare failure
recovery and a four-recipient run separately from one-to-one throughput.
`runs.json` is an array of real measurements with these fields per run:
`app` (DriftShare/LocalSend/PairDrop), `bytes`, `seconds`, `sha256`, `devicePair`,
`network`, and `route`. The comparator rejects mismatched files/hashes or mixed
networks/devices and reports median/worst times and median MiB/s. Fewer than five
runs are labelled incomplete. No competitor measurements are fabricated.

DriftShare's **Export results** is supporting evidence, not the benchmark finish
clock: relay completion measures host delivery to Downloads, not final disk commit.
The physical-device comparison is pending; automated same-machine tests cannot
establish which application is faster on Wi-Fi.

Remaining work: persistent resume after closing tabs/host restart, native Resume
testing beyond Chromium, simpler device trust onboarding, physical-device performance
comparisons, and mobile large-file qualification. A fully offline browser cannot
silently install a trusted certificate on another device.

## Layout

```text
server.js             HTTP(S), private join authentication, signaling and limits
relay.js              Bounded live LAN-host streaming to native browser downloads
public/protocol.js    Shared validation, limits and incremental CRC32
public/archive.js     Bounded-read ZIP/ZIP64 folder and batch preparation
scripts/             Offline HTTPS setup and verified benchmark tooling
public/client.js      Queue, WebRTC, flow control, disk/memory output and UI
public/index.html     Accessible interface
public/style.css      Offline-capable responsive styling
test/                 Node regression and real-browser integration tests
```

The repository originally tracked `node_modules`. Existing tracked dependency files may
therefore show updates after installing security fixes. New dependency folders are
ignored; `package-lock.json` is the reproducible dependency source for `npm ci`.
