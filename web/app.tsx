import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@cloudflare/kumo/components/button";
import {
  Composer,
  emptyEditor,
  editorParts,
  MediaList,
  validEditor,
  type Editor,
} from "./composer";
import { Brand, Sidebar } from "./shell";
import { Empty, Icon, Modal, Panel, Status } from "./ui";
import { PostList } from "./post-list";
import {
  dateLabel,
  errorLabels,
  getMedia,
  groupPosts,
  matchesFilter,
  metricLabels,
  numberLabel,
  pageFromHash,
  pages,
  pendingStatuses,
  reviewFingerprint,
  type Account,
  type Filter,
  type Limits,
  type Metric,
  type Overview,
  type Page,
  type Post,
  type PostGroup,
} from "./model";

type ActionDialog =
  | {
      kind: "publish";
      group: PostGroup;
      accountId: string;
      fingerprint: string;
    }
  | { kind: "cancel"; group: PostGroup; accountId: string }
  | { kind: "archive"; group: PostGroup; accountId: string }
  | { kind: "disconnect"; account: Account; accountId: string }
  | { kind: "resume"; account: Account; accountId: string };
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
function savedKey() {
  try {
    return sessionStorage.getItem("threads_api_key") ?? "";
  } catch {
    return "";
  }
}
const MANUAL =
  "https://github.com/Shudesu/threads-harness-oss/blob/main/docs/manual/";

export function App() {
  const [key, setKey] = useState(savedKey),
    [connected, setConnected] = useState(false),
    [booting, setBooting] = useState(() => Boolean(savedKey()));
  const [accounts, setAccounts] = useState<Account[]>([]),
    [selected, setSelected] = useState("");
  const [posts, setPosts] = useState<Post[]>([]),
    [overview, setOverview] = useState<Overview | null>(null);
  const [page, setPage] = useState<Page>(() =>
      pageFromHash(window.location.hash),
    ),
    [mobile, setMobile] = useState(false);
  const [filter, setFilter] = useState<Filter>("all"),
    [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor>(emptyEditor),
    [editorBase, setEditorBase] = useState(() => JSON.stringify(emptyEditor()));
  const [token, setToken] = useState(""),
    [limits, setLimits] = useState<Limits | null>(null),
    [replyQuota, setReplyQuota] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pollError, setPollError] = useState("");
  const [dialog, setDialog] = useState<ActionDialog | null>(null),
    [scheduleMode, setScheduleMode] = useState(false),
    [schedule, setSchedule] = useState("");
  const lock = useRef(false),
    selection = useRef(""),
    epoch = useRef(0),
    booted = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const activeAccount = accounts.find((a) => a.id === selected),
    accountConnected = activeAccount?.status === "connected",
    canPublish = Boolean(accountConnected && !activeAccount?.queue_paused);
  const dirty = JSON.stringify(editor) !== editorBase;
  const expiring = [
    activeAccount?.token_expires_at,
    activeAccount?.data_access_expires_at,
  ].some((date) => date && Date.parse(date) <= Date.now() + 7 * 86400000);
  const needsAttention =
    activeAccount &&
    (!canPublish ||
      expiring ||
      !activeAccount.token_expires_at ||
      !activeAccount.permissions_checked_at);
  const attention = !accountConnected
    ? "Threadsへの再接続が必要です。下書きと公開履歴は保持されています。"
    : activeAccount?.queue_paused
      ? "予約を一時停止しています。残っている原稿を確認してから再開してください。"
      : expiring
        ? "有効期限まで7日以内です。期限前にトークンを更新してください。"
        : "権限または有効期限が未確認です。アカウント設定で接続状態を確認してください。";

  const api = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = (await response.json()) as { data: any; error?: string };
      if (!response.ok)
        throw new ApiError(
          json.error || `HTTP ${response.status}`,
          response.status,
        );
      return json.data;
    },
    [key],
  );
  const refresh = useCallback(
    async (accountId = selection.current) => {
      const generation = epoch.current;
      const [rows, items, summary] = await Promise.all([
        api("/accounts"),
        accountId
          ? api(`/posts?accountId=${encodeURIComponent(accountId)}`)
          : [],
        accountId
          ? api(`/overview?accountId=${encodeURIComponent(accountId)}`)
          : null,
      ]);
      if (generation !== epoch.current || accountId !== selection.current)
        return;
      setAccounts(rows);
      setPosts(items);
      setOverview(summary);
      setPollError("");
    },
    [api],
  );
  const clearEditor = () => {
    const value = emptyEditor();
    setEditor(value);
    setEditorBase(JSON.stringify(value));
  };
  const clearSession = () => {
    epoch.current++;
    selection.current = "";
    try {
      sessionStorage.removeItem("threads_api_key");
    } catch {
      /* storage unavailable */
    }
    setKey("");
    setConnected(false);
    setAccounts([]);
    setSelected("");
    setPosts([]);
    setOverview(null);
    setToken("");
    setLimits(null);
    setDialog(null);
    setMobile(false);
    clearEditor();
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) clearSession();
      setError(
        e instanceof Error
          ? e.message
          : "処理に失敗しました。状態を確認してください。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const login = async (preferredId?: string) => {
    const generation = epoch.current,
      rows: Account[] = await api("/accounts");
    if (generation !== epoch.current) return;
    const id =
      rows.find((a) => a.id === (preferredId ?? selection.current))?.id ??
      rows.find((a) => a.status === "connected")?.id ??
      rows[0]?.id ??
      "";
    try {
      sessionStorage.setItem("threads_api_key", key);
    } catch {
      /* keep this in-memory session */
    }
    if (selection.current !== id) setLimits(null);
    selection.current = id;
    setSelected(id);
    setAccounts(rows);
    setConnected(true);
    await refresh(id);
  };
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (key) void run(() => login()).finally(() => setBooting(false));
    else setBooting(false);
    // The first render consumes an SSO session key once. Subsequent keys use the form.
  }, []);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  useEffect(() => {
    const change = () => {
      setPage(pageFromHash(window.location.hash));
      setMobile(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (connected) heading.current?.focus();
  }, [page, connected]);
  useEffect(() => {
    if (!connected || !selected) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || lock.current) return;
      void refresh(selected).catch(() =>
        setPollError(
          "自動更新ができませんでした。表示は前回取得した内容です。",
        ),
      );
    }, 15000);
    return () => clearInterval(timer);
  }, [connected, selected, refresh]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const navigate = (next: Page) => {
    setPage(next);
    window.location.hash = next;
    setMobile(false);
  };
  const startNew = () => {
    if (
      dirty &&
      !window.confirm("入力中の原稿を破棄して、新しい投稿を作成しますか？")
    )
      return;
    clearEditor();
    navigate("compose");
  };
  const choose = (id: string) => {
    if (
      dirty &&
      !window.confirm(
        "未保存の原稿があります。破棄してアカウントを切り替えますか？",
      )
    )
      return;
    void run(async () => {
      epoch.current++;
      selection.current = id;
      setSelected(id);
      setPosts([]);
      setOverview(null);
      setLimits(null);
      setSearch("");
      clearEditor();
      await refresh(id);
    });
  };
  const logout = () => {
    if (dirty && !window.confirm("未保存の原稿を破棄してログアウトしますか？"))
      return;
    clearSession();
    setError("");
    setNotice("");
  };
  const edit = (post: Post) => {
    if (
      dirty &&
      !window.confirm("入力中の原稿を破棄して、この下書きを編集しますか？")
    )
      return;
    const media = getMedia(post),
      value: Editor = {
        id: post.id,
        text: post.text,
        media,
        mode: media.length > 1 ? "CAROUSEL" : (media[0]?.type ?? "TEXT"),
        chain: false,
      };
    setEditor(value);
    setEditorBase(JSON.stringify(value));
    navigate("compose");
  };
  const save = () =>
    void run(async () => {
      if (!accountConnected || !validEditor(editor))
        throw new Error("接続状態と原稿の内容を確認してください。");
      await api(
        editor.id ? `/posts/${editor.id}` : editor.chain ? "/chains" : "/posts",
        editor.id ? "PATCH" : "POST",
        editor.chain && !editor.id
          ? { accountId: selected, parts: editorParts(editor) }
          : { accountId: selected, text: editor.text, media: editor.media },
      );
      clearEditor();
      setFilter("draft");
      setSearch("");
      navigate("posts");
      await refresh(selected);
      setNotice("下書きを保存しました。まだ公開していません。");
    });
  const openPublish = (group: PostGroup) => {
    if (dirty && group.parts.some((p) => p.id === editor.id)) {
      navigate("compose");
      setError("編集中の原稿を先に保存してください。");
      return;
    }
    setError("");
    setSchedule("");
    setScheduleMode(false);
    setDialog({
      kind: "publish",
      group: structuredClone(group),
      accountId: selected,
      fingerprint: reviewFingerprint(group.parts),
    });
  };
  const fetchInsights = (post: Post) =>
    void run(async () => {
      await api(`/posts/${post.id}/insights`, "POST");
      await refresh(selected);
      setNotice("インサイトを更新しました。");
    });
  const confirmAction = () =>
    void run(async () => {
      if (!dialog || dialog.accountId !== selected)
        throw new Error("操作対象が変わりました。開き直してください。");
      if (dialog.kind === "publish") {
        if (!canPublish || !dialog.group.head)
          throw new Error("接続状態と原稿を確認してください。");
        if (dirty && dialog.group.parts.some((p) => p.id === editor.id))
          throw new Error("編集中の原稿を先に保存してください。");
        let scheduledAt: string | undefined;
        if (scheduleMode) {
          if (
            !schedule ||
            !Number.isFinite(Date.parse(schedule)) ||
            Date.parse(schedule) <= Date.now()
          )
            throw new Error("未来の公開処理開始日時を指定してください。");
          scheduledAt = new Date(schedule).toISOString();
        }
        const fresh: Post[] = await api(
          `/posts?accountId=${encodeURIComponent(selected)}`,
        );
        const current = groupPosts(fresh).find(
          (g) => g.head?.id === dialog.group.head?.id,
        );
        if (!current || reviewFingerprint(current.parts) !== dialog.fingerprint)
          throw new Error(
            "原稿の内容または状態が変更されました。閉じて最新の原稿から確認し直してください。",
          );
        const result = await api(
          `/posts/${dialog.group.head.id}/queue`,
          "POST",
          scheduledAt ? { scheduledAt } : {},
        );
        setLimits(result.limits);
        setNotice(
          result.warning ??
            (scheduledAt
              ? "指定日時から公開処理を開始します。"
              : "公開待ちに登録しました。処理が完了すると公開済みに変わります。"),
        );
      } else if (dialog.kind === "cancel" || dialog.kind === "archive") {
        if (!dialog.group.head)
          throw new Error("連投の先頭から操作してください。");
        await api(`/posts/${dialog.group.head.id}/${dialog.kind}`, "POST", {});
        setNotice(
          dialog.kind === "cancel"
            ? "予約を取り消し、下書きに戻しました。"
            : "一覧から非表示にしました。Threads上の投稿と履歴は保持されます。",
        );
      } else if (dialog.kind === "disconnect") {
        await api(`/accounts/${dialog.account.id}/disconnect`, "POST");
        setNotice("切断しました。下書きと公開履歴は保持されています。");
      } else if (dialog.kind === "resume") {
        const latest: Account[] = await api("/accounts");
        const account = latest.find((a) => a.id === dialog.account.id);
        if (!account || account.pending_count !== dialog.account.pending_count)
          throw new Error(
            "予約件数が変わりました。閉じて内容を確認し直してください。",
          );
        const visible = posts.filter((p) =>
          ["queued", "processing"].includes(p.status),
        );
        if (visible.length < account.pending_count)
          throw new Error(
            "表示範囲外にも予約があります。すべての原稿を確認してから再開してください。",
          );
        await api(`/accounts/${dialog.account.id}/resume`, "POST", {
          confirmed: true,
        });
        setNotice("予約の再開を受け付けました。");
      }
      setDialog(null);
      await refresh(selected);
    });
  const groups = groupPosts(posts),
    visibleGroups = groups.filter(
      (group) =>
        group.parts.some((p) =>
          matchesFilter(p, page === "schedule" ? "queued" : filter),
        ) &&
        (!search.trim() ||
          group.parts.some((p) =>
            p.text
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
          )),
    );
  const listProps = {
    busy,
    canPublish,
    canRead: Boolean(accountConnected),
    edit,
    publish: openPublish,
    cancel: (group: PostGroup) => {
      setError("");
      setDialog({ kind: "cancel", group, accountId: selected });
    },
    archive: (group: PostGroup) => {
      setError("");
      setDialog({ kind: "archive", group, accountId: selected });
    },
    insights: fetchInsights,
  };
  const published = posts.filter((p) => p.status === "published");
  const newButton = (
    <Button
      variant="primary"
      disabled={busy || !accountConnected}
      onClick={startNew}
    >
      <Icon name="compose" size={18} />
      新規投稿
    </Button>
  );
  const accountEmpty = (
    <Empty
      title="Threadsアカウントを接続しましょう"
      description="アカウントを接続すると、下書き・予約・公開履歴を管理できます。"
      action={
        <Button variant="primary" onClick={() => navigate("accounts")}>
          アカウントを接続
        </Button>
      }
    />
  );
  const quotaPanel = (
    <Panel
      title="現在の投稿枠"
      description="残りの枠は、直近24時間の利用に応じて変動します。"
    >
      <div className="quota-value">
        <strong>{numberLabel(limits?.posts.remaining)}</strong>
        <span>/ {numberLabel(limits?.posts.total)} 件</span>
      </div>
      {limits?.replies && (
        <p className="small">
          返信の残り {numberLabel(limits.replies.remaining)} /{" "}
          {numberLabel(limits.replies.total)} 件
        </p>
      )}
      <label className="check-field small">
        <input
          type="checkbox"
          checked={replyQuota}
          onChange={(e) => setReplyQuota(e.target.checked)}
          disabled={busy}
        />
        連投の返信枠も確認する
      </label>
      <Button
        disabled={busy || !accountConnected}
        onClick={() =>
          void run(async () =>
            setLimits(
              await api(
                `/accounts/${selected}/limits${replyQuota ? "?replies=1" : ""}`,
              ),
            ),
          )
        }
      >
        投稿枠を確認
      </Button>
      <p className="field-help">
        {limits
          ? `確認: ${dateLabel(limits.checkedAt)}`
          : "必要なときに最新の枠を確認できます。"}{" "}
        公開直前にも再確認します。返信枠の取得には返信管理の権限が必要です。
      </p>
    </Panel>
  );

  if (!connected)
    return (
      <main className="login-page">
        <div className="login-wrap">
          <Brand />
          <Panel>
            <h1>ワークスペースにログイン</h1>
            <p className="muted">Threadsの投稿とアカウントを管理します。</p>
            {booting ? (
              <p role="status" className="login-loading">
                ログイン情報を確認しています…
              </p>
            ) : (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => login());
                }}
              >
                <label className="field">
                  <span>APIキー</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    disabled={busy}
                  />
                </label>
                {error && (
                  <p role="alert" className="inline-alert alert-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" variant="primary" disabled={busy || !key}>
                  {busy ? "確認中…" : "ログイン"}
                </Button>
                <p className="field-help">
                  ログイン情報は、このタブのセッション中だけ保持します。
                </p>
              </form>
            )}
          </Panel>
          <p className="login-help">
            Cloudをご利用の場合は{" "}
            <a href="https://theharness.cloud">ワークスペース一覧</a>{" "}
            から管理画面を開けます。
          </p>
        </div>
      </main>
    );
  return (
    <div className="harness-app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          heading.current?.focus();
        }}
      >
        本文へ移動
      </a>
      <aside className="desktop-sidebar">
        <Sidebar
          {...{
            accounts,
            selected,
            page,
            overview,
            busy,
            navigate,
            choose,
            logout,
          }}
        />
      </aside>
      <header className="mobile-header">
        <Button
          variant="ghost"
          aria-label="メニューを開く"
          aria-expanded={mobile}
          onClick={() => setMobile(true)}
        >
          <Icon name="menu" />
        </Button>
        <Brand />
      </header>
      <main id="main-content" className="main-content">
        <header className="page-header">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              {page === "compose" && editor.id
                ? "下書きを編集"
                : pages[page].title}
            </h1>
            <p>
              {pages[page].description}
              {activeAccount && (
                <span className="page-account">
                  {" "}
                  · @{activeAccount.username}
                </span>
              )}
            </p>
          </div>
          <div className="button-row">
            {page !== "compose" && page !== "accounts" && newButton}
            <Button disabled={busy} onClick={() => void run(() => refresh())}>
              更新
            </Button>
          </div>
        </header>
        {error && !dialog && (
          <div role="alert" className="alert alert-danger">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="alert alert-success">
            {notice}
          </div>
        )}
        {pollError && (
          <div role="status" className="alert alert-warning">
            {pollError}
          </div>
        )}
        {needsAttention && page !== "accounts" && (
          <div className="alert alert-warning row-between">
            <span>{attention}</span>
            <Button size="sm" onClick={() => navigate("accounts")}>
              設定を確認
            </Button>
          </div>
        )}
        {page === "dashboard" && (
          <>
            {!activeAccount ? (
              <Panel>{accountEmpty}</Panel>
            ) : (
              <>
                <div className="stats-grid">
                  {(
                    [
                      {
                        title: "下書き",
                        count: overview?.drafts,
                        to: "posts",
                        filter: "draft",
                        icon: "posts",
                      },
                      {
                        title: "公開待ち・処理中",
                        count: overview?.queued,
                        to: "schedule",
                        filter: "queued",
                        icon: "schedule",
                      },
                      {
                        title: "公開済み",
                        count: overview?.published,
                        to: "posts",
                        filter: "published",
                        icon: "check",
                      },
                      {
                        title: "要確認・停止",
                        count: overview?.needsReview,
                        to: "posts",
                        filter: "review",
                        icon: "help",
                      },
                    ] as const
                  ).map((stat) => (
                    <button
                      className="stat-card"
                      key={stat.title}
                      onClick={() => {
                        setFilter(stat.filter);
                        setSearch("");
                        navigate(stat.to);
                      }}
                    >
                      <div className="row-between">
                        <span>{stat.title}</span>
                        <span className="stat-icon">
                          <Icon name={stat.icon} />
                        </span>
                      </div>
                      <strong>{numberLabel(stat.count)}</strong>
                      <span className="stat-link">
                        一覧を見る <Icon name="arrow" size={16} />
                      </span>
                    </button>
                  ))}
                </div>
                <p className="field-help stats-note">
                  選択中のアカウントの件数です。連投は各投稿を1件として数え、非表示の原稿は含みません。
                </p>
                <div className="dashboard-grid">
                  <Panel
                    title="最近の投稿"
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFilter("all");
                          setSearch("");
                          navigate("posts");
                        }}
                      >
                        すべて見る
                      </Button>
                    }
                  >
                    {groups.length ? (
                      <PostList
                        groups={groups.slice(0, 4)}
                        {...listProps}
                        compact
                      />
                    ) : (
                      <Empty
                        title="まだ投稿がありません"
                        description="最初の原稿を下書きに保存しましょう。"
                        action={newButton}
                      />
                    )}
                  </Panel>
                  <div className="stack">
                    {quotaPanel}
                    <Panel title="接続アカウント">
                      <div className="preview-account">
                        <span className="account-avatar">@</span>
                        <div>
                          <strong>@{activeAccount.username}</strong>
                          <Status status={activeAccount.status} />
                        </div>
                      </div>
                      <p className="small muted">
                        トークン期限:{" "}
                        {dateLabel(activeAccount.token_expires_at)}
                      </p>
                      <Button onClick={() => navigate("accounts")}>
                        アカウント設定
                      </Button>
                    </Panel>
                  </div>
                </div>
              </>
            )}
          </>
        )}
        {(page === "posts" || page === "schedule") && (
          <Panel>
            {!activeAccount ? (
              accountEmpty
            ) : (
              <>
                <div className="list-toolbar">
                  {page === "posts" && (
                    <div
                      className="filter-tabs"
                      role="group"
                      aria-label="投稿の状態で絞り込み"
                    >
                      {(
                        [
                          "all",
                          "draft",
                          "queued",
                          "published",
                          "review",
                        ] as Filter[]
                      ).map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={filter === value}
                          className={filter === value ? "selected" : ""}
                          onClick={() => setFilter(value)}
                        >
                          {
                            {
                              all: "すべて",
                              draft: "下書き",
                              queued: "公開待ち",
                              published: "公開済み",
                              review: "要確認",
                            }[value]
                          }
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="search-field">
                    <Icon name="search" size={17} />
                    <input
                      type="search"
                      aria-label="投稿を検索"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="本文で検索"
                    />
                  </label>
                </div>
                {page === "schedule" && (
                  <div className="inline-alert alert-info">
                    予約日時は公開処理を開始する時刻です。準備に1分以上かかる場合があります。
                  </div>
                )}
                <p className="list-count">
                  {visibleGroups.length}件の原稿を表示
                  {overview && overview.total > posts.length
                    ? ` · 最新${posts.length}投稿から絞り込み（全${overview.total}投稿）`
                    : ""}
                </p>
                {visibleGroups.length ? (
                  <PostList groups={visibleGroups} {...listProps} />
                ) : (
                  <Empty
                    title={
                      search
                        ? "一致する原稿がありません"
                        : page === "schedule"
                          ? "予約中の投稿はありません"
                          : filter === "all"
                            ? "まだ原稿がありません"
                            : "この状態の原稿はありません"
                    }
                    description={
                      search
                        ? "検索語や絞り込みを変えてみてください。"
                        : "下書きを保存した後に、公開内容と日時を確認できます。"
                    }
                    action={
                      !search && filter !== "published" ? newButton : undefined
                    }
                  />
                )}
              </>
            )}
          </Panel>
        )}
        {page === "compose" &&
          (!activeAccount ? (
            <Panel>{accountEmpty}</Panel>
          ) : (
            <Composer
              value={editor}
              setValue={setEditor}
              busy={busy}
              connected={Boolean(accountConnected)}
              username={activeAccount.username}
              save={save}
              close={() => {
                if (!dirty || window.confirm("未保存の変更を破棄しますか？")) {
                  clearEditor();
                  navigate("posts");
                }
              }}
            />
          ))}
        {page === "insights" &&
          (!activeAccount ? (
            <Panel>{accountEmpty}</Panel>
          ) : (
            <>
              <div className="metrics-grid">
                {(Object.keys(metricLabels) as Metric[]).map((metric) => (
                  <div className="metric-card" key={metric}>
                    <span>{metricLabels[metric]}</span>
                    <strong>{numberLabel(overview?.[metric])}</strong>
                  </div>
                ))}
              </div>
              <p className="field-help">
                取得済みの数値を集計しています。未取得は「—」です。非表示の投稿は集計に含みません。表示回数の取得済み:{" "}
                {numberLabel(overview?.measured)} /{" "}
                {numberLabel(overview?.published)}投稿 · 最終取得{" "}
                {dateLabel(overview?.insightsUpdatedAt)}
              </p>
              <Panel
                title="投稿ごとのインサイト"
                description="「取得」でMetaの最新値を読み込みます。表示するだけでは再取得しません。"
              >
                {published.length ? (
                  <div className="table-scroll">
                    <table>
                      <caption className="sr-only">公開済み投稿の6指標</caption>
                      <thead>
                        <tr>
                          <th>投稿</th>
                          {(Object.keys(metricLabels) as Metric[]).map((k) => (
                            <th key={k}>{metricLabels[k]}</th>
                          ))}
                          <th>更新</th>
                        </tr>
                      </thead>
                      <tbody>
                        {published.map((p) => (
                          <tr key={p.id}>
                            <th scope="row">
                              <span className="table-caption">
                                {p.text || "メディア投稿"}
                              </span>
                              <span className="muted small">
                                {dateLabel(p.insights_updated_at)}
                              </span>
                            </th>
                            {(Object.keys(metricLabels) as Metric[]).map(
                              (k) => (
                                <td key={k}>{numberLabel(p[k])}</td>
                              ),
                            )}
                            <td>
                              <Button
                                size="sm"
                                disabled={busy || !accountConnected}
                                onClick={() => fetchInsights(p)}
                              >
                                取得
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="公開済みの投稿はありません"
                    description="投稿が公開されると、ここからインサイトを取得できます。"
                  />
                )}
              </Panel>
            </>
          ))}
        {page === "accounts" && (
          <div className="settings-grid">
            <div className="stack">
              <Panel title="接続状態">
                {activeAccount ? (
                  <>
                    <div className="preview-account">
                      <span className="account-avatar">@</span>
                      <div>
                        <strong>@{activeAccount.username}</strong>
                        <Status status={activeAccount.status} />
                      </div>
                    </div>
                    {needsAttention && (
                      <div className="inline-alert alert-warning">
                        {attention}
                      </div>
                    )}
                    <dl className="settings-details">
                      <div>
                        <dt>権限の確認</dt>
                        <dd>
                          {dateLabel(activeAccount.permissions_checked_at)}
                        </dd>
                      </div>
                      <div>
                        <dt>トークン期限</dt>
                        <dd>{dateLabel(activeAccount.token_expires_at)}</dd>
                      </div>
                      <div>
                        <dt>データアクセス期限</dt>
                        <dd>
                          {dateLabel(activeAccount.data_access_expires_at)}
                        </dd>
                      </div>
                      <div>
                        <dt>未処理の予約</dt>
                        <dd>
                          {activeAccount.pending_count}件
                          {activeAccount.queue_paused ? " · 一時停止中" : ""}
                        </dd>
                      </div>
                    </dl>
                    {activeAccount.last_error_code && (
                      <p className="inline-alert alert-warning">
                        {
                          errorLabels[
                            activeAccount.last_error_kind ?? "unknown"
                          ]
                        }{" "}
                        · {activeAccount.last_error_code}
                      </p>
                    )}
                    <div className="button-row">
                      <Button
                        disabled={
                          busy || activeAccount.status === "disconnected"
                        }
                        onClick={() =>
                          void run(async () => {
                            try {
                              await api(`/accounts/${selected}/check`, "POST");
                              setNotice(
                                "プロフィール・権限・期限を確認しました。",
                              );
                            } finally {
                              await refresh(selected);
                            }
                          })
                        }
                      >
                        接続状態を確認
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          !accountConnected ||
                          (!activeAccount.pending_count &&
                            !activeAccount.queue_paused)
                        }
                        onClick={() => {
                          setError("");
                          setDialog({
                            kind: "resume",
                            account: activeAccount,
                            accountId: selected,
                          });
                        }}
                      >
                        予約を再開
                      </Button>
                    </div>
                    <p className="field-help">
                      トークンの自動更新はありません。期限前に新しいトークンで接続を更新してください。
                    </p>
                    <div className="danger-zone">
                      <span className="small">
                        この環境からアカウントを切断
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="danger-text"
                        disabled={
                          busy || activeAccount.status === "disconnected"
                        }
                        onClick={() => {
                          setError("");
                          setDialog({
                            kind: "disconnect",
                            account: activeAccount,
                            accountId: selected,
                          });
                        }}
                      >
                        切断
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    まだThreadsアカウントが接続されていません。接続フォームから接続してください。
                  </p>
                )}
              </Panel>
              {quotaPanel}
            </div>
            <Panel
              title="Threadsアカウントを接続・更新"
              description="Metaで発行したThreadsユーザーアクセストークンを使います。"
            >
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!token || busy) return;
                  if (
                    dirty &&
                    !window.confirm(
                      "未保存の原稿を破棄して、アカウントの接続を更新しますか？",
                    )
                  )
                    return;
                  void run(async () => {
                    const profile = await api("/accounts", "POST", {
                      accessToken: token,
                    });
                    setToken("");
                    clearEditor();
                    await login(profile.id);
                    setNotice("アカウントを接続しました。");
                  });
                }}
              >
                <label className="field">
                  <span>Threadsアクセストークン</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !token}
                >
                  接続を確認して保存
                </Button>
                <p className="field-help">
                  同じアカウントなら、履歴を保持して接続を更新します。接続しただけでは投稿されません。
                </p>
                <a
                  className="text-link"
                  href={`${MANUAL}02-meta-app.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  トークンの取得手順を見る ↗
                </a>
                <details className="help-details">
                  <summary>必要な権限と接続方式</summary>
                  <p>
                    threads_basic / threads_content_publish /
                    threads_manage_insights が必要です。連投には
                    threads_manage_replies
                    も追加してください。OAuthログイン・自動更新には未対応です。テスター以外は管理者による診断用アプリトークンの設定が必要です。
                  </p>
                </details>
              </form>
            </Panel>
          </div>
        )}
      </main>
      {mobile && (
        <Modal
          title="メニュー"
          className="nav-dialog"
          onClose={() => setMobile(false)}
        >
          <Sidebar
            {...{
              accounts,
              selected,
              page,
              overview,
              busy,
              navigate,
              choose,
              logout,
            }}
            mobile
          />
        </Modal>
      )}
      {dialog && (
        <Modal
          title={
            dialog.kind === "publish"
              ? "公開内容を確認"
              : dialog.kind === "cancel"
                ? "予約を取り消しますか？"
                : dialog.kind === "archive"
                  ? "一覧から非表示にしますか？"
                  : dialog.kind === "resume"
                    ? "予約の再開を確認"
                    : "アカウントを切断しますか？"
          }
          busy={busy}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
        >
          <div className="dialog-body">
            <p className="review-account">
              投稿先{" "}
              <strong>
                @{accounts.find((a) => a.id === dialog.accountId)?.username}
              </strong>
            </p>
            {error && (
              <p role="alert" className="inline-alert alert-danger">
                {error}
              </p>
            )}
            {dialog.kind === "publish" ? (
              <>
                <div className="review-parts">
                  {dialog.group.parts.map((p, i) => (
                    <section key={p.id}>
                      <h3>
                        {dialog.group.parts.length > 1
                          ? `${i + 1}件目`
                          : "投稿内容"}
                      </h3>
                      <p className="post-text">{p.text || "（本文なし）"}</p>
                      <MediaList items={getMedia(p)} />
                    </section>
                  ))}
                </div>
                <fieldset className="schedule-choice">
                  <legend>公開タイミング</legend>
                  <label>
                    <input
                      type="radio"
                      name="publish-time"
                      checked={!scheduleMode}
                      disabled={busy}
                      onChange={() => setScheduleMode(false)}
                    />
                    準備ができ次第
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="publish-time"
                      checked={scheduleMode}
                      disabled={busy}
                      onChange={() => setScheduleMode(true)}
                    />
                    日時を指定する
                  </label>
                  {scheduleMode && (
                    <label className="field">
                      <span>公開処理の開始日時</span>
                      <input
                        type="datetime-local"
                        value={schedule}
                        onChange={(e) => setSchedule(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  <p className="field-help">
                    日時は端末のタイムゾーン（
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    ）です。公開処理に1分以上かかる場合があります。指定時刻ちょうどの公開は保証されません。
                  </p>
                </fieldset>
              </>
            ) : dialog.kind === "cancel" ? (
              <p>
                対象の原稿{dialog.group.parts.length}
                件を下書きに戻します。未公開の素材準備をリセットし、本文・素材・履歴は残します。
              </p>
            ) : dialog.kind === "archive" ? (
              <p>
                原稿{dialog.group.parts.length}
                件をこの一覧から隠します。Threads上の投稿は削除されません。
              </p>
            ) : dialog.kind === "disconnect" ? (
              <p>
                保存済みトークンを削除し、以降の投稿処理を停止します。下書き・公開履歴は保持されます。すでに送信中の処理は取り消せないため、Threads側の結果を確認してください。
              </p>
            ) : (
              <>
                <p>
                  未処理の予約 {dialog.account.pending_count}
                  件を再開します。日時を過ぎた原稿は順次公開されます。
                </p>
                <div className="review-parts">
                  {posts
                    .filter((p) => pendingStatuses.includes(p.status))
                    .map((p) => (
                      <section key={p.id}>
                        <span className="muted small">
                          {dateLabel(p.scheduled_at)}
                        </span>
                        <p className="post-text">{p.text || "（本文なし）"}</p>
                        <MediaList items={getMedia(p)} />
                      </section>
                    ))}
                </div>
              </>
            )}
          </div>
          <footer className="dialog-actions">
            <Button disabled={busy} onClick={() => setDialog(null)}>
              戻る
            </Button>
            <Button
              variant="primary"
              disabled={
                busy ||
                (dialog.kind === "publish" &&
                  (!canPublish || (scheduleMode && !schedule)))
              }
              onClick={confirmAction}
            >
              {busy
                ? "処理中…"
                : dialog.kind === "publish"
                  ? scheduleMode
                    ? "この内容で予約する"
                    : "この内容で公開を開始"
                  : dialog.kind === "cancel"
                    ? "予約を取り消す"
                    : dialog.kind === "archive"
                      ? "非表示にする"
                      : dialog.kind === "resume"
                        ? "確認して再開する"
                        : "切断する"}
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
