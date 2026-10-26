import { validMedia, type MediaItem } from "../shared/media.mjs";
export type Page =
  "dashboard" | "posts" | "compose" | "schedule" | "insights" | "accounts";
export type Filter = "all" | "draft" | "queued" | "published" | "review";
export const pages: Record<Page, { title: string; description: string }> = {
  dashboard: {
    title: "ダッシュボード",
    description: "投稿の状況と、次に必要な操作を確認できます。",
  },
  posts: {
    title: "投稿管理",
    description: "下書きから公開履歴まで、投稿をまとめて管理します。",
  },
  compose: {
    title: "新規投稿",
    description: "まずは下書きに保存。公開前に内容を確認できます。",
  },
  schedule: {
    title: "予約一覧",
    description: "公開待ちの投稿と、処理中の状況を確認できます。",
  },
  insights: {
    title: "インサイト",
    description: "公開した投稿の反応を確認できます。",
  },
  accounts: {
    title: "アカウント設定",
    description: "Threadsとの接続、権限、有効期限を管理します。",
  },
};
export type Account = {
  id: string;
  username: string;
  status: string;
  queue_paused: number;
  pending_count: number;
  token_expires_at: string | null;
  data_access_expires_at: string | null;
  permissions_checked_at: string | null;
  last_error_code: string | null;
  last_error_kind: string | null;
};
export const metricLabels = {
  views: "表示回数",
  likes: "いいね",
  replies: "返信",
  reposts: "再投稿",
  quotes: "引用",
  shares: "シェア",
} as const;
export type Metric = keyof typeof metricLabels;
export type Metrics = Record<Metric, number | null>;
export type Post = Metrics & {
  id: string;
  account_id: string;
  text: string;
  media_json: string;
  status: string;
  parent_id: string | null;
  chain_id: string | null;
  part_index: number | null;
  scheduled_at: string | null;
  published_id: string | null;
  error_code: string | null;
  error_kind: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  insights_updated_at: string | null;
};
export type Overview = Metrics & {
  total: number;
  drafts: number;
  queued: number;
  published: number;
  needsReview: number;
  measured: number;
  insightsUpdatedAt: string | null;
};
export type Limits = {
  posts: { remaining: number; total: number };
  replies?: { remaining: number; total: number };
  checkedAt: string;
};
export type PostGroup = { id: string; parts: Post[]; head?: Post };
export const accountLabels: Record<string, string> = {
  connected: "接続済み",
  disconnected: "切断済み",
  expired: "期限切れ",
  reauth_required: "再接続が必要",
};
export const statusLabels: Record<string, string> = {
  draft: "下書き",
  queued: "公開待ち",
  creating: "準備中",
  processing: "処理中",
  publishing: "公開中",
  published: "公開済み",
  failed: "公開前に停止",
  needs_review: "要確認",
};
export const errorLabels: Record<string, string> = {
  token_invalid: "トークン無効",
  permission_denied: "権限不足",
  rate_limited: "利用上限",
  action_blocked: "Metaによる制限",
  container_error: "素材の処理",
  unknown: "原因を確認してください",
};
export const pendingStatuses = [
  "queued",
  "creating",
  "processing",
  "publishing",
];
export const dateLabel = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("ja-JP") : "未確認";
export const numberLabel = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("ja-JP");
export function getMedia(post: Pick<Post, "media_json">): MediaItem[] {
  try {
    const items = JSON.parse(post.media_json || "[]");
    return validMedia(items) ? items : [];
  } catch {
    return [];
  }
}
export function mediaLabel(post: Pick<Post, "media_json">) {
  const items = getMedia(post);
  return items.length > 1
    ? `カルーセル · ${items.length}件`
    : items[0]?.type === "IMAGE"
      ? "画像"
      : items[0]?.type === "VIDEO"
        ? "動画"
        : "テキスト";
}
export function groupPosts(posts: Post[]): PostGroup[] {
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const id = post.chain_id || post.id;
    groups.set(id, [...(groups.get(id) ?? []), post]);
  }
  return [...groups.entries()].map(([id, parts]) => {
    parts.sort((a, b) => (a.part_index ?? 0) - (b.part_index ?? 0));
    return { id, parts, head: parts.find((p) => !p.parent_id) };
  });
}
export function matchesFilter(post: Post, filter: Filter) {
  return (
    filter === "all" ||
    (filter === "queued"
      ? pendingStatuses.includes(post.status)
      : filter === "review"
        ? ["failed", "needs_review"].includes(post.status)
        : post.status === filter)
  );
}
export function reviewFingerprint(parts: Post[]) {
  return JSON.stringify(
    parts.map((p) => ({
      id: p.id,
      account: p.account_id,
      status: p.status,
      text: p.text,
      media: p.media_json,
      parent: p.parent_id,
      chain: p.chain_id,
      part: p.part_index,
    })),
  );
}
export function pageFromHash(hash: string): Page {
  const value = hash.replace(/^#\/?/, "");
  return Object.hasOwn(pages, value) ? (value as Page) : "dashboard";
}
