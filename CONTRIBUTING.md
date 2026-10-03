# Contributing to DriftShare

Thank you for helping make local file sharing more reliable. Documentation corrections,
reproducible bug reports, accessibility improvements, physical-device testing, and
focused code changes are all useful contributions.

[Documentation](docs/README.md) · [Architecture](docs/architecture.md) ·
[Tests](docs/testing.md) · [Security reporting](SECURITY.md)

## Before starting

Search [existing issues](https://github.com/Edson-Edwin/Driftshare/issues) and pull
requests for related work. For a significant feature, protocol change, or stack
replacement, describe the problem and proposed approach in an issue first. Small
fixes and documentation corrections can go directly to a pull request.

Keep the project's current scope in mind: browser clients, a trusted LAN host,
fully offline operation after installation, bounded large-file transfer, and truthful
status reporting. See the [roadmap](docs/roadmap.md) for known gaps. A proposal is not
a delivery promise or a guarantee it will be accepted.

Do not publish vulnerability details in an ordinary issue; use [SECURITY.md](SECURITY.md).

## Set up a development checkout

Fork the repository on GitHub and clone your fork, substituting your account below:

```sh
git clone https://github.com/YOUR-ACCOUNT/Driftshare.git
cd Driftshare
git remote add upstream https://github.com/Edson-Edwin/Driftshare.git
npm ci
npm run check
npm test
npm start
```

Use Node.js 22 or newer. There is no frontend build step. Edit the files under `public/`
and refresh the browser; restart the host after server changes. Use a test code or the
printed random code, and avoid real private files in test fixtures.

Create a focused branch:

```sh
git switch -c docs/clarify-download-resume
```

Choose a descriptive branch name for your change. Keep your branch current using your
normal Git workflow while preserving local changes; do not overwrite another contributor's
work to make a merge easier.

## Repository conventions

- Server/helper files use CommonJS; browser files are plain JavaScript without a build
  pipeline. Match the surrounding two-space style and existing module boundaries.
- Share validation/limit logic through `public/protocol.js` where appropriate.
- Keep payload handling incremental. Do not introduce full multi-gigabyte buffers,
  base64 encoding, or uncontrolled queued writes.
- Preserve recipient consent, participant authorization, attempt isolation, bounded
  memory, and accurate completion wording. Consult the architecture invariants.
- Handle cancellation, slow receivers, disconnects, duplicate messages, and late async
  callbacks explicitly when touching transfer code.
- Use accessible controls, keyboard operation, visible focus, readable mobile layouts,
  and safe rendering of untrusted labels/filenames.
- Avoid adding a dependency unless it materially improves correctness or maintainability.
  Update the lockfile with dependency changes and explain the reason in the PR.
- Keep unrelated formatting, refactors, generated files, certificates, and screenshots
  out of focused changes unless they are the actual subject of the PR.

The repository historically committed `node_modules`. Its existing tracked files can
show modifications even though new dependencies are ignored. Inspect `git status` and
stage explicit paths; do not blindly stage an entire dependency tree. Use `npm ci` and
the lockfile to reproduce dependencies. A cleanup of legacy tracked dependencies should
be a separate, clearly reviewed change.

## Validate your change

Always check the affected behavior. For executable changes, start with:

```sh
npm run check
npm test
git diff --check
```

Run relevant browser suites after changing UI or transfer behavior; follow
[Testing](docs/testing.md) to install browsers and system dependencies. Run large-file
boundary checks when changing streaming, archive sizes, memory, or offset handling.
Choose tests that exercise failures and observable behavior, not assertions that merely
repeat implementation details.

For documentation-only changes, verify relative links, shell differences, actual
configuration names, and commands against the current source. Do not add claims of
platform support, throughput, or test success without evidence. Examples should be
clearly labeled and free of live secrets. Update the guide for a changed behavior in
the same PR, and use [CHANGELOG.md](CHANGELOG.md) for a user-facing change summary.

## Submit a pull request

1. Make one coherent change or a small series of independently understandable changes.
2. Review `git diff` and stage the intended paths.
3. Use a commit subject describing the actual behavior, such as
   `fix: preserve relay attempt isolation after reconnect`.
4. Push your branch to your fork and open a PR against `main`.
5. Explain the problem, resulting behavior, tests run, and remaining limitations.
   Include screenshots for visible UI changes when helpful, with credentials removed.
6. Link relevant issues and respond to review feedback with the same scope in mind.

Use accurate authorship and timestamps for new contributions. Some historical commits
explicitly disclose retrospective author dates; that is not a contributor requirement
or evidence that work happened on those dates. Do not fabricate tests, benchmarks,
release dates, or historical activity.

By submitting code or documentation you are entitled to contribute, you agree that
it may be distributed under this project's [MIT license](LICENSE). Retain required
third-party notices. There is no separate contributor agreement described here.

## Good bug reports

Include a minimal reproduction, expected/actual behavior, the commit, host Node/OS
version, sender and receiver OS/browser versions, route, file byte count, recipient
count, and relevant network layout. Explain whether the problem also occurs with a
small file or the alternative route. Attach sanitized diagnostics and distinguish
application errors from missing test-environment dependencies.

Do not attach private source files, keys, join links/codes, relay tokens, or an unreviewed
results export. The [bug report form](https://github.com/Edson-Edwin/Driftshare/issues/new?template=bug_report.yml)
helps collect the useful details.

## Working together

Keep discussion respectful and focused on behavior and evidence. Critique code and
ideas without personal attacks, harassment, or sharing another person's private data.
Maintainers may redirect unrelated discussion or close abusive or out-of-scope requests.
This is a volunteer project; no response-time, platform-support, or delivery SLA is promised.
