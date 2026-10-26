# Threads Harness MCP（stdio）

MCP接続はAPIキーによる管理者権限です。`THREADS_HARNESS_READ_ONLY=true` では読み取り5ツールだけを登録し、HTTPクライアントも書き込みを拒否します。ただしAPIキー自体の権限は縮小しません。厳密な分離には別環境・キーを使います。

```json
{
  "mcpServers": {
    "threads-harness": {
      "command": "node",
      "args": ["/absolute/path/to/threads-harness-oss/mcp/index.mjs"],
      "env": {
        "THREADS_HARNESS_API_URL": "https://your-worker.workers.dev",
        "THREADS_HARNESS_API_KEY": "<secret-managerから設定>",
        "THREADS_HARNESS_READ_ONLY": "true"
      }
    }
  }
}
```

`npm ci` 後に使えます。Claude Codeはプロジェクトの `.mcp.json`、Cursorは `.cursor/mcp.json`、Claude DesktopはそのクライアントのMCP設定に同じエントリーを統合します。既存JSONを上書きせず、固定名を更新してください。設定は秘密を含むためGit管理外・本人だけが読める権限で保存します。このMCPはリポジトリ内のローカル実装で、公開npmパッケージの存在は前提にしません。

起動時にenvと `/api/accounts` を確認し、失敗はstderrへ出します。stdoutはMCPプロトコル専用。ツールはアカウント・稼働確認・原稿一覧・保存済みインサイト・現在の公開枠の5読み取りと、下書き・連投・予約・取消・インサイト取得・接続確認・保留予約の再開の7更新です。操作ごとにアカウントIDまたは投稿IDを指定します。

読み書きモードは `THREADS_HARNESS_READ_ONLY=false`。公開・予約は本文・対象アカウント・日時に対する本人の明示承認後に `confirmed=true` を指定します。パラメータは承認そのものを代替しません。通信失敗時は保存状態を確認し、更新・公開を自動再試行しません。接続トークンやアプリシークレットの入力ツールは公開しません。

保留予約の再開にも `confirmed=true` が必要です。再接続だけでは再開しません。絵文字の文字数計算は管理画面・Workerと同じ共通関数を使います。

Media drafts accept `media` (IMAGE/VIDEO public HTTPS URL items, up to 20). Captions may be empty with media. The create tool only saves; queue approval must cover every attachment URL and its order as well as the text/account/time. Read-only mode hides these write tools. File uploads are not supported.
