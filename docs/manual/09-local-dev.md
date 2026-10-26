# 09 ローカル開発

Node.js 22とPython 3を使用します。ネイティブ依存があるため、依存導入とテストは同じNode版で実行します。

```sh
npm ci
cp .dev.vars.example .dev.vars
```

`.dev.vars` にローカル専用のAPIキーと暗号鍵を設定します。生成例は `openssl rand -base64 32`。本番の秘密をコピーしないでください。SSOと診断用アプリトークンは使う場合だけ設定します。`.env.example` は参考で、Wranglerのローカル起動は `.dev.vars` を使います。

```sh
npx wrangler d1 migrations apply threads-harness --local
npm run build:web
npm run dev
```

端末に表示されたローカルURLを使います。UI変更後は `npm run build:web` でアセットを作り直してください。ローカル起動でも有効なSNSトークンを入れて公開操作をすると外部へ送信するため、テストではモックを使います。

```sh
npm run check
python3 -m unittest discover -s test -p 'test_*.py'
npm run build:wfp-bundle
```

接続・権限・期限・鍵形式・予約・連投の停止・SSO・JSONCをローカルで検証します。HTTP/CLIで確認し、ブラウザ自動操作や実SNS投稿をテストに含めません。
