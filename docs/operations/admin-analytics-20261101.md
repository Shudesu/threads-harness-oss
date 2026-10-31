# THREADS admin interaction analytics — prepared, not deployed

User scope: detailed operation records in the real Harness admin UI; no recordings, DOM text, input values, customer information, media, URLs, query strings, API keys or raw errors.

- The authenticated shell mounts a bounded tracker. Screen categories, explicit semantic clicks/change/focus, coarse foreground duration and mutation HTTP outcomes are sent to this workspace's authenticated `/api/product-analytics` routes.
- The collector rejects unknown fields and values, batches at most20 events, uses keyed workspace/credential pseudonyms, disables person profiles and GeoIP, and never forwards raw client bodies. API2xx means HTTP acceptance, not SNS delivery success. Shared owner credentials are one credential actor, not a count of distinct humans.
- Default OFF: missing `PRODUCT_ANALYTICS_ENABLED=true`, allowed `POSTHOG_HOST`, project token, or `ADMIN_SSO_SECRET` means no third-party capture. Browser DNT/GPC and a signed per-workspace stop preference take priority. The stop controls are collapsed in existing account/settings pages. Settings apply to this workspace/browser.
- No new database tables or migration. Existing auth, cookie CSRF and application authorization remain. The X viewer exception is limited to the two analytics POST routes and still requires authentication.
- `adminAnalyticsVersion:1` identifies compatible Cloud release artifacts. Cloud injects the token as secret_text only after a separate default-off tenant rollout flag is enabled. Older bundles receive no new bindings. Internal workspaces remain excluded via `PRODUCT_ANALYTICS_INTERNAL`.
- The implementation is prepared in an isolated checkout. No SNS message, database mutation, public push, default-version change or tenant rollout has occurred.
- Before a production rollout: use the current released baseline, prepare an immutable bundle and protected dry-run, compare schema and every existing binding, use a dedicated canary (never repurpose a pinned customer environment), then confirm only the final publication/rollout within the owner's approval scope.
- Preserve fixed/pinned versions and unresolved scheduling holds. Personal LINE's dedicated UI/LIFF combination is a separate release target; this standard LINE candidate must not overwrite it.

Validation records and the cross-product plan live in The Harness Cloud's `docs/operations/tenant-admin-analytics-20261101.md`. No browser automation or real SNS sends are used for validation.
