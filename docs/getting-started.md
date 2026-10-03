# Getting started

[Documentation home](README.md) · [Next: user guide](usage.md)

## What you need

| Component | Requirement |
| --- | --- |
| Host computer | Windows, macOS, or Linux with Node.js 22+ and npm |
| Source download | Git, or an extracted source archive from this repository |
| Sending and receiving devices | A modern browser and access to the host's local address |
| Network | A local network allowing devices to communicate; guest/client isolation may prevent this |
| HTTPS launcher | OpenSSL available as `openssl` on the host's command path |
| QR codes | Optional `qrencode` executable on the host |
| Free space | Enough space on receiving devices for files and any browser temporary downloads |

Get Node.js from its [official download page](https://nodejs.org/en/download).
Check the installed tools:

```sh
node --version
npm --version
git --version
```

Node.js is needed only on the host, not on every phone or receiving computer.
The host can also send and receive through its own browser. There is no supported
native mobile host package, account registration, database, or frontend build step.

## Install and start

```sh
git clone https://github.com/Edson-Edwin/Driftshare.git
cd Driftshare
npm ci
npm start
```

`npm ci` installs versions from the lockfile. It normally needs internet access or a
prepared npm cache. Do not treat the checked-in legacy dependency folder as a complete
installation. `npm start` runs the server in the foreground; keep that terminal open.

The terminal prints a random four-digit code and one or more private join links.
The default address uses HTTP and port `4000`. The code changes after a restart
unless you explicitly configure `ACCESS_CODE`.

For a runtime-only installation, `npm ci --omit=dev` excludes the browser-test tooling.
You will need a full `npm ci` before running browser tests later.

## Join from a second device

1. Connect both devices to the same trusted LAN or reachable local subnet.
2. Open the host's printed private link in the receiving browser. Alternatively,
   type its address and then the code from the host terminal.
3. Confirm the status changes to connected and the other browser appears in
   **Nearby devices**.
4. Use **Rename** if a label would be confusing. Device names are browser labels,
   not verified operating-system identities.

The `#code=…` fragment grants access. Share the full link only with intended peers.
The app removes the fragment from the address bar after reading it and remembers
its code in session storage. A copied URL after that removal may no longer contain
it; use **Join → Copy link** to copy a fresh private link.

`localhost` always refers to the device opening the page. A phone opening
`http://localhost:4000` will not reach your laptop. Use the laptop's LAN IP printed
by DriftShare. If there are several addresses, use **Join → Network address** to
choose the interface reachable by the other device.

A browser sees the other authenticated browser sessions connected to this host.
DriftShare does not scan the LAN for every physical device. Another tab on the same
computer may appear as another peer; the current socket itself is excluded.

## Send your first file

1. On the sender, select the receiving device.
2. Click **choose files** and select a small test file.
3. On the receiver, inspect the sender label, filename, size, and receive route.
4. Click **Accept**. If a save dialog opens, choose a destination.
5. If the completed card offers **save file**, click it before clearing the card.
   For a LAN-host download, inspect the browser's Downloads manager.
6. Open the saved file to confirm the setup works before trying a large transfer.

See [Usage](usage.md) for group transfers, folders, and resume behavior.

## Use offline HTTPS

For an authenticated, encrypted page and relay, first check OpenSSL:

```sh
openssl version
npm run start:secure
```

The launcher defaults to port `4443`. It creates certificates in `.driftshare-tls/`
and prints the public certificate path and SHA-256 fingerprint. Trust that public
certificate on each device, following [Security and privacy](security.md).
Certificate warnings are expected until trust is configured correctly; clicking
through a warning is not equivalent to trusted HTTPS.

No internet connection or domain name is needed to generate these local certificates.
The launcher does not install trust for you. You must run either the regular server
or the HTTPS launcher for the address you intend to share; running both creates
separate in-memory hosts and separate device lists.

## Prepare for an internet-free session

Install Node.js, dependencies, and optional tools while you still have access to
their installers. Generate and distribute the public HTTPS root certificate in
advance if you need secure access. If you also want to run browser tests offline,
install the Playwright browsers and OS libraries beforehand.

Then disconnect internet access while keeping the local network running. Start
DriftShare and verify a transfer between two local devices. The app serves its UI
locally and does not configure an external discovery, QR, font, STUN, or TURN service.
The host must remain reachable: offline operation does not mean the host can be shut
down or that pages are installed as a standalone offline application.

## Stop, restart, or update

Wait for active transfers to finish, save received small files, and export any
results you want to retain. Stop the server with **Ctrl+C**. Restarting clears peers,
transfer state, and resume capabilities. It also changes the random code.

For a clean Git checkout, update with:

```sh
git status --short
git pull --ff-only
npm ci
npm run check
npm test
npm start
```

If `git status` shows your own edits, preserve them before pulling. Do not reset them
just to follow these instructions. Legacy tracked dependency files may also show
changes after installation; see [Contributing](../CONTRIBUTING.md).
For HTTPS use `npm run start:secure` in place of `npm start`. Refresh client tabs
and use the new join links after an update or restart. Preserve `.driftshare-tls/`
to keep the same trusted CA, and keep its private keys protected.

## Next steps

- [Configuration](configuration.md) for ports, interfaces, and fixed codes.
- [Troubleshooting](troubleshooting.md) if a device cannot connect.
- [Security](security.md) before using a network you do not fully trust.
