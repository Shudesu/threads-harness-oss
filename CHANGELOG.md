# Changelog

## 0.1.1 — 2026-10-26

- Preserve the Workers native-fetch receiver fix and add a local workerd connection regression check.
- Verify connection permissions and real token/data-access expiry; retain safe Meta error codes.
- Add connection recheck, expiry warnings, disconnect/reconnect and reservation expiry guard.
- Preserve history and keep uncertain publications out of automatic retry.
- Add local stdio MCP with read-only mode and authenticated readiness checks.
- Route new reservations to account-specific DOs while retaining legacy reservations.
- Stop idle scheduler alarms while preserving future reservations and interrupted work.
- Parse release configuration as JSONC; add observability and dependency updates.
- Add setup, token, SSO, development and upgrade manuals, English overview and secret templates.

Requires migrations 0004 and 0005 before deploying. Live Meta connection/publication E2E remains unverified.

## 0.1.0 — initial alpha

Drafts, scheduled text posts, chains, insights, encrypted tokens, single-use admin SSO and CI.
