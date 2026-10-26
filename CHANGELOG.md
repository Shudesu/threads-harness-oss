# Changelog

## 0.2.1 — 2026-10-26

- Simplify the dashboard around the selected account and one context-aware next action. Prioritize connection/expiry problems, uncertain publications, paused reservations and unsaved drafts.
- Use three clear status totals, compact recent activity, saved reaction metrics and explicit scheduling/connection details. Keep the availability notice secondary. No invented trend charts or live-metric claims.
- Extend the account overview with processing count, next queued time and last publication receipt across all non-archived rows. No schema migration or publisher changes.

## 0.2.0 — 2026-10-26

- Begin regular availability of the implemented Threads features; retain explicit OAuth, refresh, upload and scheduling limitations.
- Add multi-account directory/session selection and an MCP/API setup page. Account-scoped drafts, metrics and schedulers remain isolated within the workspace admin boundary.
- Publish OpenAPI 3.1, cursor-paginated post listing and account-specific single-post retrieval. Optional accountId on legacy post mutations prevents accidental wrong-account operations.
- Expand local stdio MCP to 16 tools, default to read-only, require accountId for post mutations and verify target ownership before writes. MCP list output is now items/pagination. No database migration.

## 0.1.5 — 2026-10-26

- Align the Threads console with the Harness sidebar, account switcher, mobile menu, page headers, cards and Kumo controls. Separate dashboard, posts, composer, schedule, insights and account settings.
- Add account-scoped overview totals independent of the latest-200 list; preserve unknown metrics instead of inventing zeros.
- Auto-enter existing SSO sessions, preserve unsaved work between pages, and review every chain part/attachment/account/time before queueing. Recheck changed drafts and prevent duplicate clicks.
- No database migration beyond 0007. Existing tokens, posts, schedules and publisher behavior are retained.

## 0.1.4 — 2026-10-26

- Fix cancelled, partially prepared carousels retaining old child containers after attachment edits. Cancellation now clears unpublished preparation while preserving the draft, attachments and published history. No database migration is required beyond 0007.
- Add interruption tests for D1 receipt failures, uncertain parent creation, token loss during child polling, exhausted quotas and cancellation guards. Production API negative checks made no new posts.

## 0.1.3 — 2026-10-26

- Public HTTPS image/video URLs and mixed carousels (2–20 items) in drafts, scheduling, UI and MCP; optional media captions. No file hosting/upload.
- Persisted child container order/readiness, bounded creation and polling, no retry after ambiguous mutations.
- Migration 0007 preserves text posts, credentials, IDs and history. Apply before deploying.
- Unit and workerd fixtures cover media creation/publication with mocked Meta. Real media publishing awaits content approval; one real text publication and six insight metrics verified separately.

## 0.1.2 — 2026-10-26

- Retain queued work on invalid tokens and require explicit resume after reconnecting.
- Share emoji UTF-8 text budgeting across Worker, console and MCP.
- Check post/reply quotas when booking and executing, with future-capacity warnings.
- Preserve safe error categories and documented container enums; bound read-only polling to five checks.
- Fetch, store and display shares alongside the other five post metrics.
- Align token, reply-permission, quota and recovery manuals with current behavior.

Apply migration 0006 before deployment. Publication POSTs with uncertain outcomes are never automatically retried, including code 24/4279009 without an independently verified guarantee. Live Meta posting remains unverified.

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
