import { Button } from "@cloudflare/kumo/components/button";
import { Icon, Panel, Status } from "./ui";
import {
  accountLabels,
  dateLabel,
  getMedia,
  mediaLabel,
  numberLabel,
  type Account,
  type Filter,
  type Overview,
  type Page,
  type PostGroup,
} from "./model";

type Action = {
  tone: "neutral" | "warning" | "danger";
  title: string;
  description: string;
  label: string;
  page: Page;
  filter?: Filter;
  create?: boolean;
};
export function nextAction(
  account: Account,
  overview: Overview | null,
  unsaved = false,
  now = Date.now(),
): Action {
  if (
    account.status !== "connected" ||
    [account.token_expires_at, account.data_access_expires_at].some(
      (date) => date && Date.parse(date) <= now,
    )
  )
    return {
      tone: "danger",
      title: "Threadsへの接続を確認してください",
      description:
        "公開を進めるには再接続が必要です。保存済みの原稿と履歴は残っています。",
      label: "接続を確認する",
      page: "accounts",
    };
  if (overview && overview.needsReview > 0)
    return {
      tone: "danger",
      title: `確認が必要な投稿が${overview.needsReview}件あります`,
      description:
        "公開結果が不明、または公開前に停止しています。重複を避けるため、結果と原因を確認してください。",
      label: "要確認の投稿を見る",
      page: "posts",
      filter: "review",
    };
  if (account.queue_paused)
    return {
      tone: "warning",
      title: "予約の公開を一時停止しています",
      description:
        "原稿と日時を確認してから、アカウント設定で再開してください。",
      label: "予約の再開を確認",
      page: "accounts",
    };
  if (unsaved)
    return {
      tone: "neutral",
      title: "書きかけの原稿があります",
      description:
        "入力中の内容はこのタブに残っています。続きを編集して、下書きに保存しましょう。",
      label: "編集を続ける",
      page: "compose",
    };
  if (
    [account.token_expires_at, account.data_access_expires_at].some(
      (date) => date && Date.parse(date) <= now + 7 * 86400000,
    )
  )
    return {
      tone: "warning",
      title: "接続の有効期限が近づいています",
      description:
        "期限前に接続を更新しましょう。トークンの自動更新はありません。",
      label: "有効期限を確認",
      page: "accounts",
    };
  if (!account.token_expires_at || !account.permissions_checked_at)
    return {
      tone: "warning",
      title: "接続情報を再確認しましょう",
      description:
        "権限または有効期限が未確認です。アカウント設定から最新の状態を確認できます。",
      label: "接続情報を確認",
      page: "accounts",
    };
  if (!overview)
    return {
      tone: "neutral",
      title: "投稿の状況を確認しています",
      description: "保存済みの原稿と公開履歴を読み込んでいます。",
      label: "投稿管理を見る",
      page: "posts",
      filter: "all",
    };
  if (overview.drafts > 0)
    return {
      tone: "neutral",
      title: `下書き${overview.drafts}件を、次の投稿へ`,
      description: "本文・素材・投稿先を確認して、公開や予約に進めます。",
      label: "下書きを確認",
      page: "posts",
      filter: "draft",
    };
  if (overview.queued > 0)
    return {
      tone: "neutral",
      title: `${overview.queued}件の投稿が公開を待っています`,
      description:
        "予約日時と処理状況を確認できます。処理中の投稿は、準備ができるまで待機します。",
      label: "予約と進行状況を見る",
      page: "schedule",
    };
  return {
    tone: "neutral",
    title: "次の投稿を準備しましょう",
    description:
      "まずは下書きに保存。内容を確認してから、公開タイミングを選べます。",
    label: "下書きを作成",
    page: "compose",
    create: true,
  };
}
export function scheduleSummary(
  account: Account,
  overview: Overview | null,
  now = Date.now(),
) {
  if (!overview)
    return { label: "読み込み中", detail: "予約情報を確認しています。" };
  if (account.queue_paused && overview.queued)
    return {
      label: "再開待ち",
      detail: `${overview.queued}件の原稿を保持しています。`,
    };
  if (account.status !== "connected" && overview.queued)
    return {
      label: "接続の確認が必要",
      detail: `${overview.queued}件の原稿を保持しています。`,
    };
  if (overview.processing > 0)
    return {
      label: `${overview.processing}件を処理中`,
      detail: "準備・状態確認が完了すると公開されます。",
    };
  if (!overview.queued)
    return {
      label: "予約はありません",
      detail: "下書きの「公開・予約」から日時を指定できます。",
    };
  if (!overview.nextScheduledAt)
    return {
      label: "公開待ち",
      detail: "予約一覧で対象の原稿と状態を確認してください。",
    };
  if (Date.parse(overview.nextScheduledAt) <= now)
    return {
      label: "公開条件の確認待ち",
      detail:
        "予約日時を迎えています。投稿枠や接続状態を予約一覧で確認してください。",
    };
  return {
    label: dateLabel(overview.nextScheduledAt),
    detail: "次に公開処理を開始する日時です。",
  };
}
function groupStatus(group: PostGroup) {
  return (
    group.parts.find((p) => ["failed", "needs_review"].includes(p.status))
      ?.status ??
    group.parts.find((p) => p.status !== "published")?.status ??
    "published"
  );
}
export function Dashboard({
  account,
  accountCount,
  overview,
  groups,
  busy,
  unsaved,
  navigate,
  startNew,
  openGroup,
}: {
  account?: Account;
  accountCount: number;
  overview: Overview | null;
  groups: PostGroup[];
  busy: boolean;
  unsaved: boolean;
  navigate: (page: Page, filter?: Filter) => void;
  startNew: () => void;
  openGroup: (group: PostGroup) => void;
}) {
  if (!account)
    return (
      <div className="dashboard-welcome">
        <div className="welcome-mark">
          <Icon name="accounts" size={30} />
        </div>
        <p className="eyebrow">THREADS HARNESS</p>
        <h2>まずは、Threadsを接続しましょう。</h2>
        <p>
          アカウントの接続から、下書き・予約・公開まで。
          <br />
          ひとつずつ確認しながら進められます。
        </p>
        <ol className="onboarding-steps">
          <li>
            <span>1</span>
            <strong>アカウントを接続</strong>
            <p>Threadsのユーザートークンを登録</p>
          </li>
          <li>
            <span>2</span>
            <strong>原稿を下書きに保存</strong>
            <p>テキスト・画像・動画を準備</p>
          </li>
          <li>
            <span>3</span>
            <strong>確認して公開・予約</strong>
            <p>投稿先と内容を確認してから実行</p>
          </li>
        </ol>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => navigate("accounts")}
        >
          アカウントを接続
        </Button>
        <p className="field-help">接続しただけでは、投稿されません。</p>
        <div className="dashboard-news">
          <span>お知らせ</span>
          <p>Threads Harnessは正式提供中です。</p>
          <button onClick={() => navigate("integrations")}>
            MCP・API連携について <Icon name="arrow" size={14} />
          </button>
        </div>
      </div>
    );
  const action = nextAction(account, overview, unsaved),
    schedule = scheduleSummary(account, overview);
  const recent = groups.slice(0, 4);
  return (
    <div className="dashboard-refined">
      <section className="dashboard-identity" aria-label="操作対象のアカウント">
        <div className="identity-main">
          <span className="identity-avatar">@</span>
          <div>
            <p className="eyebrow">操作中のThreadsアカウント</p>
            <div className="identity-title">
              <h2>@{account.username}</h2>
              <Status status={account.status} />
            </div>
            <p className="field-help">
              このアカウントの原稿・予約・実績を表示しています。
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => navigate("accounts")}
        >
          <Icon name="accounts" size={16} />
          {accountCount > 1
            ? `アカウント切替（${accountCount}件）`
            : "アカウント設定"}
        </Button>
      </section>
      <section
        className={`next-action next-action-${action.tone}`}
        aria-label="次にすること"
      >
        <div>
          <p className="eyebrow">次にすること</p>
          <h2>{action.title}</h2>
          <p>{action.description}</p>
          {unsaved && action.page !== "compose" && (
            <button
              className="unsaved-link"
              onClick={() => navigate("compose")}
            >
              書きかけの原稿に戻る
            </button>
          )}
        </div>
        <Button
          variant="primary"
          disabled={
            busy || (!overview && action.tone === "neutral" && !unsaved)
          }
          onClick={() =>
            action.create ? startNew() : navigate(action.page, action.filter)
          }
        >
          {action.label}
          <Icon name="arrow" size={16} />
        </Button>
      </section>
      <section aria-label="投稿の状況">
        <div className="section-heading">
          <h2>投稿の状況</h2>
          <span>選択中のアカウント · 非表示を除く全件</span>
        </div>
        <div className="dashboard-stat-grid">
          {[
            {
              key: "drafts" as const,
              title: "下書き",
              detail: "まだ公開されていない原稿",
              icon: "posts" as const,
              page: "posts" as Page,
              filter: "draft" as Filter,
            },
            {
              key: "queued" as const,
              title: "公開待ち",
              detail: "予約・準備・処理中の投稿",
              icon: "schedule" as const,
              page: "schedule" as Page,
              filter: "queued" as Filter,
            },
            {
              key: "published" as const,
              title: "公開済み",
              detail: "公開が確認できた投稿",
              icon: "check" as const,
              page: "posts" as Page,
              filter: "published" as Filter,
            },
          ].map((stat) => (
            <button
              className="dashboard-stat"
              key={stat.key}
              disabled={busy}
              onClick={() => navigate(stat.page, stat.filter)}
            >
              <div className="row-between">
                <span>
                  <Icon name={stat.icon} size={17} />
                  {stat.title}
                </span>
                <Icon name="arrow" size={15} />
              </div>
              <strong>
                {numberLabel(overview?.[stat.key])}
                <small>件</small>
              </strong>
              <p>
                {stat.key === "published" && overview?.lastPublishedAt
                  ? `最終公開 ${dateLabel(overview.lastPublishedAt)}`
                  : stat.detail}
              </p>
            </button>
          ))}
        </div>
        <p className="dashboard-count-note">
          連投は、構成する投稿ごとに1件として数えます。
        </p>
      </section>
      <div className="dashboard-work-grid">
        <div className="stack">
          <Panel
            title="最近の原稿・公開"
            action={
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => navigate("posts", "all")}
              >
                すべて見る <Icon name="arrow" size={14} />
              </Button>
            }
          >
            {recent.length ? (
              <div className="activity-list">
                {recent.map((group) => {
                  const first = group.parts[0],
                    state = groupStatus(group),
                    media = getMedia(first);
                  return (
                    <button
                      key={group.id}
                      className="activity-row"
                      aria-label={`投稿管理で確認: ${first.text || "メディア投稿"}`}
                      disabled={busy}
                      onClick={() => openGroup(group)}
                    >
                      <span
                        className={`activity-icon ${state === "published" ? "activity-published" : ""}`}
                      >
                        <Icon
                          name={
                            state === "published"
                              ? "check"
                              : media.length
                                ? media[0].type === "VIDEO"
                                  ? "video"
                                  : "image"
                                : "posts"
                          }
                        />
                      </span>
                      <span className="activity-copy">
                        <span className="activity-title">
                          {first.text || "本文なしのメディア投稿"}
                        </span>
                        <span className="activity-meta">
                          {first.chain_id
                            ? `連投 · ${group.parts.length}件`
                            : mediaLabel(first)}{" "}
                          ·{" "}
                          {state === "published"
                            ? `公開 ${dateLabel(
                                group.parts
                                  .map((p) => p.updated_at)
                                  .sort()
                                  .at(-1),
                              )}`
                            : `作成 ${dateLabel(first.created_at)}`}
                        </span>
                      </span>
                      <span className="activity-state">
                        <Status status={state} />
                        <Icon name="arrow" size={14} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="quiet-empty">
                <Icon name="posts" size={24} />
                <h3>最初の原稿を、下書きから。</h3>
                <p>保存した原稿と公開履歴がここに並びます。</p>
              </div>
            )}
            {overview &&
              overview.total >
                groups.reduce((n, g) => n + g.parts.length, 0) && (
                <p className="field-help">
                  最近の原稿は取得済みの最新200投稿から表示しています。
                </p>
              )}
          </Panel>
          <Panel
            title="投稿の反応"
            action={
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => navigate("insights")}
              >
                インサイトを見る <Icon name="arrow" size={14} />
              </Button>
            }
          >
            <div className="dashboard-metrics">
              {(
                [
                  { key: "views", label: "表示回数" },
                  { key: "likes", label: "いいね" },
                  { key: "replies", label: "返信" },
                ] as const
              ).map((m) => (
                <div key={m.key}>
                  <span>{m.label}</span>
                  <strong>{numberLabel(overview?.[m.key])}</strong>
                </div>
              ))}
            </div>
            <p className="field-help">
              保存済みの集計です。未取得の数値は「—」で表示します。
              <br />
              表示回数の取得済み {numberLabel(overview?.measured)} /{" "}
              {numberLabel(overview?.published)}投稿 · 最終取得{" "}
              {dateLabel(overview?.insightsUpdatedAt)}
            </p>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="公開の予定">
            <div className="schedule-spot">
              <span className="schedule-spot-icon">
                <Icon name="schedule" size={22} />
              </span>
              <strong>{schedule.label}</strong>
              <p>{schedule.detail}</p>
            </div>
            {overview?.nextScheduledAt && overview.processing > 0 && (
              <p className="field-help">
                次の予約: {dateLabel(overview.nextScheduledAt)}
              </p>
            )}
            <Button disabled={busy} onClick={() => navigate("schedule")}>
              予約一覧を見る
            </Button>
            <p className="field-help">
              指定時刻から公開処理を開始します。完了まで1分以上かかる場合があります。
            </p>
          </Panel>
          <Panel title="接続と更新">
            <dl className="connection-summary">
              <div>
                <dt>保存済みの接続状態</dt>
                <dd>{accountLabels[account.status] ?? account.status}</dd>
              </div>
              <div>
                <dt>トークン期限</dt>
                <dd>{dateLabel(account.token_expires_at)}</dd>
              </div>
              <div>
                <dt>データアクセス期限</dt>
                <dd>{dateLabel(account.data_access_expires_at)}</dd>
              </div>
            </dl>
            <p className="field-help">
              権限の最終確認: {dateLabel(account.permissions_checked_at)}
              <br />
              トークンの自動更新はありません。
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => navigate("accounts")}
            >
              接続情報を管理 <Icon name="arrow" size={14} />
            </Button>
          </Panel>
        </div>
      </div>
      <footer className="dashboard-news">
        <span>お知らせ</span>
        <p>
          Threads Harness 正式提供中 <span>複数アカウント・MCP/APIに対応</span>
        </p>
        <button disabled={busy} onClick={() => navigate("integrations")}>
          連携ガイド <Icon name="arrow" size={14} />
        </button>
      </footer>
    </div>
  );
}
