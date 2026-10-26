# Security policy

This project is alpha. Use the latest reviewed source; no long-term support or response-time SLA is promised.

Do not disclose vulnerabilities, access tokens, API keys, database exports, or customer records in public issues.
Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Shudesu/threads-harness-oss/security/advisories/new) when enabled. If that form is unavailable, use the maintainer's [contact page](https://the-harness.com/noda-shuichi/) to request a private reporting channel, without including exploit details or secrets in the initial contact.

Include the affected commit, impact, and minimal reproduction using synthetic data. Maintainers must confirm the private reporting channel is enabled before advertising it as available. Rotate any credential that has already been exposed through its legitimate provider.

The workspace API key grants full administrator access. Keep user tokens encrypted at rest, redact upstream errors, and never enable request-URL logging for token inspection or SSO endpoints. See [operations](docs/manual/06-operations.md).
