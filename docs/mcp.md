# Threads Harness 専用MCP（stdio、v0.2.0以降）

リポジトリ内のローカルMCPです。公開npmパッケージや、リモートHTTPのMCPエンドポイントではありません。Node.js 22でリポジトリを取得し、`npm ci` 後に `mcp/index.mjs` を実行します。**接続先もv0.2.0以降**を使用してください。固定版のCloud環境は版を確認します。

## 設定

JSON形式のMCPクライアントでは、既存設定に次のエントリーを追加します。絶対パスと環境URLを実際の値へ変更し、APIキーはクライアントのシークレット管理機能で設定してください。

```json
{
  "mcpServers": {
    "threads-harness": {
      "command": "node",
      "args": ["/absolute/path/to/threads-harness-oss/mcp/index.mjs"],
      "env": {
        "THREADS_HARNESS_API_URL": "https://your-worker.workers.dev",
        "THREADS_HARNESS_API_KEY": "<環境のAPIキー>",
        "THREADS_HARNESS_READ_ONLY": "true"
      }
    }
  }
}
```

Codexは `~/.codex/config.toml` またはプロジェクトの `.codex/config.toml` に追加します。既存設定を上書きしないでください。[公式のMCP設定仕様](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)。

```toml
[mcp_servers.threads-harness]
command = "node"
args = ["/absolute/path/to/threads-harness-oss/mcp/index.mjs"]
env = { THREADS_HARNESS_API_URL = "https://your-worker.workers.dev", THREADS_HARNESS_READ_ONLY = "true" }
env_vars = ["THREADS_HARNESS_API_KEY"]
```

上のCodex例は、ローカル実行環境で設定した `THREADS_HARNESS_API_KEY` を渡します。設定ファイルにキーを直接記入する場合はGit管理外・本人だけが読める権限で扱います。チャットや公開リポジトリに貼らないでください。Cloudコンソールにも環境ごとの設定例があります。

## 権限と確認

初期値は読み取り専用です（変数省略時もtrue）。`THREADS_HARNESS_READ_ONLY=false` を明示すると更新ツールが表示されます。読み取り専用では更新ツールを登録せず、HTTPクライアントも非GETを拒否します。ただし**APIキー自体は環境内の全アカウントの管理権限**です。サーバー側の読み取り専用キーやスタッフ権限ではありません。

各操作で `accountId` を指定します。原稿単位の更新では、MCPが指定アカウントの原稿を取得して照合し、APIにも同じaccountIdを渡します。切替中に他アカウントへ送らないための確認であり、悪意あるクライアントを隔離する権限ではありません。別のお客様は別環境で運用します。

公開・予約・再開・非表示では `confirmed:true` が必要です。値を設定するだけで本人の承認になるわけではありません。本文・全素材・順番・投稿先・日時を確認してから実行してください。通信失敗時は保存状態を照合し、更新・公開を自動再試行しません。

## 16ツール

| 読み取り7ツール | 用途 |
|---|---|
| threads_accounts | 全アカウントの保存済み接続状態・期限 |
| threads_health | 設定・DBの準備確認 |
| threads_posts | 原稿一覧。accountId、limit（既定50）、cursor、status。items/paginationを返す |
| threads_get_post | accountIdとpostIdを指定して原稿1件を取得 |
| threads_overview | 選択アカウントの全件集計・6指標（非表示除外） |
| threads_insights | 旧形式の保存済み集計（非表示の公開履歴も含む） |
| threads_publishing_limits | Metaの現在の投稿/返信枠。返信枠は追加権限が必要 |

| 更新9ツール | 用途 |
|---|---|
| threads_create_draft | 本文・素材を下書き保存。公開しない |
| threads_create_chain | 2〜10件の連投を下書き保存。partsは文字列または{text,media} |
| threads_update_draft | accountId/postIdを照合し、本文または素材を編集 |
| threads_queue | accountId/postId/confirmed、任意scheduledAtで公開・予約 |
| threads_cancel | accountId/postIdを照合して予約取消 |
| threads_archive | accountId/postId/confirmedで一覧から非表示。Meta投稿は削除しない |
| threads_fetch_insights | accountId/postIdを照合してMetaの6指標を取得・保存 |
| threads_check_connection | 保存トークンの権限・期限を再確認 |
| threads_resume_queue | accountId/confirmedで保留中の予約を再開。期限超過の原稿は順次公開 |

`media` は `{type:"IMAGE"|"VIDEO",url:"https://..."}` の配列です。1件は単体、2〜20件はカルーセル。素材ありなら本文は空にできます。直接ファイルアップロードはありません。

接続トークンやアプリシークレットを入力するツールは公開しません。接続・切断は本人の管理画面で行います。起動時は環境設定と認証を検証し、stdoutはMCPプロトコル専用、診断はstderrへ出します。

## 旧版からの変更

v0.2.0では、原稿単位の更新にもaccountIdが必須です。原稿一覧は配列そのものではなく `{items,pagination}` を返します。読み書きモードを使う場合はREAD_ONLY=falseを明示してください。RESTの既存data配列や省略可能なaccountIdとは区別します。[REST APIとOpenAPI](api.md)。
