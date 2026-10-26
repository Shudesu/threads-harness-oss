// @vitest-environment happy-dom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { Dashboard, nextAction, scheduleSummary } from "../web/dashboard";
import {
  dateLabel,
  type Account,
  type Overview,
  type PostGroup,
} from "../web/model";
const now = Date.parse("2026-10-26T12:00:00Z");
const account: Account = {
  id: "123",
  username: "operator_one",
  status: "connected",
  queue_paused: 0,
  pending_count: 0,
  token_expires_at: "2099-01-01T00:00:00Z",
  data_access_expires_at: "2099-02-01T00:00:00Z",
  permissions_checked_at: "2026-10-26T00:00:00Z",
  last_error_code: null,
  last_error_kind: null,
};
const summary = (change: Partial<Overview> = {}): Overview => ({
  total: 7,
  drafts: 0,
  queued: 0,
  published: 7,
  needsReview: 0,
  measured: 7,
  views: 0,
  likes: 0,
  replies: 1,
  reposts: 0,
  quotes: 0,
  shares: 0,
  insightsUpdatedAt: "2026-10-26T10:00:00Z",
  processing: 0,
  nextScheduledAt: null,
  lastPublishedAt: "2026-10-26T09:00:00Z",
  ...change,
});
afterEach(cleanup);
function view(
  options: {
    account?: Account;
    overview?: Overview | null;
    groups?: PostGroup[];
    unsaved?: boolean;
  } = {},
) {
  const navigate = vi.fn(),
    startNew = vi.fn(),
    openGroup = vi.fn();
  render(
    <Dashboard
      account={options.account ?? account}
      accountCount={2}
      overview={options.overview === undefined ? summary() : options.overview}
      groups={options.groups ?? []}
      busy={false}
      unsaved={options.unsaved ?? false}
      navigate={navigate}
      startNew={startNew}
      openGroup={openGroup}
    />,
  );
  return { navigate, startNew, openGroup };
}
it("makes the selected account and one safe next step prominent without a publish button", () => {
  const { startNew, navigate } = view();
  expect(
    within(
      screen.getByRole("region", { name: "操作対象のアカウント" }),
    ).getByText("@operator_one"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "下書きを作成" }));
  expect(startNew).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "この内容で公開を開始" }),
  ).toBeNull();
});
it("prioritizes uncertain publication over drafts and routes to the review filter", () => {
  const { navigate } = view({
    overview: summary({ drafts: 5, needsReview: 2 }),
  });
  fireEvent.click(screen.getByRole("button", { name: "要確認の投稿を見る" }));
  expect(navigate).toHaveBeenCalledWith("posts", "review");
});
it.each([
  [{ ...account, status: "expired" }, "accounts", "接続"],
  [{ ...account, queue_paused: 1 }, "accounts", "一時停止"],
  [
    { ...account, token_expires_at: "2026-10-27T00:00:00Z" },
    "accounts",
    "有効期限",
  ],
  [{ ...account, token_expires_at: null }, "accounts", "再確認"],
])(
  "uses saved connection/expiry state to choose the next step",
  (a, page, title) => {
    const result = nextAction(a as Account, summary({ drafts: 3 }), false, now);
    expect(result.page).toBe(page);
    expect(result.title).toContain(title);
    expect(result.create).not.toBe(true);
  },
);
it("detects a known expired date even before the next account-list refresh", () => {
  expect(
    nextAction(
      { ...account, token_expires_at: "2026-10-25T00:00:00Z" },
      summary(),
      false,
      now,
    ).tone,
  ).toBe("danger");
});
it("keeps an unsaved editor reachable without resetting it", () => {
  const { navigate, startNew } = view({ unsaved: true });
  fireEvent.click(screen.getByRole("button", { name: "編集を続ける" }));
  expect(navigate).toHaveBeenCalledWith("compose", undefined);
  expect(startNew).not.toHaveBeenCalled();
});
it("distinguishes absent, paused, overdue and in-progress reservations", () => {
  expect(scheduleSummary(account, summary(), now).label).toBe(
    "予約はありません",
  );
  expect(
    scheduleSummary(
      { ...account, queue_paused: 1 },
      summary({ queued: 2 }),
      now,
    ).label,
  ).toBe("再開待ち");
  expect(
    scheduleSummary(account, summary({ queued: 2, processing: 1 }), now).label,
  ).toBe("1件を処理中");
  expect(
    scheduleSummary(
      account,
      summary({ queued: 1, nextScheduledAt: "2026-10-25T00:00:00Z" }),
      now,
    ).label,
  ).toBe("公開条件の確認待ち");
  const future = "2026-10-27T00:00:00Z";
  expect(
    scheduleSummary(
      account,
      summary({ queued: 1, nextScheduledAt: future }),
      now,
    ).label,
  ).toBe(dateLabel(future));
});
it("does not invent empty counts or insight zeros while data is unavailable", () => {
  view({ overview: null });
  expect(screen.getByText("投稿の状況を確認しています")).toBeTruthy();
  expect(screen.getByText("読み込み中")).toBeTruthy();
  expect(screen.queryByText("予約はありません")).toBeNull();
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
});
it("shows saved metrics and keeps the news secondary to operation controls", () => {
  view();
  expect(
    screen.getByText("保存済みの集計です。未取得の数値は「—」で表示します。", {
      exact: false,
    }),
  ).toBeTruthy();
  const action = screen.getByRole("region", { name: "次にすること" }),
    news = screen.getByText("お知らせ");
  expect(
    action.compareDocumentPosition(news) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("Threads Harness 正式提供中")).toBeTruthy();
});
it("opens a recent group for review rather than submitting it", () => {
  const group = {
    id: "g",
    parts: [
      {
        id: "p",
        account_id: "123",
        text: "確認する原稿",
        status: "draft",
        media_json: "[]",
        chain_id: null,
        parent_id: null,
        part_index: null,
        created_at: "2026-10-26T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
    ],
  } as PostGroup;
  const { openGroup, startNew } = view({
    groups: [group],
    overview: summary({ drafts: 1 }),
  });
  fireEvent.click(
    screen.getByRole("button", { name: "投稿管理で確認: 確認する原稿" }),
  );
  expect(openGroup).toHaveBeenCalledWith(group);
  expect(startNew).not.toHaveBeenCalled();
});
it("gives a new workspace a connection-first guide without fictitious statistics", () => {
  const navigate = vi.fn();
  render(
    <Dashboard
      accountCount={0}
      overview={null}
      groups={[]}
      busy={false}
      unsaved={false}
      navigate={navigate}
      startNew={vi.fn()}
      openGroup={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "アカウントを接続" }));
  expect(navigate).toHaveBeenCalledWith("accounts");
  expect(screen.getByText("接続しただけでは、投稿されません。")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "投稿の状況" })).toBeNull();
});
