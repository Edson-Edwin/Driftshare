# Configuration and hosting

[Documentation home](README.md) · [Security](security.md)

## Runtime settings

Set environment variables in the shell that launches the host. **The application
does not automatically load `.env` files.** The `.env` ignore rule only prevents
accidental commits; it is not a configuration loader.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` for `npm start`; `4443` for `start:secure` | HTTP(S) listening port; choose an available unprivileged port |
| `HOST` | `0.0.0.0` | Listening interface; all IPv4 interfaces by default |
| `ACCESS_CODE` | Random four-digit code on startup | Exactly four digits, including leading zeroes if desired |
| `PUBLIC_URL` | Origins generated from detected LAN IPv4 addresses | Explicit HTTP(S) origin used for join links and WebSocket origin validation |
| `TLS_CERT` | Unset | Path to the HTTPS server certificate for `npm start` |
| `TLS_KEY` | Unset | Matching HTTPS private key; required together with `TLS_CERT` |
| `DRIFTSHARE_TLS_DIR` | `.driftshare-tls` beneath the current working directory | Private certificate directory for `start:secure` |

There are no runtime environment settings for the file-size limit, queue concurrency,
chunk size, memory budget, or resume duration. Those are code-level constraints in
[the architecture reference](architecture.md). Do not assume changing an undocumented
variable changes these values.

`PUBLIC_URL` should be an origin only, such as `https://192.168.1.8:4443`, with no
credentials, application path, query, or fragment. The app appends its code fragment.
It does not configure DNS, port forwarding, TLS trust, or reachability.

## Shell examples

These use an illustrative fixed code. Keep your real code private and avoid a fixed
code unless you need it across restarts.

Bash or Zsh:

```sh
PORT=4001 HOST=0.0.0.0 ACCESS_CODE=5739 npm start
```

PowerShell:

```powershell
$env:PORT = '4001'
$env:HOST = '0.0.0.0'
$env:ACCESS_CODE = '5739'
npm start
```

PowerShell assignments remain in the current shell after the process exits. Remove
them when you want defaults again:

```powershell
Remove-Item Env:PORT, Env:HOST, Env:ACCESS_CODE -ErrorAction SilentlyContinue
```

To restrict a host to its own machine during development:

```sh
HOST=127.0.0.1 npm start
```

With that binding, other devices cannot connect even if the terminal lists LAN
addresses: address discovery is not a connectivity probe. Use `http://127.0.0.1:4000`
for the local-only setup.

## Native HTTPS with existing certificates

Use certificates valid for the exact shared hostname or IP, trusted by every client.
Pass both paths; supplying only one fails startup.

Bash or Zsh:

```sh
TLS_CERT='/absolute/path/server.crt' TLS_KEY='/absolute/path/server.key' npm start
```

PowerShell:

```powershell
$env:TLS_CERT = 'C:\DriftShare-certs\server.crt'
$env:TLS_KEY = 'C:\DriftShare-certs\server.key'
npm start
```

Setting these variables does not change the regular server's default port of `4000`.
Its URL becomes HTTPS on that port. The convenience `start:secure` launcher sets
certificate paths itself and uses `4443` by default. It generates certificates for
`localhost`, loopback IPv4, and detected LAN IPv4 addresses; arbitrary DNS names or
IPv6 addresses require a suitable separately managed certificate.

## Fully offline certificate generation

```sh
npm run start:secure -- --setup-only
```

This prepares certificates and exits without opening a listener. To store certificates
outside the checkout:

```sh
DRIFTSHARE_TLS_DIR='/absolute/private/certificate-directory' npm run start:secure
```

PowerShell:

```powershell
$env:DRIFTSHARE_TLS_DIR = 'C:\DriftShare-private\certificates'
npm run start:secure
```

Use a directory accessible only to the host operator. On Windows, verify the folder's
ACLs: POSIX permission bits alone do not establish Windows access policy. The launcher
never changes client trust stores. See [certificate lifecycle](security.md).

## Network and firewall setup

Allow incoming TCP connections to the chosen host port only from the intended LAN.
Do not configure internet port forwarding. Router guest networks or client isolation
can prevent either connection to the host or direct browser-to-browser traffic.
A direct WebRTC path negotiates its own network traffic, so exposing only the HTTP
port does not guarantee direct connectivity. Native Downloads through the host uses
the host HTTP(S) endpoint as the fallback.

VPNs and multiple network adapters can produce several printed addresses. Share the
one reachable by the receiver. Prefer a stable DHCP reservation for a regularly used
host, then regenerate its leaf certificate after address changes if using the
local HTTPS launcher. Use your router or OS documentation for exact firewall steps.

## Reverse proxies

A private-LAN reverse proxy can terminate HTTPS, but this repository does not ship a
production proxy deployment. Configure and validate all of these requirements:

- Serve at the origin root. Subpath hosting is not supported by the client URLs.
- Preserve WebSocket upgrades on `/`, and set `PUBLIC_URL` to the browser-facing
  HTTPS origin so the host's origin check matches it.
- Forward `/relay/:id` GET and PUT requests, including `Range`, `If-Range`,
  `Authorization`, `Content-Length`, and the download token query parameter.
- Allow at least 5,000,000,000-byte request bodies. Stream request and response bodies;
  disable buffering, caching, content transformation, and automatic retry of uploads.
- Preserve response status, `Content-Range`, `Accept-Ranges`, `ETag`,
  `Content-Disposition`, and the original byte length.
- Use inactivity timeouts appropriate for large-file transfer; do not impose a short
  total request deadline that kills a steadily progressing upload.
- Keep the backend reachable only through the trusted proxy when relying on its TLS.
  The proxy can read relayed bytes and must be trusted too.
- Do not retain relay capability URLs or authorization headers in access logs.

For a same-machine proxy, an illustrative backend command is:

```sh
HOST=127.0.0.1 PORT=4000 PUBLIC_URL=https://driftshare.lan npm start
```

`driftshare.lan` must actually resolve and have a trusted certificate in your setup.
The application does not provision either. Rate limiting uses the connection IP,
not forwarded headers: a proxy can make clients share a rate-limit bucket.

Test a normal download, cancellation, a range resume, and an actual large transfer
through the proxy before relying on it. Extra buffering can invalidate the normal
bounded-memory behavior even when the app itself streams correctly.

## Operating the host

Run as an ordinary user with access to the source tree and any private keys. The host
stores transfer metadata in memory and does not spool payload files. It still needs
CPU, RAM, and sufficient network capacity for concurrent relay traffic. A process
supervisor must use the repository as its working directory and explicitly supply
the intended environment. No service installer or container deployment is provided.

Wait for active transfers before restarting. Transfer and resume state is not persisted,
and hot reload is not implemented. Preserve your CA directory through application
updates. Restart `start:secure` after host IP changes and before its leaf certificate
expires; renewal happens at startup, not continuously.
