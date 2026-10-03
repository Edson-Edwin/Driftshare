# Measuring transfer performance

[Documentation home](README.md) · [Testing](testing.md)

## What a useful result measures

A speed claim needs a known payload, the same devices and network, an explicit route,
a clear timing boundary, and verified saved bytes. Same-machine loopback tests are
functional/resource checks; they do not establish Wi-Fi speed or superiority over
LocalSend, PairDrop, or another application.

Record setup/acceptance time separately from payload transfer and final save time.
For an end-to-end comparison, use the same starting event in every application and
finish only after the receiver has saved the full file. If you also report transfer-only
speed, state precisely where its clock begins and ends. Do not mix those timings.

## Prepare fixtures

Run from the repository root. Store generated files outside the checkout to avoid
accidentally committing them:

```sh
node scripts/benchmark.cjs generate ../driftshare-benchmark-files 104857600
node scripts/benchmark.cjs generate ../driftshare-benchmark-files 1073741824
```

These create random 100 MiB and 1 GiB payloads plus adjacent `.bin.json` manifests
containing the source path, byte count, and SHA-256 hash. The generator streams data
in blocks and refuses to overwrite files. It accepts integer sizes from 1,024 to
5,000,000,000 bytes; omitting the size generates 100 MiB. Allow enough disk space.

Use an existing matching fixture for repeat runs. If generation was interrupted,
remove only that known incomplete generated fixture before regenerating it, or use
a new directory. Do not compare hashes from two independently generated random files.

For small-file behavior, also measure a reproducible batch of 100 small files.
The current comparison script evaluates one fixture per invocation; it does not
automatically time or aggregate a multi-file batch. Record batch results separately.
When comparing archives, include or separately report ZIP preparation consistently.

## Record the environment

At minimum, retain:

- Repository commit and application versions for DriftShare and competitors.
- Host, sender, and receiver models, OS/browser versions, and transfer direction.
- Wi-Fi band/link information or Ethernet speed, access-point placement, and VPN use.
- Host placement, route shown by DriftShare, and recipient count.
- Source/destination storage, free space, payload hash/size, and timing definition.
- Warm-up procedure, repetitions, failures, and any excluded run with its reason.

Start with a Windows/Chrome laptop and Android/Chrome phone if available, then expand
to the devices you intend to support. Use the same pair, direction, network, and save
destination for every application in a comparison. Install all software before testing
fully offline; do not compare an offline LAN route with an unrelated cloud route.

## Verify saved files

Compare the source manifest hash with the saved file's SHA-256. Examples:

Linux:

```sh
sha256sum '/path/to/received/fixture-104857600.bin'
```

macOS:

```sh
shasum -a 256 '/path/to/received/fixture-104857600.bin'
```

PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 'C:\Users\YourName\Downloads\fixture-104857600.bin'
```

The comparator expects lowercase hexadecimal hashes. Normalize PowerShell's displayed
hash to lowercase when entering it. A matching hash and size support byte equality;
a successful progress bar alone does not.

## Measurement JSON

`runs.json` is an array. The following is a **template**, not a measured result.
Replace the placeholders and `null` with observations before using the comparator:

```json
[
  {
    "app": "DriftShare",
    "bytes": 104857600,
    "seconds": null,
    "sha256": "replace-with-the-verified-lowercase-sha256",
    "devicePair": "sender model and OS/browser -> receiver model and OS/browser",
    "network": "same access point, band, host connection and placement",
    "route": "via LAN host"
  }
]
```

| Field | Required value |
| --- | --- |
| `app` | Exactly `DriftShare`, `LocalSend`, or `PairDrop` |
| `bytes` | Integer matching the selected fixture manifest |
| `seconds` | Positive finite measured duration using the declared timing boundary |
| `sha256` | Verified received-file hash matching the fixture; lowercase 64-digit hexadecimal |
| `devicePair` | Nonempty description, identical across this comparison |
| `network` | Nonempty description, identical across this comparison |
| `route` | Nonempty route label; use a consistent label for repeated runs of the same route |

Collect at least five successful verified runs per application/route. Keep failures
in a separate record; do not fabricate durations or treat failed runs as completed.
The script accepts successful runs only, so its table does not itself report failure
rate. Supply the failure count when publishing results.

```sh
node scripts/benchmark.cjs compare ../driftshare-benchmark-files/fixture-104857600.bin.json ../driftshare-benchmark-files/runs.json
```

The comparator rejects size/hash mismatches, invalid durations, unsupported app names,
and mixed device/network descriptions. It groups by application and route, reports
run count, median time, worst time, and MiB/s calculated from the median time. A missing
application or fewer than five runs in a group produces an incomplete-comparison note.
It validates supplied records; it does not control the devices, verify your stopwatch,
or prove that a claimed environment was actually identical.

## Interpret throughput

`MiB/s = bytes / 1,048,576 / seconds`. One MiB/s is approximately 8.389 Mbit/s.
Theoretical network bit rate includes overhead and is not a guaranteed file rate.
In a relay transfer the host receives and sends a copy; a shared Wi-Fi medium or
slow host connection can become the bottleneck. Four recipients require four copies.
A slower receiver also affects that recipient's stream through backpressure.

Record peak CPU and memory when comparing implementations, including host and browser
processes. Keep browser JS heap, total process RSS, and system memory measurements
separate. The automated ZIP64 check reports sampled JS heap only.

**Export results** from DriftShare is useful supporting evidence. Its relay completion
clock stops at host delivery to browser Downloads, not confirmed final disk commit;
its per-card seconds also do not necessarily include human acceptance or preparation.
Do not silently substitute it for your end-to-end benchmark clock.

## Report a result responsibly

Publish environment details, fixture hash/size, timing definition, all measured runs,
failures, medians, and limitations. Compare one recipient before a four-recipient run,
and test interruption/recovery separately from uninterrupted throughput. Preserve
raw measurements so others can reproduce the conclusion.

No physical-device competitor ranking is established by this repository's automated
tests. A stack rewrite should follow profiling evidence of the bottleneck, not precede
measurement. Changing the Node host cannot accelerate a direct WebRTC payload path
that already bypasses it.
