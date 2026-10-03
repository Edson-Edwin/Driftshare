# DriftShare documentation

[Project home](../README.md)

Start with the guide for your task. These documents describe the implementation in
this repository; planned features are listed separately in the [roadmap](roadmap.md).

## For people sharing files

1. [Getting started](getting-started.md): requirements, setup, first transfer, offline
   preparation, updates, and shutdown.
2. [User guide](usage.md): receive routes, folders, multiple recipients, retry/resume,
   results, and file-size limits.
3. [Troubleshooting and FAQ](troubleshooting.md): discovery, slow transfers, downloads,
   certificates, storage, and diagnostics.

## For people running a host

- [Configuration and hosting](configuration.md): environment variables, Windows and
  POSIX shell examples, LAN exposure, and reverse-proxy requirements.
- [Security and privacy](security.md): threat model, transport encryption, locally
  generated certificates, retention, and cleanup.
- [Security policy](../SECURITY.md): reporting vulnerabilities without publishing secrets.

## For contributors and maintainers

- [Contributing](../CONTRIBUTING.md): development workflow, scope, coding conventions,
  review expectations, and licensing.
- [Architecture](architecture.md): modules, data paths, message flow, state, limits,
  and invariants.
- [Testing](testing.md): test commands, prerequisites, coverage, and physical-device checks.
- [Benchmarking](benchmarking.md): reproducible fixtures, result schema, hashes, and comparisons.
- [Roadmap](roadmap.md): known gaps, priorities, and evidence needed for release claims.
- [Changelog](../CHANGELOG.md): unreleased changes without invented release dates.

## Reading conventions

Commands run from the repository root unless a guide says otherwise. `sh` examples
use a POSIX shell such as Bash or Zsh; PowerShell alternatives are provided where
setting environment variables differs. Plain `npm` and `node` commands work in both.
Example addresses, codes, filenames, and measurements are illustrative, not credentials
or performance promises. A check marked as an automated test is not a substitute for
validation on your actual devices.

Found a documentation error? Open an [issue](https://github.com/Edson-Edwin/Driftshare/issues)
with the page and the step that failed, or submit a correction using
[Contributing](../CONTRIBUTING.md).
