# 10 更新とバックアップ

1. 対象Worker・Cloudflareアカウント・D1のIDを確認する。保存済みAPIキーと暗号鍵を保持する。
2. `npx wrangler d1 export threads-harness --remote --output <保護したバックアップ先>/threads-日時.sql` でバックアップする。ファイルには機密が含まれるのでGit管理外・アクセス制限付きの場所に保存する。大きい出力は外部ディスクを使う。
3. `npx wrangler d1 migrations list threads-harness --remote` と実スキーマを確認する。例: `npx wrangler d1 execute threads-harness --remote --command "PRAGMA table_info(threads_accounts)"`。同様に `threads_posts` を確認する。
4. 0001〜0006の履歴と実列が対応している場合だけ、未適用分を `npx wrangler d1 migrations apply threads-harness --remote` で適用する。0003〜0006のALTER TABLEは再実行不可。履歴不一致・列だけ存在する場合は止めて差分を調べる。SQLファイルをまとめて流し直さない。
5. `npm ci` → `npm run check` → Pythonテスト → `npx wrangler deploy --dry-run`。
6. 配信先とバインディングを再確認し `npx wrangler deploy --keep-vars`。失敗時にmigrationをやり直したり古いschemaを上書きしない。
7. ログイン、既存履歴、接続状態・期限を確認する。旧アカウントは期限が不明のまま移行されるため「接続状態を確認」を使う。更新確認のための実投稿は不要。

0004は期限2列・権限確認時刻・安全なエラーコードを追加します。既存のトークンや履歴を削除しません。0005はアカウント別DOの振り分け列を追加します。既存の予約・処理中ジョブは旧tenant DOが引き続き処理し、新規予約だけアカウントDOへ渡します。旧DOの削除や既存ジョブの手動振り替えは不要です。

0006は予約の一時停止・再確認時刻/回数・安全な診断分類・sharesを追加します。既存予約を削除せず、初期値では停止しません。

新しいコードを0004〜0006未適用のDBへ配信すると失敗します。

復旧時は元DBを消さず、バックアップを別のDBへ復元してスキーマ・件数を確認してから切り替えます。バックアップには暗号化トークンが含まれ、復号には元の暗号鍵が必要です。誤った鍵への変更は復旧になりません。
