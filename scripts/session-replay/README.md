# Masked admin session replay

PostHog JS 1.444.0, bundled from the official `full/no-external` entry point.
Install this isolated package with `npm ci` (use a task-specific internal dependency cache on the Mac mini), then `node build.mjs /absolute/path/to/public/harness-replay-v1.js`.
No external JavaScript loader, product-tour/survey/chat integrations, console logs, exceptions, network bodies, headers, fonts, media pixels or cross-origin iframe recording.

Two browser-side boundaries: rrweb masks text/input and blocks private/media nodes; `before_send` reconstructs a strict allowlist of full/incremental snapshots and properties. Unknown or compressed snapshot shapes fail closed. Only static same-origin asset stylesheets contribute CSS/classes; user styles and identifiers are excluded. Some styling and all content labels are intentionally lost. This is DOM session replay, not video/audio/screen capture.

The actual SDK test uses synthetic DOM fixtures in JSDOM with all HTTP intercepted. It checks full snapshots, mutations, input and clicks, output secrets, stop and privacy signals. No real browser automation or customer content is used. `npm test` runs this test after `npm run build`.

Requires authenticated server configuration, an explicit replay rollout flag and notice version 2026-11-01.3. The SDK only receives the public ingestion token and keyed pseudonym. It never receives an API key for customer operations, cookies, bearer headers or a CSRF token. Config authorization refreshes every minute; opt-out/unmount stops immediately. A no-referrer policy is applied before SDK network requests. Project IP anonymization must remain enabled. Production replay activation and deployment are separate from building this artifact.
