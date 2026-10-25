# 04 自分のCloudflare環境に配置

Node.js 22とPython 3を用意します。既存環境の更新は[10章](10-upgrade.md)へ。

- [ ] `npm ci` を実行する。
- [ ] `npx wrangler whoami` で自分のアカウントを確認する。
- [ ] `npx wrangler d1 create threads-harness` でD1を作る。
- [ ] `wrangler.jsonc` の `YOUR_D1_DATABASE_ID` を作成結果のIDに置換し、Worker名・DB名も確認する。
- [ ] 空の新規DBに `npx wrangler d1 migrations apply threads-harness --remote` を実行する。
- [ ] 以下の必須secretを設定する。既存環境の暗号鍵を再生成しない。

```sh
openssl rand -base64 32
npx wrangler secret put API_KEY
openssl rand -base64 32
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

2つの生成結果は別々に使います。前者は管理画面へのログインキー、後者は厳密に32バイトのbase64暗号鍵です。結果は秘密管理ツールに保管し、ログ・Git・チャットに残さないでください。

SSOを使う場合だけ `npx wrangler secret put ADMIN_SSO_SECRET`。32文字以上のランダムな共有秘密を設定します。非テスターの接続診断を使う場合だけ `npx wrangler secret put THREADS_APP_ACCESS_TOKEN`。詳細は[02章](02-meta-app.md)。

```sh
npm run check
npx wrangler deploy --dry-run
npx wrangler deploy --keep-vars
```

- [ ] dry-runのバインディングと配信先を確認してから本配信する。
- [ ] Worker URLの `/health` と管理画面を確認する。
- [ ] [接続手順](05-connect.md)へ進む。配備確認のために実投稿しない。

`--keep-vars` は配信先に設定された通常の環境変数を保持するためのフラグです。DB・アセット・コードのバックアップでも、誤った配信先を防ぐ機能でもありません。secretはWrangler secretで別管理します。
