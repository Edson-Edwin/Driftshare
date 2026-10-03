# Security and privacy

[Documentation home](README.md) · [Report a vulnerability](../SECURITY.md)

## Trust model

DriftShare is intended for a local network with a host you trust. Its four-digit code
is a convenient shared joining credential, not a user account or a strong identity
system. Anyone holding the code or private link can join, see connected peer labels,
and send offers. Recipients still choose whether to accept files.

The host serves the JavaScript and manages signaling. A malicious or compromised host
can change that code, even for direct WebRTC transfers. Device names are user-controlled
labels; they do not prove who is operating a device. There is no independent fingerprint
verification, per-user authorization, public discovery service, or malware scanner.

## What is encrypted?

| Path | Protection and visibility |
| --- | --- |
| Page and signaling over HTTP | Not encrypted or authenticated against a network attacker |
| Direct WebRTC payload | Encrypted by WebRTC's DTLS transport, but trusted page delivery and signaling still matter |
| Relay over HTTP | Payload passes through the host in plaintext on the network |
| Relay over trusted HTTPS | TLS protects browser-to-host connections; the host and any TLS-terminating proxy can read the payload |

HTTPS relay is not end-to-end encryption between the two browsers. The host does not
write relay payloads to an application file, but that does not make it unable to inspect
those bytes. Operating-system swap, crash dumps, and proxy logging are outside the
app's retention guarantees.

Direct-path CRC32 checks detect accidental corruption and length mismatches. CRC32 is
not a cryptographic authentication check. Relay transfers check byte length but do not
perform the same end-to-end application checksum exchange. Use independently compared
SHA-256 hashes when you need to verify a saved result.

## Offline HTTPS step by step

On the host, install OpenSSL, then run:

```sh
openssl version
npm run start:secure
```

The launcher creates a private local certificate authority (CA) and a server certificate.
It prints the public certificate path, its SHA-256 fingerprint, and HTTPS join links.
It does not contact a public CA or require a domain name.

1. Transfer **only `driftshare-root.cer`**, the public certificate, to the intended
   devices using a channel you control, such as a USB drive.
2. Compare the SHA-256 certificate fingerprint with the value shown on the host.
   Do not trust a certificate merely because it has a familiar name.
3. Import it into the certificate store used by the target device/browser and enable
   server-authentication trust as required by that platform.
4. Open the exact HTTPS address printed by the launcher. The address must match a
   name or IP in the certificate, and the device clock must be correct.
5. Confirm the browser accepts the certificate without a warning before transferring.

To inspect the public DER certificate with OpenSSL:

```sh
openssl x509 -inform DER -in .driftshare-tls/driftshare-root.cer -noout -fingerprint -sha256
```

Trusting a root CA grants significant authority. Protect its private key, install it
only on devices you control or administer with permission, and remove that trust when
the host is retired. Never share `root.key` or `server.key`, commit them, or attach them
to an issue. Sharing the public root certificate does not require sharing either key.

## Device trust references

Exact menus depend on OS version and administration policy. Use the platform's
instructions and confirm the certificate store used by your browser:

- [Windows trusted-root certificate guide](https://learn.microsoft.com/en-us/skype-sdk/sdn/articles/installing-the-trusted-root-certificate).
- [macOS certificate trust in Keychain Access](https://support.apple.com/en-euro/guide/keychain-access/kyca2431/mac).
- [Android certificate installation](https://support.google.com/pixelphone/answer/2844832/add-amp-remove-certificates).
- [iPhone/iPad manual certificate trust](https://support.apple.com/en-us/102390).

On iPhone/iPad, installing a certificate profile alone does not enable SSL trust;
manual full trust must also be enabled. Linux trust configuration differs by distribution
and browser; use the relevant browser or distribution documentation. A managed device
may forbid user-installed roots. A browser warning bypass does not provide the same
assurance as a correctly trusted certificate.

## Certificate files and renewal

The default private directory is `.driftshare-tls/`, relative to the directory in which
you launch the command. Use `DRIFTSHARE_TLS_DIR` to place it elsewhere.

| File | Purpose | Share with receivers? |
| --- | --- | --- |
| `root.key` | Private CA signing key | **Never** |
| `root.crt` | Public CA certificate in PEM format | Public, but the launcher distributes the DER file below |
| `driftshare-root.cer` | Public CA certificate in DER format | Yes, after verifying its fingerprint |
| `server.key` | Private HTTPS server key | **Never** |
| `server.crt` | Public server certificate | Normally delivered through TLS |
| `setup.lock` | Prevents concurrent certificate setup | No; not a credential |

The CA is initially valid for ten years; server certificates are valid for 30 days.
At startup the launcher checks existing key/certificate relationships and renews the
leaf certificate when needed, including when fewer than seven days remain or detected
LAN addresses are missing. It refuses incomplete/mismatched CA material and a CA close
to expiry. It never silently replaces an already trusted CA.

Restart after LAN IP changes and before leaf expiry. A continuously running process
does not renew certificates in the background. Keep a protected backup of the CA pair
if you need to retain trust across host migrations. If its private key is lost or
compromised, deliberately create a new CA in a new directory and remove the old root
from every device before trusting the replacement. Do not delete the old directory
blindly as a troubleshooting step.

## Data and retention

- The browser stores its label in local storage (`driftshare-name`) and the join code
  in session storage (`driftshare-code`). Clearing site data removes these preferences.
- The reconnect credential, transfer queue, source-file references, result cards,
  and retained received Blobs live in the page. Reloading loses them.
- The host keeps peer metadata, offers, capability tokens, and transfer state in memory.
  Resumable interrupted relays are retained for up to 15 minutes, subject to periodic
  cleanup; a restart loses them immediately.
- The application does not persist uploaded payload files on the host or include
  analytics/telemetry integrations. Browser Downloads and direct-save destinations
  are controlled by the receiver.
- Exported result files include filenames and device labels. Inspect them before sharing.
- Runtime logging prints the join code and private URLs. Restrict access to terminal
  captures and service logs. Proxy access logs may capture download capability URLs.

## Controls in the implementation

The server enforces authentication before discovery, participant authorization,
recipient consent before signaling, browser-origin checks, metadata validation,
message-size limits, bounded outstanding offers, connection limits, code-attempt
limits, and heartbeat/timeout cleanup. The UI escapes labels and filenames and the
server supplies content-security and framing restrictions.

These controls reduce common mistakes and abuse; they do not turn a short shared
code into an internet-ready authentication system. A rate limit based on connection
IP can be shared by clients behind a proxy. See [Architecture](architecture.md) for
exact bounds, and [Configuration](configuration.md) for proxy implications.

## Reporting

Follow [SECURITY.md](../SECURITY.md). Do not publish working exploit details, live
join links, transfer tokens, private files, or keys in a public issue.
