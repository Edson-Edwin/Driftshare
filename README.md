# DriftShare

**Share files across devices on your local network, straight from a browser.**

DriftShare runs on one Node.js host. Other devices join its local address, enter a
four-digit code, and accept files in their browsers. It supports files up to
**5 GB**, multiple recipients, folder archives, and resumable LAN-host downloads.
After installation, sharing works without an internet connection or cloud account.

[Get started](docs/getting-started.md) · [User guide](docs/usage.md) ·
[Documentation](docs/README.md) · [Contribute](CONTRIBUTING.md) · [MIT license](LICENSE)

## Quick start

Install **Node.js 22 or newer** and Git on the computer that will host DriftShare.
Then run these commands in Terminal or PowerShell:

```sh
git clone https://github.com/Edson-Edwin/Driftshare.git
cd Driftshare
npm ci
npm start
```

1. Connect your devices to the same local network.
2. Open a **private join link printed in the host terminal** on each device. You can
   also open the host address and enter the four-digit code.
3. Select one or more devices, then choose or drop files.
4. Accept on each receiving device. Keep the host and both browser tabs running.

The default HTTP port is `4000`. A phone must open the host's LAN address, such as
`http://192.168.1.8:4000`, not `localhost`. The example IP is only illustrative;
use the address printed by your host.

HTTP is suitable only for a trusted LAN: it does not encrypt the page, signaling,
or relayed file bytes. For fully offline HTTPS, install OpenSSL on the host and run:

```sh
npm run start:secure
```

This creates a local certificate authority and serves HTTPS on port `4443`.
Each device must trust the public root certificate once. Follow the
[offline HTTPS guide](docs/security.md) before sharing sensitive files.

## Features

| Feature | What it does |
| --- | --- |
| Large files | Up to 5,000,000,000 bytes per file; streams large downloads instead of retaining the entire payload in JavaScript memory |
| Group sharing | Up to four outgoing recipient deliveries at once, with individual acceptance, progress, cancellation, and retry |
| Folders and batches | Creates an uncompressed ZIP/ZIP64 archive for one acceptance per recipient |
| Two transfer routes | Direct encrypted WebRTC, or a live stream through the LAN host into browser Downloads |
| Interrupted downloads | LAN-host downloads can resume within 15 minutes when the browser supports it and the original tabs remain open |
| Local joining | Four-digit code, private links, and optional locally generated QR codes |
| Offline operation | No cloud signaling, external fonts, external QR service, STUN, or TURN service configured by the app |
| Delivery records | Per-device totals and a JSON results export |

## Which devices can use it?

The client targets modern browsers on **Windows, macOS, Linux, Android, iOS, and
iPadOS**. Only the host computer needs Node.js. Receive options depend on browser
capabilities: direct disk saving requires a supported secure-context API; native
browser Downloads provides the large-file fallback.

This is a compatibility target, not a claim that every device/browser combination
has passed testing. Chromium, Firefox, and Playwright WebKit have automated tests;
Playwright WebKit is not physical iOS Safari. See the
[compatibility matrix and device checklist](docs/testing.md).

## Important limits

- **5 GB is decimal**, approximately 4.66 GiB. The 128 MiB limit shown for memory is
  a shared budget for small received files, not the maximum transfer size.
- Group sharing sends a separate copy to each recipient; all copies share bandwidth.
- Folders allow up to 1,000 files and a 5 GB archive including metadata. Empty
  directories are omitted, and ZIP preparation reads the source files once first.
- WebRTC retries restart from zero. Relay resume does not survive a source-tab reload,
  a host restart, expiry, or a completed relay session.
- **Sent to browser Downloads** means the host delivered the bytes to the download
  response. Check the browser's Downloads manager for the actual save result.
- Keep phones awake and the app visible. Background and locked-screen transfers
  are not guaranteed.
- This is a trusted-LAN tool, not an internet-facing file hosting service. The host
  remains part of the trust boundary, including when the payload uses WebRTC.

## Documentation

| I want to… | Read |
| --- | --- |
| Install, join, update, or prepare an offline host | [Getting started](docs/getting-started.md) |
| Send files, folders, groups, and resume a download | [User guide](docs/usage.md) |
| Set ports, interfaces, certificates, or a reverse proxy | [Configuration and hosting](docs/configuration.md) |
| Understand encryption, privacy, and certificate trust | [Security and privacy](docs/security.md) |
| Fix connection, speed, saving, or certificate problems | [Troubleshooting and FAQ](docs/troubleshooting.md) |
| Understand the code and transfer protocol | [Architecture](docs/architecture.md) |
| Run tests or qualify a real device | [Testing](docs/testing.md) |
| Measure speed and compare applications fairly | [Benchmarking](docs/benchmarking.md) |
| Report a bug or submit a pull request | [Contributing](CONTRIBUTING.md) |
| Report a security concern | [Security policy](SECURITY.md) |
| See changes and remaining work | [Changelog](CHANGELOG.md) and [roadmap](docs/roadmap.md) |

## Development

There is no frontend build step or database. The server uses Node.js, Express, and
`ws`; the client uses plain JavaScript, HTML, and CSS.

```sh
npm ci
npm run check
npm test
```

For browser tests, install the required Playwright browsers first. See
[Testing](docs/testing.md) for commands, system dependencies, and test limitations.
The [contribution guide](CONTRIBUTING.md) explains the review workflow.

## License and dependencies

DriftShare is distributed under the [MIT license](LICENSE). Third-party packages
retain their own licenses. The repository historically tracked `node_modules`;
`package-lock.json` and `npm ci` are the dependency installation source of truth.
See [Contributing](CONTRIBUTING.md) before changing dependency files.
