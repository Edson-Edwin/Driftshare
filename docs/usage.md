# Sending and receiving files

[Documentation home](README.md) · [Troubleshooting](troubleshooting.md)

## Select recipients

Click a device in **Nearby devices** to select it; click it again to deselect it.
Select several devices to send each a separate copy. The selected recipients are
captured when files are queued. Changing the selection later affects new files,
not deliveries already in the queue.

The browser runs up to **four outgoing recipient deliveries concurrently**, with
one file per recipient at a time. Additional recipients wait for a slot. Waiting
for acceptance and paused relay deliveries also occupy slots. Cancel an unwanted
pending delivery to release its slot. Receiving while sending is supported.

The queue accepts up to 1,000 deliveries: ten files for four recipients means
40 deliveries. Server-side participant limits can still reject a flood of offers
from several senders. Each recipient independently accepts, declines, or cancels;
one recipient's failure does not intentionally cancel the others.

## Choose a receive method

The incoming dialog describes the route before acceptance.

| Method | When to use it | What completion means |
| --- | --- | --- |
| **Save directly to disk** | The browser offers the option on a trusted secure context | Received length and CRC32 match; the native writer closed successfully |
| Small-file WebRTC download | Direct saving is unavailable or unchecked and the shared memory budget allows the file | The verified file is retained in the tab; click **save file** to download it |
| **Use browser Downloads via LAN host** | Large files without direct saving, unavailable/blocked WebRTC, or a preference for native Downloads | All bytes were sent to the browser download response; check Downloads for final save success |

Direct disk saving depends on `showSaveFilePicker`; it is not available everywhere.
See the [browser API reference](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker).
The app detects support instead of assuming a particular operating system supports it.

When either endpoint lacks the WebRTC API, the app requires the LAN-host route.
A browser can expose WebRTC while the network blocks its connections. In that case,
retry the file and choose the LAN-host option manually on the receiver.

Small received files share a **128 MiB aggregate payload budget**. This is not a
per-file transfer limit or a cap on the browser's total memory. Retained completed
files still consume that budget until removed. Larger files use the host route if
direct disk saving is not selected.

If a native download does not start automatically, click **start download** in the
transfer card. Browser download permissions and storage errors are handled by the
browser; inspect its Downloads manager if the page appears finished but the file
has not saved.

## Files, folders, and batches

Use **choose files**, drag files into the drop area, or paste files when your browser
supports clipboard files. File selection is the most portable option on phones.

Use **choose folder** for a folder archive. Alternatively, check **Bundle selected
files into one ZIP / one acceptance** before choosing files. Each recipient receives
one archive and accepts once. Without bundling, each file has a separate offer.

Archive behavior:

- ZIP uses store mode: it preserves bytes without compression. Compressible content
  will not get smaller, and headers make the archive slightly larger than its inputs.
- Folder-relative paths are preserved. Empty directories are omitted.
- Up to 1,000 files are accepted; archive metadata and content together must fit within
  5,000,000,000 bytes. The preflight metadata estimate is conservative.
- Preparation reads every source file to calculate CRC32 before transfer. Progress
  and **Cancel preparation** are available. A large folder can therefore take time
  before any recipient sees an offer.
- Unsafe paths, Windows-reserved names, trailing dots/spaces, and case-insensitive
  or Unicode-normalized duplicate paths are rejected. Rename conflicting files.
- Original timestamps and filesystem permissions are not preserved; archive date
  metadata is deterministic. This is file sharing, not a filesystem backup tool.
- The browser's folder chooser and the receiver's ZIP/ZIP64 extraction support vary.
  Test your devices before relying on multi-gigabyte archives.

Cancelling preparation does not send a partial archive. Selecting different devices
while preparation runs does not retarget that archive to the new selection.

## Read progress correctly

The UI shows bytes, a smoothed transfer rate, and an estimated remaining time.
Rates may change during startup, storage writes, or congestion. WebRTC progress uses
receiver acknowledgments. Relay progress counts bytes passing through the host;
it cannot confirm that a native download has been committed to storage.

A `MiB/s` is 1,048,576 bytes per second. Network link rates commonly use megabits per
second (`Mbit/s` or `Mbps`). **3 MiB/s is about 25.2 Mbit/s**. These are different
units, and link rate includes overhead rather than guaranteeing file throughput.

Direct transfers check exact length and incremental CRC32. CRC32 detects accidental
corruption, not a malicious sender. The relay enforces byte length but does not run
the direct path's application-level CRC exchange. For independent verification,
compare SHA-256 hashes of the source and saved file using [Benchmarking](benchmarking.md).

## Cancel, retry, and resume

**Cancel** stops the selected queued, offered, or active delivery. It invalidates
its relay capability. It does not delete a file already saved in the receiver's
Downloads folder. Browser-managed partial files may require cleanup in Downloads.

**Retry** creates a new attempt from the beginning. It targets the original recipient
if that peer is online. If the original peer has disconnected, select exactly one
replacement before retrying. Retry does not broadcast the file to every selected
peer. Unfinished source-file references remain in the tab for retry; a reload loses
them. Completed outgoing references are released, so reselect a completed file to
send it again.

**Resume** is different and applies only to interrupted LAN-host downloads:

1. Keep the sender tab, receiver tab, and Node host open.
2. Restore the network connection and let the original tabs reconnect.
3. Within 15 minutes, open the receiver's browser Downloads manager and use **Resume**
   if offered. Some browsers attempt recovery automatically.
4. Verify the final file in Downloads. The sender transmits the requested suffix.

A paused delivery occupies its recipient slot until resumed, cancelled, or expired.
A new download started from the page starts at byte zero. Resume cannot recover from
source-tab closure/reload, host restart, expiry, explicit cancellation, or a relay
session that the host has already completed. WebRTC transfers restart on retry.
Actual native interruption/recovery is tested in Chromium; other browsers may restart
instead and need device validation.

## Save, clear, and export

Save any small received files you need before **remove** or **Clear finished**.
Removing cards releases their retained browser-memory files; it does not remove
already saved files from your filesystem. Reloading loses the in-page history.

**Export results** downloads `driftshare-results.json`. It contains `exportedAt` and
one entry per current transfer card, including filename, device label, direction,
size, status, route, resumed offset, elapsed seconds when available, and a description
of what completion means. Entries cleared before export are no longer present.
Failed or pending entries are not successful deliveries even if the schema contains
a completion-description field. Relay timing is not a confirmed disk-save benchmark.

The export omits join codes and transfer tokens, but filenames and device labels may
still be personal. Review it before attaching it to an issue.

## On phones and tablets

Keep the page visible and the device awake. Wake lock is requested when supported
and released when idle; browser refusal does not block a transfer. Switching apps,
locking the screen, or entering battery-saving mode may suspend the browser.
Make sure the device has enough free storage. Start with a small file, then test a
larger one before trusting a 5 GB transfer on an unqualified device.
