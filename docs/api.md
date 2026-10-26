# Threads Harness REST API（v0.2.0以降）

[OpenAPI 3.1仕様](../openapi.json)を同梱しています。各環境の `GET /openapi.json` からも取得できます。APIのベースURLはその環境のWorker URLです。

## 認証とアカウントの範囲

`/api/*` は `Authorization: Bearer <環境のAPIキー>` が必要です。Threadsアクセストークンではありません。`GET /health` と `GET /openapi.json` は公開です。キーはシークレット管理機能や環境変数で設定し、URL・チャット・公開Gitに含めないでください。

1つの環境に複数のThreadsアカウントを接続できます。APIキーは**環境全体の管理者権限**であり、アカウント単位の権限分離や読み取り専用キーではありません。同じ運用者のアカウントをまとめ、別のお客様のデータは別環境に分けます。Cloudの作成可能数・利用上限は契約条件に従います。

`accountId` は `GET /api/accounts` の `id` です。ワークスペースIDやユーザー名とは別です。投稿単位の更新でも `accountId` を指定すると、原稿の所有アカウントとの食い違いを `409 account_mismatch` で拒否します。これは誤操作防止で、APIキー自体の権限縮小ではありません。既存RESTクライアントとの互換のため更新時の省略は許容しますが、新規クライアントは必ず指定してください。

```sh
curl "$THREADS_HARNESS_API_URL/api/accounts" \
  -H "Authorization: Bearer $THREADS_HARNESS_API_KEY"
```

通常の応答は `{ "success": true, "data": ... }`、失敗は `{ "success": false, "error": "説明", "code": "固定コード（ある場合）" }` です。Meta由来の診断は数値コード・分類だけを返し、生の上流本文は公開しません。

## エンドポイント

| 操作 | メソッド・パス | 主な指定 |
|---|---|---|
| 環境の準備確認 | GET `/api/health` | なし |
| アカウント一覧 | GET `/api/accounts` | なし |
| アカウント追加・再接続 | POST `/api/accounts` | `accessToken`（本人の管理画面からの設定を推奨） |
| 権限・期限を再確認 | POST `/api/accounts/{id}/check` | アカウントID |
| 切断 | POST `/api/accounts/{id}/disconnect` | 保存トークン消去・履歴保持 |
| 予約再開 | POST `/api/accounts/{id}/resume` | `confirmed: true`、保留原稿全件の確認が必要 |
| Metaの現在の枠 | GET `/api/accounts/{id}/limits` | 返信枠は `?replies=1` |
| 原稿一覧 | GET `/api/posts` | `accountId`必須、`limit`、`cursor`、`status` |
| 原稿1件 | GET `/api/posts/{id}` | `accountId`必須、非表示の履歴も取得可 |
| 下書き作成 | POST `/api/posts` | `accountId`, `text`, `media` |
| 連投下書き | POST `/api/chains` | `accountId`, `parts`（2〜10件） |
| 下書き編集 | PATCH `/api/posts/{id}` | `accountId`, `text`または`media`、省略分は保持 |
| 公開・予約 | POST `/api/posts/{id}/queue` | `accountId`, 任意の`scheduledAt` |
| 予約取消 | POST `/api/posts/{id}/cancel` | `accountId`、公開待ちのみ |
| 一覧から非表示 | POST `/api/posts/{id}/archive` | `accountId`、Meta投稿は削除しない |
| Metaインサイト取得 | POST `/api/posts/{id}/insights` | `accountId` |
| 全件集計 | GET `/api/overview` | `accountId`、非表示除外・6指標 |
| 旧インサイト集計 | GET `/api/insights` | `accountId`、公開IDのある非表示履歴も含む |
| 環境全体の件数 | GET `/api/usage` | 非表示履歴も含む |

### ページ送り

原稿一覧の `data` は旧版と同じ配列です。`pagination` に `limit`・`nextCursor`・`hasMore` が追加されます。limitは1〜200（既定200）。非表示の原稿は一覧に含めません。

```json
{"success":true,"data":[{"id":"...","account_id":"...","text":"...","status":"draft"}],"pagination":{"limit":50,"nextCursor":"...","hasMore":true}}
```

次のリクエストでは、同じaccountId・statusに返却されたcursorをそのまま指定します。created_at/idの降順で、日時が同じ原稿もIDで区別します。並行更新中の厳密なスナップショットではないため、取得済みIDで照合してください。MCPの原稿一覧は `{items,pagination}` を返します。

### 下書きから公開まで

```json
{"accountId":"<Threads account id>","text":"確認済みの本文","media":[{"type":"IMAGE","url":"https://cdn.example.com/image.png"}]}
```

mediaは省略可（テキスト）、1件なら画像/動画、2〜20件ならカルーセルです。素材がある場合は本文を省略できます。本文は絵文字のUTF-8換算を含め500以内。GETの `media_json` は素材配列をJSON文字列として保存したものです。

1. 下書きを保存してIDを受け取る。保存だけでは公開しない。
2. 原稿1件や連投全件を取得し、投稿先・本文・素材順・日時を本人が確認する。
3. 先頭原稿のqueueへ `{"accountId":"...","scheduledAt":"2026-10-27T09:00:00+09:00"}` を送る。scheduledAt省略は即時の処理開始。
4. 保存済みstatusとpublished_idを読み、完了または確認待ちを確認する。

日時は未来のISO日時（タイムゾーン付き）を推奨します。**指定時刻は公開処理の開始時刻**です。コンテナ作成後60秒待機するため、実測では約70秒後の公開になりました。正確な秒単位の公開は保証しません。

連投は先頭からまとめて公開・取消・非表示します。子だけの操作は拒否します。素材URLは公開完了まで認証不要で取得できる状態を維持してください。直接ファイルアップロードはありません。

## 状態・失敗・再試行

- `draft` → `queued` → `creating` → `processing` → `publishing` → `published`。
- `failed`: 公開前に停止。原因を確認する。
- `needs_review`: 成否不明などで停止。Threads側の結果を照合し、自動再送しない。
- トークン無効: アカウントを停止し、未処理予約を保持。再接続と予約再開は別操作。
- `archived`: 一覧から非表示。投稿・所有関係・履歴は保持。

400は入力、401は環境APIキー、409は状態/投稿先/枠の競合、422は接続の再確認、502はMeta応答、503は設定を確認します。500や通信切断後は、作成・更新が反映済みの可能性があります。**書き込みを盲目的に再試行しないでください。** 下書き作成は独自の冪等キーを提供していません。公開キューは状態チェックで二重投入を拒否しますが、別の下書きとしての再作成を自動再試行に使わないでください。

APIに独自の固定RPS上限はありません。Cloudflare・D1・Metaの制限に従い、429やMeta rate_limitedでは間隔を空けます。保存済みの状態を読むAPIと、Metaへ問い合わせるcheck/limits/insightsを区別してください。
