# Threads Harness (OSS alpha)

Meta Threadsの下書き・連投・予約投稿・インサイトを扱う、Cloudflare Worker + D1 + Durable Objects + React/Kumoの管理画面。MITライセンス。

**OAuthログイン、自動トークン更新、画像投稿、成否不明投稿の照合UIは未実装です。** Metaで取得したThreadsユーザートークンを貼り付けて接続します。実アカウントでの投稿E2Eは未検証です。

## はじめる

1. [概要と制限](docs/manual/01-intro.md)を読み、セルフホストか[The Harness Cloud](https://theharness.cloud/)を選ぶ。
2. [Metaアプリとテスター](docs/manual/02-meta-app.md)を設定し、[トークンを準備](docs/manual/03-token.md)する。
3. セルフホストは[Cloudflareへの配置](docs/manual/04-deploy.md)、開設済みなら[接続と再接続](docs/manual/05-connect.md)へ。

[マニュアル全10章](docs/manual/README.md) / [English](README.en.md) / [Security](SECURITY.md) / [Changelog](CHANGELOG.md)

## 開発

Node.js 22 / Python 3。

```sh
npm ci
npm run check
python3 -m unittest discover -s test -p 'test_*.py'
```

ローカル起動には[開発ガイド](docs/manual/09-local-dev.md)のDB・秘密設定も必要です。接続テストはMetaのモックを使い、SNSへ送信しません。

## 自動化とホスト側の実装

[stdio MCPの接続・読み取り専用モード](docs/mcp.md)。`npm run mcp` で起動します。

[旧Pythonワークフロー](docs/legacy-workflow.md)は下書き転送専用です。必要な環境変数は同ガイドを参照してください。
`npm run build:wfp-bundle` はWorker・アセット・新規DB用schema・DO定義を `dist-worker/wfp-bundle` に出力します。既存DBにschemaを再実行しないでください。秘密・所有者管理・ルーティング・既存テナントのmigrationはcontrol plane側の責任です。
