# Changelog

User-visible changes are recorded here. Entries under **Unreleased** describe the
current development work, not a published/tagged release. Package version metadata
and retrospective Git author dates do not establish a release date.

## Unreleased

### Added

- Four-digit joining, private links, optional local QR generation, and persistent
  browser device labels.
- Direct WebRTC transfer with receiver flow control, connection reuse, exact-length
  and CRC32 checks, and supported native disk saving.
- Files up to 5,000,000,000 bytes through direct saving or bounded live LAN-host downloads.
- Multiple recipients with four outgoing slots, individual consent, queues, cancellation,
  targeted retry, per-device results, and JSON export.
- Folder and batch ZIP/ZIP64 preparation with portable-path validation.
- Resumable interrupted LAN-host downloads within a bounded live session.
- Offline HTTPS launcher with a local CA and startup-based leaf renewal.
- Node/browser regression tests, cross-platform CI configuration, large-file boundary
  checks, and a verified-fixture benchmark tool.
- Detailed user, hosting, security, architecture, testing, and contributor documentation.
- MIT licensing and issue/pull-request templates.

### Security and reliability

- Authentication and participant authorization before discovery/transfer negotiation,
  code-attempt limits, origin checks, bounded offers, and timeout cleanup.
- Incremental payload handling, cancellation cleanup, and attempt guards for resumed streams.
- Route-specific completion wording that distinguishes host delivery from native disk save.

### Known limitations

- Relay recovery requires original tabs and host to remain available; direct retries
  start from zero. Completed host sessions cannot resume a later failed native save.
- Native resume beyond Chromium and physical mobile 5 GB behavior need validation.
- Offline HTTPS requires manual device trust; no automatic trust installation exists.
- Physical-device competitor throughput comparisons remain pending.

See the [roadmap](docs/roadmap.md) for priorities and [testing guide](docs/testing.md)
for the distinction between automated checks and platform qualification.
