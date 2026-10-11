# Threads Harness (OSS alpha)

Meta Threads用の管理画面と予約投稿Worker。React / Cloudflare Kumo、Hono、D1、Durable Objectsで動作します。MITライセンス。

## 機能

- アカウント単位の下書き・編集・日時指定の予約・論理非表示
- 2〜10件の連投。前の記事の公開IDを得てから次を返信として送信
- インサイト取得と保存済み指標の集計。未取得はnullで保持
- SQLによる処理の取得、成否不明時の隔離、後続連投の停止
- APIキー認証、AES-GCMによるトークン保存、一回限りの管理者SSO
- 旧Python原稿生成器のJSON出力をクラウド下書きへ渡すアダプター

**alpha版です。** 実アカウントによる公開の通し検証は未完了。OAuth、画像投稿、トークン自動更新、成否不明投稿の照合UIは未実装です。APIキーを持つ人はその環境の管理者です。顧客ごとにWorker・D1・秘密鍵を分離してください。[The Harness Cloud](https://theharness.cloud/) でもアルファ版の環境を開設できます。SNSトークンなしで環境を作れますが、実際の投稿には有効なThreadsアカウントの接続が必要です。

## 開発・検証

Node.js 22とPython 3を使用します。依存導入とテストは同じNodeバージョンで実行してください。

```sh
npm ci
npm run check
python3 -m unittest discover -s test -p 'test_*.py'
```

## 自分のCloudflare環境にデプロイ

Cloudflareの認証先を確認し、D1を作成してwrangler.jsoncのdatabase_idを置き換えます。

```sh
npx wrangler whoami
npx wrangler d1 create threads-harness
```

新規の空DBにのみ全migrationを適用してください。既存DBは実スキーマとmigration履歴を確認してから適用します。

```sh
npx wrangler d1 migrations apply threads-harness --remote
npx wrangler secret put API_KEY
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put ADMIN_SSO_SECRET
npm run build
npx wrangler deploy --dry-run
npx wrangler deploy --keep-vars
```

API_KEYはランダムな管理用キー、TOKEN_ENCRYPTION_KEYは32バイトのランダム値のbase64です。後者を変えると保存済みトークンが読めなくなるため、更新デプロイで再生成しないでください。ADMIN_SSO_SECRETはSSOを利用する場合の共有秘密です。秘密をGit・チャット・ログへ保存しないでください。

デプロイ先にAPIキーでログインし、接続画面でThreads用アクセストークンを入力します。プロフィールを確認して暗号化保存します。公開にはthreads_content_publish、分析にはthreads_manage_insightsが必要です。投稿は下書き保存後に明示的に予約・公開します。

## 自動原稿・連投API

[旧VPSワークフローからの移行](docs/legacy-workflow.md)を参照してください。アダプターは下書きだけを保存し、成否不明の転送を再送しません。実アカウントや旧ログ、以前の運用者のプロンプト・数値は含みません。

## Workers for Platforms

`npm run build:wfp-bundle` はWorker、静的アセット、schema、DO定義をdist-worker/wfp-bundleへ生成します。API_KEY、TOKEN_ENCRYPTION_KEY、ADMIN_SSO_SECRETの注入と、テナントのルーティング・所有者管理は呼び出すcontrol plane側で実装します。

## 検証範囲

SQLiteで予約の同時取得、途中失敗、連投順序、SSOのリプレイ拒否を検証し、型チェックと静的ビルドを実行します。テストは外部SNSへ投稿しません。ビューの数値やBANの回避を保証するものではありません。
