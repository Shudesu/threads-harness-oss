# 01 概要と前提

単一WorkerにHTTP APIとDurable Objectスケジューラ、D1、React/Kumo管理画面をまとめたalphaです。モノレポやインストーラーではありません。

| 項目 | セルフホスト | The Harness Cloud |
|---|---|---|
| Worker / D1 / 秘密の管理 | 自分で配置・更新・バックアップ | ホスト側で管理 |
| 管理画面 | 自分のWorker URL | Cloud側のワークスペースから開く |
| Threads接続 | Metaで発行したユーザートークン | 実際の投稿には同様に有効な接続が必要 |
| この手順のmigration | 自分のD1に実施 | ホスト運営者の更新手順に従う |

APIキーを持つ人は環境全体の管理者です。顧客ごとにWorker・D1・秘密を分離します。接続確認や下書き保存だけでは投稿しません。

OAuthログイン、自動更新、画像投稿、成否不明の照合UIは未実装。Webhook受信は使わず、投稿状態はAPIで取得します。MetaのWebhook設定はこのalphaの動作に不要です。実アカウントでの公開E2Eは未完了です。

次: [Meta設定](02-meta-app.md)
