# Roadmap and known limitations

[Documentation home](README.md) · [Changelog](../CHANGELOG.md)

These are areas for future work and validation, not promised release dates. Discuss
scope and evidence in an issue before undertaking a major implementation change.

## Reliability first

- Durable recovery after a source-tab reload or host restart. Current resume retains
  only in-memory consent, credentials, and live source-file references.
- Resume for direct WebRTC/disk-writer transfers. These currently retry from zero.
- Native Downloads resume validation beyond Chromium, especially physical phones.
- Broader testing of large files, storage exhaustion, background suspension, and
  archive extraction on actual target devices.

Any recovery design must preserve recipient consent, source-file identity, integrity,
authorization, and bounded resource use. Persisting credentials or file handles changes
the privacy and security model and needs review.

## Easier operation

- Simpler offline certificate onboarding without pretending browsers can silently
  trust a new CA. Native helpers or managed-device setup would be separate choices.
- Clearer operator diagnostics for network, storage, browser, and proxy bottlenecks.
- Maintained deployment examples and a deliberate cleanup of legacy tracked dependencies.
- A published platform qualification record with versions and repeatable observations.

## Measured performance

- Repeatable physical-device results against LocalSend and PairDrop on the same network.
- Separate throughput, first-file latency, preparation time, recovery cost, and group
  delivery measurements.
- Profile the actual bottleneck before changing chunking, concurrency, or the stack.

## Outside the current implementation

There is no cloud account service, internet peer discovery, external TURN fallback,
server-side stored-file inbox, native mobile host package, guaranteed background
transfer, or end-to-end encrypted host relay. Subpath deployment and a stable public
protocol API are also not provided. Proposals in these areas should explain how the
expanded scope fits the project's offline LAN use case.
