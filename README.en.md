# Threads Harness (OSS)

A self-hosted Cloudflare Worker with D1, Durable Objects and a React/Kumo console for text drafts, chains, scheduled publication and saved insights. MIT licensed.

This product requires a **Threads user access token pasted into the console**. OAuth sign-in, automatic token refresh and a reconciliation UI are not implemented. Live text, reply-chain, PNG image, H.264/AAC MP4 video, two-item mixed carousel and scheduled text publication plus six metrics have been verified on one authorized account. Scheduling starts preparation at the requested time, rather than guaranteeing exact-time publication. See [verification scope](docs/reviews/live-media-verification-20261026.md).

Create a Meta app with the Threads use case, invite your Threads profile as a tester and accept the invitation in Threads account settings → Website permissions. Grant `threads_basic`, `threads_content_publish`, and `threads_manage_insights`. Exchange a short-lived token for a long-lived token using the official server-side procedure. Do not use a Facebook, Instagram or app token in the connection form.

Connection verifies profile, permissions and actual expiry through `/debug_token`. Self-inspection requires a Threads tester token. Other users require the operator to configure `THREADS_APP_ACCESS_TOKEN` for the same app. Zero/absent expiry remains unknown. Reconnect before expiry; reconnecting the same profile retains drafts and history. A workspace API key grants full administrative access.

Use Node 22, `npm ci`, `npm run check`, and `python3 -m unittest discover -s test -p 'test_*.py'`. Local development uses `.dev.vars.example`. Production requires your own D1 ID, migrations, `API_KEY` and a base64-encoded 32-byte `TOKEN_ENCRYPTION_KEY`. Never regenerate an existing encryption key during an upgrade. SSO is optional. Inspect the target account, back up D1, build and dry-run before deployment.

[Japanese setup and operating manual](docs/manual/README.md) · [Security](SECURITY.md) · [Upgrade](docs/manual/10-upgrade.md)

Version 0.1.2 keeps unattempted jobs queued when a token becomes invalid; reconnect and explicitly resume after reviewing overdue drafts. Quotas are checked when booking and executing; future capacity is not guaranteed. Reply quota checks require threads_manage_replies. Emoji clusters count as UTF-8 bytes toward the 500-unit budget. Apply migration 0006 before deploying this version.

Version 0.1.3 adds single images/videos and mixed carousels (2–20 items), using public HTTPS URLs. Captions are optional. Direct file uploads are not supported. Apply migration 0007 before deployment; preserve credentials and historical containers.

Regular availability began on 2026-10-26. Multi-account workflows, a 16-tool repository-local stdio MCP and documented REST/OpenAPI are available. MCP defaults to read-only, but the underlying workspace API key remains an administrator credential for every account. Use separate workspaces for separate customers. See [API reference](docs/api.md), [OpenAPI](openapi.json), and [MCP guide](docs/mcp.md).
