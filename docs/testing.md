# Testing and platform qualification

[Documentation home](README.md) · [Benchmarking](benchmarking.md)

## Install test dependencies

Use Node.js 22+ and a full dependency install:

```sh
npm ci
npm run check
npm test
```

`npm run check` parses the server, client, protocol, archive, and helper scripts; it is
not a linter or a full application test. `npm test` uses Node's built-in test runner.
Tests start local ephemeral-port servers; your environment must permit loopback sockets.
OpenSSL enables the offline HTTPS test; that test is skipped if OpenSSL is missing.
Check the final test summary for skips instead of treating exit code zero as full coverage.

For browser suites, install the versions matching the locked Playwright package:

```sh
npx playwright install chromium firefox webkit
```

Linux may also require browser system libraries. On a supported system, the official
installer can install browsers and those dependencies together:

```sh
npx playwright install --with-deps chromium firefox webkit
```

This can install OS packages and require administrator privileges. Consult the
[Playwright browser setup guide](https://playwright.dev/docs/browsers) for supported
systems and install requirements. Prepare these dependencies before going offline.

## Commands and what they prove

| Command | Coverage | Limits / resources |
| --- | --- | --- |
| `npm run check` | JavaScript syntax | No runtime assertions |
| `npm test` | Protocol, ZIP, benchmark comparator, offline TLS, authentication, authorization, relay, and resume ranges | Local Node tests; OpenSSL test can skip |
| `npm run test:browser` | Chromium joining, direct transfers, disk writing, errors, backpressure, group queue, folders, native relay downloads, labels, and responsive UI | Writes test downloads/screenshots in a temporary directory; uses 129 MiB relay fixtures |
| `npm run test:compatibility` | Chromium reference peer against Chromium/Firefox/WebKit, route choices, exact bytes, missing-RTC fallback, wake-lock behavior, and small-screen layout | Small payloads around 2 MiB; not physical phones |
| `npm run test:resume` | Real Chromium Downloads interruption/recovery and a smaller resumed upload with exact final bytes | Approximately 8 MiB; Chromium-specific CDP and Downloads UI |
| `npm run test:large` | Actual 5,000,000,000-byte relay stream, hashes, and server memory growth | Loopback Node HTTP, not browser or Wi-Fi speed; no 5 GB fixture saved |
| `npm run test:archive-large` | Chromium ZIP64 metadata with a 4 GiB + 17 byte source, sampled JS heap bound | Creates a sparse source in temporary storage; reads the full logical size; no full ZIP saved |

Run the relevant browser commands after installation:

```sh
npm run test:browser
npm run test:compatibility
npm run test:resume
```

Run the two large boundary checks when changing transfer size, streaming, memory,
archive layout, or release qualification:

```sh
npm run test:large
npm run test:archive-large
```

The large archive source is logically over 4 GiB. Filesystem sparse-file support and
free space differ; allow sufficient temporary storage and CPU time. Its heap result
is not total browser memory or operating-system RSS. The browser suite prints the
location of retained screenshots/download artifacts; remove those generated artifacts
when no longer needed. Do not commit them as production files.

## Browser selection and environment

Use an existing Chrome binary for Chromium-based tests if appropriate:

```sh
CHROME_PATH=/usr/bin/google-chrome npm run test:browser
```

PowerShell example, adjusting the path to your installation:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

An arbitrary installed Chrome version may differ from Playwright's tested bundled
revision. Record which executable you used. `CHROME_PATH` applies to the Chromium
launches in these scripts; it does not replace Firefox or WebKit binaries.

A focused compatibility subset:

```sh
DRIFTSHARE_BROWSERS=chromium,firefox npm run test:compatibility
```

PowerShell:

```powershell
$env:DRIFTSHARE_BROWSERS = 'chromium,firefox'
npm run test:compatibility
```

| Test variable | Purpose |
| --- | --- |
| `CHROME_PATH` | Optional Chromium/Chrome executable path |
| `DRIFTSHARE_BROWSERS` | Comma-separated compatibility engines; defaults to `chromium,firefox,webkit` |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright-managed browser binary directory, when overriding its default |
| `DRIFTSHARE_TEST_BYTES` | Node relay test payload size; the large-test wrapper explicitly sets 5,000,000,000 |

Clear custom application environment variables such as `PUBLIC_URL`, `TLS_CERT`, and
`TLS_KEY` before running isolated tests unless the test explicitly requires them.
Production-host settings can otherwise affect a loopback test's origin or scheme.

## What the browser checks actually exercise

The main browser suite uses isolated Chromium contexts and real WebRTC connections.
It verifies empty and random files, connection reuse, simultaneous directions,
independent recipient cancellation/decline/retry, oversend and checksum rejection,
and sender backpressure with a deliberately stalled writer.

For automated direct-save testing, the interactive picker is replaced with a real
OPFS file handle. Writes and close operations remain native, but this does not test
a user's actual operating-system picker permissions or every filesystem. Native
relay downloads are separately hashed after retrieval. Wake-lock denial/release
is mocked for deterministic assertions and does not prove real phone behavior.

## Continuous integration

[The compatibility workflow](../.github/workflows/compatibility.yml) declares Linux,
Windows, and macOS jobs with Node.js 22. Each installs dependencies and the three
browser engines, then runs syntax, Node, main browser, compatibility, and resume checks.
The two large boundary tests are not in the default workflow.

Check the [Actions page](https://github.com/Edson-Edwin/Driftshare/actions) for the actual
commit's results. A workflow definition is not evidence that every job has passed.
No physical Android or iOS device participates in this workflow.

## Compatibility target

| Platform | Browser candidates | Qualification needed |
| --- | --- | --- |
| Windows | Edge, Chrome, Firefox | Native saving, Downloads, firewall, and large files |
| macOS | Safari, Chrome, Firefox | TLS trust, save behavior, large files, and cancellation |
| Linux | Chromium/Chrome, Firefox | Distribution/browser libraries, certificate stores, and downloads |
| Android | Chrome, Firefox, Samsung Internet | Real storage, downloads/resume, battery restrictions, and background suspension |
| iOS / iPadOS | Safari and any additional browser being claimed | Actual device trust, Downloads, ZIP extraction, and foreground/lock behavior |

These are targets to validate, not a list of certified combinations. A narrow viewport
is not a phone, and Playwright WebKit on a desktop OS is not iOS Safari.

## Physical-device acceptance checklist

Record the commit, OS/browser versions, host, network, route, and available storage.
Use files you can share for testing, and verify the saved bytes.

- Join via code, private link, and QR when available; verify names and rename behavior.
- Send and receive zero bytes, a photo, 129 MiB, and an actual 5 GB file.
- Exercise direct saving when available and forced native Downloads in both directions.
- Send a folder with Unicode names and nested paths; extract and compare files.
- Send to four recipients including a slower device; decline/cancel one and check the rest.
- Interrupt Wi-Fi, deny a save, test insufficient storage, lock the screen, and switch apps.
  Confirm truthful failure/recovery and no false saved-to-disk claim.
- Test eligible relay resume within its window and failure after expiry or source reload.
- Check touch and keyboard operation, focus order, consent visibility, landscape layout,
  screen-reader labels, and readable status/error messages.
- Check trusted HTTPS with the actual device store and an appropriate host address.

Attach the filled observations to a PR or release record. Report failures and untested
cases alongside successes. Do not label a platform fully supported based only on a
small local browser test.
