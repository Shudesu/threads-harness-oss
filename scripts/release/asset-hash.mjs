import { extname } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Ported verbatim from line-harness packages/update-engine/src/cf-api/asset-hash.ts
// — the canonical Workers Assets manifest hash for The Harness Cloud bundles.
// The algorithm must match what Cloudflare/Wrangler compute, or the control
// plane's assets-upload-session will reject/duplicate files silently.

/** Cloudflare/Wrangler Workers Assets hash: BLAKE3(base64(bytes)+extension). */
export function hashWorkerAsset(path, content) {
  const extension = extname(path).slice(1);
  const input = new TextEncoder().encode(content.toString("base64") + extension);
  return bytesToHex(blake3(input)).slice(0, 32);
}

/**
 * Normalize a local file path into the absolute URL path Cloudflare's
 * assets-upload-session API expects as a manifest key: forward slashes, no
 * leading `./`, exactly one leading `/`.
 */
export function normalizeAssetPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error(`invalid Workers Asset path: ${path}`);
  }
  return `/${normalized}`;
}
