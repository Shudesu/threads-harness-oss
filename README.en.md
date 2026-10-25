# Threads Harness (OSS alpha)

A self-hosted Cloudflare Worker with D1, Durable Objects and a React/Kumo console for text drafts, chains, scheduled publication and saved insights. MIT licensed.

This alpha requires a **Threads user access token pasted into the console**. OAuth sign-in, automatic token refresh, image publishing and a reconciliation UI are not implemented. Live posting end-to-end is not verified.

Create a Meta app with the Threads use case, invite your Threads profile as a tester and accept the invitation in Threads account settings → Website permissions. Grant `threads_basic`, `threads_content_publish`, and `threads_manage_insights`. Exchange a short-lived token for a long-lived token using the official server-side procedure. Do not use a Facebook, Instagram or app token in the connection form.

Connection verifies profile, permissions and actual expiry through `/debug_token`. Self-inspection requires a Threads tester token. Other users require the operator to configure `THREADS_APP_ACCESS_TOKEN` for the same app. Zero/absent expiry remains unknown. Reconnect before expiry; reconnecting the same profile retains drafts and history. A workspace API key grants full administrative access.

Use Node 22, `npm ci`, `npm run check`, and `python3 -m unittest discover -s test -p 'test_*.py'`. Local development uses `.dev.vars.example`. Production requires your own D1 ID, migrations, `API_KEY` and a base64-encoded 32-byte `TOKEN_ENCRYPTION_KEY`. Never regenerate an existing encryption key during an upgrade. SSO is optional. Inspect the target account, back up D1, build and dry-run before deployment.

[Japanese setup and operating manual](docs/manual/README.md) · [Security](SECURITY.md) · [Upgrade](docs/manual/10-upgrade.md)
