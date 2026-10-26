// @vitest-environment happy-dom
import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
  act,
} from "@testing-library/react";
import { App } from "../web/app";
import type { Account, Post } from "../web/model";

const account: Account = {
  id: "123",
  username: "fixture_owner",
  status: "connected",
  queue_paused: 0,
  pending_count: 0,
  token_expires_at: "2099-01-01T00:00:00Z",
  data_access_expires_at: "2099-02-01T00:00:00Z",
  permissions_checked_at: "2026-10-26T00:00:00Z",
  last_error_code: null,
  last_error_kind: null,
};
const post = (id: string, extra: Partial<Post> = {}): Post => ({
  id,
  account_id: "123",
  text: "保存済みの原稿",
  media_json: "[]",
  status: "draft",
  parent_id: null,
  chain_id: null,
  part_index: null,
  scheduled_at: null,
  published_id: null,
  error_code: null,
  error_kind: null,
  next_attempt_at: null,
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
  insights_updated_at: null,
  views: null,
  likes: null,
  replies: null,
  reposts: null,
  quotes: null,
  shares: null,
  ...extra,
});
let posts: Post[],
  accounts: Account[],
  calls: { path: string; method: string; body: any }[],
  fetcher: any;
const writes = () => calls.filter((c) => c.method !== "GET");
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("threads_api_key", "fixture-key");
  window.location.hash = "";
  posts = [];
  accounts = [{ ...account }];
  calls = [];
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute("open");
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const path =
        new URL(input, "https://fixture.test").pathname +
        new URL(input, "https://fixture.test").search,
      method = init?.method ?? "GET",
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    let data: any;
    const scopedPosts = posts.filter(
      (p) =>
        p.account_id ===
        new URL(input, "https://fixture.test").searchParams.get("accountId"),
    );
    if (path === "/api/accounts" && method === "GET") data = accounts;
    else if (path.startsWith("/api/posts?")) data = scopedPosts;
    else if (path.startsWith("/api/overview?"))
      data = {
        total: scopedPosts.length,
        drafts: scopedPosts.filter((p) => p.status === "draft").length,
        queued: scopedPosts.filter((p) => p.status === "queued").length,
        published: scopedPosts.filter((p) => p.status === "published").length,
        needsReview: 0,
        measured: 0,
        views: null,
        likes: null,
        replies: null,
        reposts: null,
        quotes: null,
        shares: null,
        insightsUpdatedAt: null,
      };
    else if (path === "/api/posts" && method === "POST") {
      const p = post("new", {
        text: body.text,
        media_json: JSON.stringify(body.media),
      });
      posts.unshift(p);
      data = { id: p.id };
    } else if (path === "/api/chains" && method === "POST") {
      posts = body.parts.map((text: string, i: number) =>
        post("chain-" + i, {
          text,
          chain_id: "chain",
          part_index: i,
          parent_id: i ? "chain-0" : null,
        }),
      );
      data = { chainId: "chain", ids: posts.map((p) => p.id) };
    } else if (path.endsWith("/queue")) {
      const id = path.split("/")[3],
        p = posts.find((p) => p.id === id)!;
      for (const item of posts.filter(
        (x) => x.id === id || (p.chain_id && x.chain_id === p.chain_id),
      ))
        item.status = "queued";
      data = {
        queued: true,
        limits: {
          posts: { remaining: 249, total: 250 },
          checkedAt: new Date().toISOString(),
        },
      };
    } else if (path.endsWith("/archive")) {
      posts = posts.filter((p) => p.id !== path.split("/")[3]);
      data = { archived: true };
    } else if (path === "/api/accounts" && method === "POST") {
      if (!accounts.length) accounts = [{ ...account }];
      data = { id: "123", username: account.username };
    } else if (path.endsWith("/insights"))
      data = {
        views: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
        shares: 0,
      };
    else throw Error("Unexpected fixture endpoint " + path + " " + method);
    return Response.json({ success: true, data });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
const openApp = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "ダッシュボード", level: 1 });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "更新" }).hasAttribute("disabled"),
    ).toBe(false),
  );
};
const nav = (name: string) =>
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "主ナビゲーション" }),
    ).getByRole("button", { name }),
  );

it("automatically consumes the existing SSO key and exposes only implemented navigation", async () => {
  await openApp();
  expect(
    screen.queryByRole("heading", { name: "ワークスペースにログイン" }),
  ).toBeNull();
  const menu = within(
    screen.getByRole("navigation", { name: "主ナビゲーション" }),
  );
  for (const name of [
    "ダッシュボード",
    "投稿管理",
    "新規投稿",
    "予約一覧",
    "インサイト",
    "アカウント設定",
  ])
    expect(menu.getByRole("button", { name })).toBeTruthy();
  expect(menu.queryByText("DM")).toBeNull();
  expect(writes()).toHaveLength(0);
  nav("アカウント設定");
  expect(
    await screen.findByRole("heading", { name: "アカウント設定", level: 1 }),
  ).toBeTruthy();
  expect(screen.getByLabelText("Threadsアクセストークン")).toBeTruthy();
});
it("saves media drafts from the new composer without queueing or publishing", async () => {
  await openApp();
  nav("新規投稿");
  fireEvent.change(screen.getByLabelText("投稿形式"), {
    target: { value: "IMAGE" },
  });
  fireEvent.change(screen.getByLabelText("素材1の公開URL"), {
    target: { value: "https://cdn.example.com/a.png" },
  });
  fireEvent.click(screen.getByRole("button", { name: "下書きを保存" }));
  await screen.findByText("下書きを保存しました。まだ公開していません。");
  expect(writes()).toEqual([
    {
      path: "/api/posts",
      method: "POST",
      body: {
        accountId: "123",
        text: "",
        media: [{ type: "IMAGE", url: "https://cdn.example.com/a.png" }],
      },
    },
  ]);
});
it("preserves unsaved content when navigating between pages and rejects an unconfirmed account switch", async () => {
  accounts.push({ ...account, id: "456", username: "other" });
  await openApp();
  nav("新規投稿");
  fireEvent.change(screen.getByLabelText("本文"), {
    target: { value: "未保存の本文" },
  });
  nav("ダッシュボード");
  nav("新規投稿");
  expect((screen.getByLabelText("本文") as HTMLTextAreaElement).value).toBe(
    "未保存の本文",
  );
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.change(screen.getByLabelText("操作中のThreadsアカウント"), {
    target: { value: "456" },
  });
  expect(
    (screen.getByLabelText("操作中のThreadsアカウント") as HTMLSelectElement)
      .value,
  ).toBe("123");
  expect(writes()).toHaveLength(0);
});
it("reviews the complete chain and attachments, then queues the head exactly once", async () => {
  posts = [
    post("head", { text: "1件目の全文", chain_id: "chain", part_index: 0 }),
    post("child", {
      text: "2件目の全文",
      chain_id: "chain",
      part_index: 1,
      parent_id: "head",
      media_json: JSON.stringify([
        { type: "VIDEO", url: "https://cdn.example.com/a.mp4" },
      ]),
    }),
  ];
  await openApp();
  nav("投稿管理");
  fireEvent.click(screen.getByRole("button", { name: "連投の公開・予約" }));
  const dialog = within(screen.getByRole("dialog", { name: "公開内容を確認" }));
  expect(dialog.getByText("1件目の全文")).toBeTruthy();
  expect(dialog.getByText("2件目の全文")).toBeTruthy();
  expect(
    dialog.getByRole("link", { name: "https://cdn.example.com/a.mp4" }),
  ).toBeTruthy();
  expect(writes()).toHaveLength(0);
  const confirm = dialog.getByRole("button", { name: "この内容で公開を開始" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await screen.findByText(
    "公開待ちに登録しました。処理が完了すると公開済みに変わります。",
  );
  expect(writes()).toEqual([
    {
      path: "/api/posts/head/queue",
      method: "POST",
      body: { accountId: "123" },
    },
  ]);
});
it("does not queue when the saved content changed after opening the review", async () => {
  posts = [post("head")];
  await openApp();
  nav("投稿管理");
  fireEvent.click(screen.getByRole("button", { name: "公開・予約" }));
  posts[0].text = "外部で変更された本文";
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "この内容で公開を開始",
    }),
  );
  await screen.findByText(
    "原稿の内容または状態が変更されました。閉じて最新の原稿から確認し直してください。",
  );
  expect(writes()).toHaveLength(0);
});
it("requires a future schedule and sends the chosen timestamp only after review", async () => {
  posts = [post("head")];
  await openApp();
  nav("投稿管理");
  fireEvent.click(screen.getByRole("button", { name: "公開・予約" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByLabelText("日時を指定する"));
  expect(
    dialog
      .getByRole("button", { name: "この内容で予約する" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(dialog.getByLabelText("公開処理の開始日時"), {
    target: { value: "2099-01-01T12:30" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "この内容で予約する" }));
  await screen.findByText("指定日時から公開処理を開始します。");
  expect(writes()[0].body).toEqual({
    scheduledAt: new Date("2099-01-01T12:30").toISOString(),
    accountId: "123",
  });
});
it("separates published posts and unknown insight values from empty or zero results", async () => {
  posts = [
    post("draft", { text: "未公開" }),
    post("pub", {
      text: "公開済み",
      status: "published",
      published_id: "999",
      views: 0,
      likes: 0,
    }),
  ];
  await openApp();
  nav("投稿管理");
  fireEvent.click(
    within(
      screen.getByRole("group", { name: "投稿の状態で絞り込み" }),
    ).getByRole("button", { name: "公開済み" }),
  );
  expect(screen.queryByText("未公開")).toBeNull();
  nav("インサイト");
  const table = screen.getByRole("table");
  expect(within(table).getAllByText("0")).toHaveLength(2);
  expect(within(table).getAllByText("—")).toHaveLength(4);
  expect(writes()).toHaveLength(0);
});
it("opens the mobile menu and closes it on navigation without any mutation", async () => {
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  const mobile = within(
    screen.getByRole("navigation", { name: "モバイルナビゲーション" }),
  );
  fireEvent.click(mobile.getByRole("button", { name: "予約一覧" }));
  await screen.findByRole("heading", { name: "予約一覧", level: 1 });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("keeps server errors visible and clears a rejected SSO key", async () => {
  fetcher.mockImplementation(async () =>
    Response.json({ success: false, error: "Unauthorized" }, { status: 401 }),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "ワークスペースにログイン" });
  await screen.findByRole("alert");
  expect(sessionStorage.getItem("threads_api_key")).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("requires an explicit confirmation to hide a published post without deleting it", async () => {
  posts = [post("pub", { status: "published", published_id: "999" })];
  await openApp();
  nav("投稿管理");
  fireEvent.click(screen.getByRole("button", { name: "一覧から非表示" }));
  expect(writes()).toHaveLength(0);
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText(/Threads上の投稿は削除されません/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "非表示にする" }));
  await screen.findByText(
    "一覧から非表示にしました。Threads上の投稿と履歴は保持されます。",
  );
  expect(writes()[0]).toMatchObject({
    path: "/api/posts/pub/archive",
    method: "POST",
  });
});

it("does not restore account data from a late polling response after logout", async () => {
  await openApp();
  vi.useFakeTimers();
  let resolve: (value: Response) => void = () => {};
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  act(() => {
    vi.advanceTimersByTime(15000);
  });
  fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
  await act(async () => {
    resolve(Response.json({ success: true, data: [account] }));
    await Promise.resolve();
  });
  expect(
    screen.getByRole("heading", { name: "ワークスペースにログイン" }),
  ).toBeTruthy();
  expect(sessionStorage.getItem("threads_api_key")).toBeNull();
  expect(
    screen.queryByRole("navigation", { name: "主ナビゲーション" }),
  ).toBeNull();
});
it("skip-to-content keeps the current page instead of routing back to the dashboard", async () => {
  await openApp();
  nav("インサイト");
  fireEvent.click(screen.getByRole("link", { name: "本文へ移動" }));
  expect(
    screen.getByRole("heading", { name: "インサイト", level: 1 }),
  ).toBeTruthy();
  expect(window.location.hash).toBe("#insights");
});

it("takes a fresh workspace from the empty dashboard to connection without publishing", async () => {
  accounts = [];
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: "アカウントを接続" }));
  fireEvent.change(screen.getByLabelText("Threadsアクセストークン"), {
    target: { value: "fixture-meta-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "接続を確認して保存" }));
  await screen.findByText("アカウントを接続しました。");
  expect(
    (screen.getByLabelText("Threadsアクセストークン") as HTMLInputElement)
      .value,
  ).toBe("");
  expect(screen.getAllByText("@fixture_owner").length).toBeGreaterThan(0);
  expect(writes()).toEqual([
    {
      path: "/api/accounts",
      method: "POST",
      body: { accessToken: "fixture-meta-token" },
    },
  ]);
});

it("restores the selected account and keeps its posts isolated while switching from the directory", async () => {
  accounts.push({ ...account, id: "456", username: "second_owner" });
  posts = [
    post("a", { text: "FIRST ACCOUNT" }),
    post("b", { account_id: "456", text: "SECOND ACCOUNT" }),
  ];
  sessionStorage.setItem("threads_selected_account", "456");
  await openApp();
  nav("投稿管理");
  expect(screen.getByText("SECOND ACCOUNT")).toBeTruthy();
  expect(screen.queryByText("FIRST ACCOUNT")).toBeNull();
  nav("アカウント設定");
  fireEvent.click(screen.getByRole("button", { name: "このアカウントを操作" }));
  await waitFor(() =>
    expect(sessionStorage.getItem("threads_selected_account")).toBe("123"),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "更新" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  nav("投稿管理");
  expect(screen.getByText("FIRST ACCOUNT")).toBeTruthy();
  expect(screen.queryByText("SECOND ACCOUNT")).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("shows a readonly MCP configuration without embedding the session credential", async () => {
  await openApp();
  nav("MCP・API連携");
  expect(
    screen.getByRole("heading", { name: "MCP・API連携", level: 1 }),
  ).toBeTruthy();
  expect(document.body.textContent).toContain("THREADS_HARNESS_READ_ONLY");
  expect(document.body.textContent).not.toContain("fixture-key");
  expect(
    screen
      .getByRole("link", { name: "この環境のOpenAPI仕様を開く ↗" })
      .getAttribute("href"),
  ).toBe("/openapi.json");
  expect(writes()).toHaveLength(0);
});
