# Troubleshooting and FAQ

[Documentation home](README.md) · [Report a bug](../CONTRIBUTING.md)

## A device cannot open the page

Check the host terminal is still running and use its printed address and port.
`localhost` on a phone points to the phone, not the host computer. Confirm both devices
have a route to the host, the firewall allows that local connection, and the network
has not enabled guest/client isolation. Try a different printed interface if a VPN or
virtual adapter is present. Do not disable the entire firewall or expose a router port
to the internet to solve a local connectivity problem.

For HTTPS, confirm the correct scheme and port. The normal server defaults to `4000`;
the secure launcher defaults to `4443`. Binding `HOST=127.0.0.1` intentionally prevents
remote access. The host can print detected addresses even when that binding prevents
connections through them.

## The page opens but no devices appear

Each participating browser must open the **same host instance** and authenticate with
its current code. Opening two separately running servers creates two independent lists.
Discovery means authenticated sessions on this host, not every device on the Wi-Fi.
Check connection status, WebSocket failures in browser developer tools, and proxy
upgrade/origin settings if applicable. Another tab on the same machine may be listed
as another device; use **Rename** to distinguish it.

## The code is rejected or joining is temporarily blocked

Use the current four-digit code, preserving any leading zero. A random code changes
after restart. An old tab can remember the old code in session storage. Use the new
private join link or enter the new code when prompted.

Five wrong code attempts in a minute from the same connection IP can trigger a temporary
limit across reconnects and the QR endpoint. Wait at least a minute before trying the
correct code. Behind a proxy, multiple users can share that IP bucket.

## QR code unavailable

QR generation needs `qrencode` installed on the host and available on its command path.
The copyable private link works without it. A missing executable or a busy generator
can produce an unavailable message; use **Join → Copy link**. This app does not send
join links to an external QR service.

## A file is stuck waiting or queued

The receiver must accept each file or archive. The sender permits four active recipient
deliveries and one file per recipient. An unanswered offer or paused download occupies
a slot. Accept, decline, resume, or cancel those deliveries before expecting queued ones
to start. Offers expire after roughly two minutes; server cleanup runs periodically.
Several independent senders can also reach the host's per-participant offer limits.

## Direct transfers fail but devices are visible

Signaling can work even when WebRTC traffic is blocked by the network. Retry and choose
**Use browser Downloads via LAN host** on the receiver. If that works, compare network
policies and browser capabilities before changing the application stack. The app uses
no external TURN server to bypass network restrictions.

## Speed is only 2–3 MiB/s

First record the route, device/browser versions, Wi-Fi band, and whether the host uses
Wi-Fi or Ethernet. MiB/s and Mbps are different: 2–3 MiB/s is approximately 16.8–25.2
Mbps. A displayed wireless link rate is not the same as useful application throughput.

Measure one recipient and one file first. A Wi-Fi host relaying between Wi-Fi devices
uses shared airtime for incoming and outgoing copies. Where available, compare an
Ethernet-connected host and a less congested faster Wi-Fi band, using the same devices
and payload. Close other transfers and check receiver storage speed. Direct saving
may avoid the host payload hop when the browser/network supports it.

Do not infer a software bottleneck from the speed number alone. Follow
[Benchmarking](benchmarking.md), record hashes and full save completion, and compare
before/after under identical conditions. More recipients multiply traffic; more
parallel channels or a different server language does not automatically increase speed.

## Why does it mention 128 MiB when I need 5 GB?

128 MiB is the aggregate budget for small files retained in a receiving tab. The file
limit is **5,000,000,000 bytes**, approximately 4.66 GiB. A file of 5 GiB exceeds it.
Use direct saving when supported, or native Downloads through the host. Clear saved
small-file cards to release their memory. A ZIP must fit the limit including metadata.

## The file says complete but is not in my folder

Read the route-specific label:

- A small WebRTC file can still be in browser memory. Click **save file** before
  clearing its card or reloading the page.
- **Sent to browser Downloads** confirms host delivery, not final disk commit. Open
  Downloads and inspect the destination, blocked-download prompts, cancellation,
  storage errors, and any remaining partial file.
- Direct disk saving uses the destination chosen before acceptance. Check that location.

The app does not delete files you already saved when you clear a card. It cannot recover
an unsaved in-memory file after the page is reloaded.

## Save directly to disk is unavailable

The option requires both a secure context and the browser's native file-picker API.
LAN HTTP generally does not provide that secure context. `localhost` may behave
differently during local tests. Even with HTTPS, a browser may not implement the API.
Use **browser Downloads via LAN host** instead; that route supports large files without
requiring this picker. See [Usage](usage.md) for the completion distinction.

## Resume is missing or starts from zero

Resume applies only to an interrupted LAN-host download while its original consent
and source tab remain available. Use the browser's Downloads **Resume**, not the page's
**retry** or a new **start download**. The browser must request an accepted byte range.
Some browsers restart rather than resume. Reloads, host restarts, cancellation,
expiry, and already completed host sessions invalidate recovery. WebRTC retry always
restarts. Keep both tabs open and reconnect within 15 minutes.

## Transfers stop when a phone locks or switches apps

Browser background suspension can stop the file source, receiver, or signaling.
Keep both devices awake and the page visible. Wake lock is best-effort and may be
unsupported or denied. Check battery-saving settings, then retry or use native
Downloads resume when eligible. Reliable background mobile transfer is not a current
feature; do not interpret it as a guarantee from a successful desktop test.

## A folder is rejected or takes a long time to prepare

Preparation reads files to calculate checksums before sending. Watch the preparation
progress or use **Cancel preparation**. Split folders with more than 1,000 files or
archives that would exceed 5 GB. Rename Windows-invalid or colliding paths; for
example, `notes.txt` and `NOTES.txt` collide for portability purposes. Empty directories
are omitted. If the browser lacks a usable folder chooser, select files or create an
archive outside DriftShare, then send it as an ordinary file within the size limit.

## HTTPS certificate warnings

Verify all of the following:

1. You imported the public root from this host and checked its fingerprint.
2. The browser actually uses the store in which you enabled trust. iOS additionally
   needs full trust enabled after installing a profile.
3. The address matches the certificate and the device date/time is correct.
4. You restarted the secure launcher after an IP change and before leaf expiry.
5. You did not delete/recreate the CA while devices still trust the old one.

Use the [security guide](security.md). Do not share private keys or make warning-bypass
instructions the normal onboarding path. Managed-device trust restrictions may require
an administrator.

## OpenSSL, lock-file, or port startup errors

- **OpenSSL required:** install it on the host and confirm `openssl version` succeeds
  in the same shell used to launch DriftShare.
- **`setup.lock` already exists:** check that another certificate-setup process is not
  running. If a crashed process left the lock, remove only that stale lock after
  verifying no setup is active; preserve CA keys and certificates.
- **Incomplete or mismatched CA:** restore the matching trusted CA pair from your
  protected backup, or deliberately migrate to a new CA and update every device's trust.
- **`EADDRINUSE`:** another process uses the port. Stop your previous DriftShare instance
  or select another port using [Configuration](configuration.md).
- **Permission denied:** choose an unprivileged port and a certificate directory your
  user can access. Running the whole app as an administrator is not the default remedy.

## Browser tests fail before launching

Install browsers matching the locked Playwright version. On Linux, missing browser
system libraries can prevent startup independently of DriftShare. Use the official
[Playwright browser setup instructions](https://playwright.dev/docs/browsers) and the
[testing guide](testing.md). An OS unsupported by those browser binaries is not fixed
by changing a test assertion. Record whether the failure is setup, launch, or transfer.

## Collect useful diagnostics

Include the repository commit (`git rev-parse HEAD`), host OS and `node --version`,
sender/receiver OS and browser versions, HTTP or HTTPS, route shown, file bytes,
recipient count, network layout, exact error, and concise reproduction steps.
Attach sanitized console output or an exported results file if useful. Remove private
join links/codes, relay URLs/tokens, personal filenames, and private keys first.
Follow [Contributing](../CONTRIBUTING.md) for ordinary bugs and
[SECURITY.md](../SECURITY.md) for vulnerabilities.
