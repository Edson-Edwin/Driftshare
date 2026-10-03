# Security policy

DriftShare is intended for trusted local networks. Read the
[security and privacy guide](docs/security.md) for its trust boundary, HTTP/HTTPS
behavior, local CA handling, and data retention. A shared four-digit code is not a
substitute for secure transport or an internet-facing authorization system.

## Supported code

Report security problems against the current `main` branch and include its commit ID.
This project does not currently define maintained release branches, a security
backport schedule, a bug bounty, or a guaranteed response time. If a problem affects
an older revision too, include that information without assuming it is maintained.

## Report privately

Do not post working exploits, sensitive file contents, live join links, capability
tokens, or private keys in a public issue or pull request.

If GitHub displays **Report a vulnerability** in this repository's Security tab, use
that private reporting flow. Otherwise, contact the maintainer through an available
private contact method on the [maintainer profile](https://github.com/Edson-Edwin).
If no private method is available, open an issue containing only a request to establish
a private security-reporting channel. Wait for that channel before sharing details.
This policy does not imply that GitHub private reporting is enabled or that a specific
unpublished contact address exists.

A useful private report includes:

- Affected commit/version, relevant OS/browser/Node versions, and HTTP or HTTPS setup.
- Preconditions, including whether the attacker needs LAN access, the join code,
  host control, or an accepted transfer.
- Minimal reproduction steps using non-sensitive test files and a bounded proof of concept.
- Observed impact and expected behavior, with sanitized logs where helpful.
- Any proposed fix or workaround, plus your preferred contact method.

Do not test another person's devices or network without permission. Coordinate public
disclosure with the maintainer so a report can be reproduced and a fix evaluated.

## Deployment responsibilities

Keep Node and dependencies updated, keep join links private, limit the host to the
intended network, and protect the offline CA private key. Certificate trust on receiving
devices is an operator action; DriftShare does not silently install it. Report behavior
that violates these documented boundaries, especially consent bypass, cross-participant
access, unsafe file paths, secret exposure, or unbounded resource use.
