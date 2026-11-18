# Security policy

Thank you for helping keep Bakorin and the sites built on it safe.

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue, pull
request, or discussion for them.

- **GitHub private vulnerability reporting:** on the repository, open the
  **Security** tab and choose **Report a vulnerability**. This works once private
  vulnerability reporting is turned on for the repository.
- **Email:** kyle@meltonstudios.com, if you prefer email.

Include what you found, the steps to reproduce it, the Bakorin version or commit,
and whether you used SQLite or Postgres. A short proof of concept helps.

## What to expect

- We confirm we received your report within 3 business days.
- We send a first assessment, with a severity and next steps, within 10 business days.
- We tell you when a fix ships and credit you in the release notes, unless you
  prefer not to be named.

Please give us a reasonable time to fix the problem before you share details
publicly.

## Supported versions

Bakorin is in beta. Fixes go to the latest release on `main`. Older beta builds do
not get backports.

## Scope

In scope: the Bakorin server, admin UI, SDK (including the pass through route),
`create-bakorin` templates, and the Docker image. Out of scope: problems in a
client app's own `app.yaml` policies or hooks, and denial of service from very
high traffic volumes.

## Hardening notes

See [docs/security.md](docs/security.md) for how authentication, rate limits,
proxies (`TRUST_PROXY`, `BAKORIN_PROXY_SECRET`), and file serving are designed.
