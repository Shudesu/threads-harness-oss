import { Button } from "@cloudflare/kumo/components/button";
import { MediaList } from "./composer";
import {
  dateLabel,
  errorLabels,
  getMedia,
  mediaLabel,
  numberLabel,
  metricLabels,
  type Metric,
  type Post,
  type PostGroup,
} from "./model";
import { Status } from "./ui";
export function PostList({
  groups,
  busy,
  canPublish,
  canRead,
  edit,
  publish,
  cancel,
  archive,
  insights,
  compact = false,
}: {
  groups: PostGroup[];
  busy: boolean;
  canPublish: boolean;
  canRead: boolean;
  edit: (p: Post) => void;
  publish: (g: PostGroup) => void;
  cancel: (g: PostGroup) => void;
  archive: (g: PostGroup) => void;
  insights: (p: Post) => void;
  compact?: boolean;
}) {
  return (
    <div className="post-list">
      {groups.map((group) => {
        const head = group.head,
          isChain = Boolean(group.parts[0].chain_id),
          allDraft = group.parts.every((p) => p.status === "draft"),
          allQueued = group.parts.every((p) => p.status === "queued"),
          archivable = group.parts.every((p) =>
            ["draft", "published"].includes(p.status),
          );
        return (
          <article
            key={group.id}
            id={`post-group-${group.id}`}
            tabIndex={-1}
            className="post-card"
          >
            <header className="row-between">
              <div className="post-meta">
                <Status
                  status={
                    group.parts.find((p) =>
                      ["needs_review", "failed"].includes(p.status),
                    )?.status ??
                    group.parts.find((p) => p.status !== "published")?.status ??
                    "published"
                  }
                />
                <span>
                  {isChain
                    ? `連投 · ${group.parts.length}件`
                    : mediaLabel(group.parts[0])}
                </span>
              </div>
              <time className="muted small">
                {dateLabel(group.parts[0].created_at)}
              </time>
            </header>
            {group.parts.map((post, i) => (
              <div key={post.id} className="post-part">
                {isChain && (
                  <div className="row-between">
                    <span className="eyebrow">
                      {(post.part_index ?? i) + 1}件目 · {mediaLabel(post)}
                    </span>
                    <Status status={post.status} />
                  </div>
                )}
                <p className={`post-text ${compact ? "line-clamp" : ""}`}>
                  {post.text || "（本文なし・メディア投稿）"}
                </p>
                {!compact && <MediaList items={getMedia(post)} />}
                {post.scheduled_at && (
                  <p className="muted small">
                    公開処理の開始日時: {dateLabel(post.scheduled_at)}
                  </p>
                )}
                {post.error_code && (
                  <div
                    className={`inline-alert ${["failed", "needs_review"].includes(post.status) ? "alert-danger" : "alert-warning"}`}
                  >
                    <strong>
                      {post.status === "needs_review"
                        ? "Threads側の公開結果を確認してください。自動再送は停止しています。"
                        : post.status === "failed"
                          ? "公開前に停止しました。原因を解消してから新しい下書きを作成してください。"
                          : "公開条件が整うまで待機しています。"}
                    </strong>
                    <p>
                      {errorLabels[post.error_kind ?? "unknown"]} ·{" "}
                      {post.error_code}
                      {post.next_attempt_at
                        ? ` · 次回確認 ${dateLabel(post.next_attempt_at)}`
                        : ""}
                    </p>
                  </div>
                )}
                {!compact && post.published_id && (
                  <div className="post-insights">
                    <dl>
                      {(Object.keys(metricLabels) as Metric[]).map((key) => (
                        <div key={key}>
                          <dt>{metricLabels[key]}</dt>
                          <dd>{numberLabel(post[key])}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="row-between">
                      <span className="muted small">
                        {post.insights_updated_at
                          ? `取得 ${dateLabel(post.insights_updated_at)}`
                          : "インサイト未取得"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !canRead}
                        onClick={() => insights(post)}
                      >
                        最新の数値を取得
                      </Button>
                    </div>
                    <details className="muted small">
                      <summary>公開ID</summary>
                      <code>{post.published_id}</code>
                    </details>
                  </div>
                )}
                {!compact && isChain && post.status === "draft" && (
                  <Button size="sm" disabled={busy} onClick={() => edit(post)}>
                    {(post.part_index ?? i) + 1}件目を編集
                  </Button>
                )}
              </div>
            ))}
            {!compact && (
              <footer className="post-actions">
                <div className="button-row">
                  {head && allDraft && (
                    <>
                      {!isChain && (
                        <Button disabled={busy} onClick={() => edit(head)}>
                          編集
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        disabled={busy || !canPublish}
                        onClick={() => publish(group)}
                      >
                        {isChain ? "連投の公開・予約" : "公開・予約"}
                      </Button>
                    </>
                  )}
                  {head && allQueued && (
                    <Button disabled={busy} onClick={() => cancel(group)}>
                      予約を取り消す
                    </Button>
                  )}
                </div>
                {head && archivable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => archive(group)}
                  >
                    一覧から非表示
                  </Button>
                )}
                {!head && (
                  <p className="field-help">
                    連投の一部を表示しています。操作は先頭の原稿から行ってください。
                  </p>
                )}
              </footer>
            )}
          </article>
        );
      })}
    </div>
  );
}
