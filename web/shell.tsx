import { version } from "../package.json";
import { Button } from "@cloudflare/kumo/components/button";
import {
  accountLabels,
  numberLabel,
  type Account,
  type Overview,
  type Page,
} from "./model";
import { Icon } from "./ui";
const menu: { section: string; items: { page: Page; label: string }[] }[] = [
  {
    section: "メイン",
    items: [{ page: "dashboard", label: "ダッシュボード" }],
  },
  {
    section: "投稿",
    items: [
      { page: "posts", label: "投稿管理" },
      { page: "compose", label: "新規投稿" },
      { page: "schedule", label: "予約一覧" },
    ],
  },
  { section: "分析", items: [{ page: "insights", label: "インサイト" }] },
  {
    section: "設定",
    items: [
      { page: "accounts", label: "アカウント設定" },
      { page: "integrations", label: "MCP・API連携" },
    ],
  },
];
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">T</span>
      <div>
        <strong>Threads Harness</strong>
        <span>管理画面</span>
      </div>
    </div>
  );
}
export function Sidebar({
  accounts,
  selected,
  page,
  overview,
  busy,
  navigate,
  choose,
  logout,
  mobile = false,
}: {
  accounts: Account[];
  selected: string;
  page: Page;
  overview: Overview | null;
  busy: boolean;
  navigate: (p: Page) => void;
  choose: (id: string) => void;
  logout: () => void;
  mobile?: boolean;
}) {
  return (
    <>
      <div className="sidebar-brand">
        <Brand />
      </div>
      <div className="account-switch">
        <label htmlFor={mobile ? "mobile-account" : "sidebar-account"}>
          操作中のThreadsアカウント
        </label>
        <select
          id={mobile ? "mobile-account" : "sidebar-account"}
          value={selected}
          disabled={busy}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">アカウントを選択</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.username} · {accountLabels[a.status] ?? a.status}
            </option>
          ))}
        </select>
      </div>
      <nav
        className="sidebar-nav"
        aria-label={mobile ? "モバイルナビゲーション" : "主ナビゲーション"}
      >
        {menu.map((group) => (
          <div className="nav-section" key={group.section}>
            <p>{group.section}</p>
            {group.items.map((item) => (
              <button
                type="button"
                key={item.page}
                className={`nav-item ${page === item.page ? "active" : ""}`}
                aria-current={page === item.page ? "page" : undefined}
                disabled={busy}
                onClick={() => navigate(item.page)}
              >
                <Icon name={item.page} />
                <span>{item.label}</span>
                {item.page === "schedule" &&
                  overview &&
                  overview.queued > 0 && (
                    <span className="nav-count">
                      {numberLabel(overview.queued)}
                    </span>
                  )}
                {item.page === "posts" &&
                  overview &&
                  overview.needsReview > 0 && (
                    <span className="nav-count danger-count">
                      {overview.needsReview}
                    </span>
                  )}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <footer className="sidebar-footer">
        <a
          href="https://github.com/Shudesu/threads-harness-oss/blob/main/docs/manual/01-intro.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="help" size={17} />
          操作マニュアル
        </a>
        <a
          href="https://theharness.cloud"
          target="_blank"
          rel="noopener noreferrer"
        >
          The Harness Cloud ↗
        </a>
        <div className="sidebar-version">
          Threads Harness v{version} <span>提供中</span>
        </div>
        <Button
          variant="ghost"
          className="logout"
          disabled={busy}
          onClick={logout}
        >
          <Icon name="logout" size={17} />
          ログアウト
        </Button>
      </footer>
    </>
  );
}
