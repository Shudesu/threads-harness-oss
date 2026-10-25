# 07 問題の切り分け

| 症状・コード | 確認と対処 |
|---|---|
| 401 | 管理画面のAPIキーがそのWorkerの値か確認。Threadsトークンとは別 |
| 503 Service not configured | `API_KEY` が未設定。ローカルは `.dev.vars` を確認 |
| encryption_key_invalid | 32バイトbase64の暗号鍵か確認。既存鍵を安易に再生成しない |
| threads_meta_190 / 190_463 | 無効・失効トークン。Threads用のトークンを再発行して接続 |
| missing_permissions | 表示された権限をMeta側で追加し、ユーザー承認後に再発行 |
| token_inspection_failed | テスター承認、診断用アプリトークンの有効性・同じアプリかを確認 |
| threads_meta_10 / 200 | 権限・対象ユーザー・Metaアプリの設定を確認 |
| HTTP 429 / Meta 4,17,32,613 | 利用制限。間隔を空ける。公開を無条件に再試行しない |
| connection_check_failed | 通信・タイムアウト。Metaと通信できる環境で接続確認を再実行 |
| 接続後しばらくして停止 | トークンとデータアクセスの両方の期限を確認 |
| 期限が不明 | 接続状態を確認。Metaから期限が得られない場合はMeta側で確認 |
| 予約できない | 接続状態、予約日時までの期限、下書き状態を確認 |
| needs_review | 診断コードとThreads側の投稿結果を照合。自動再送しない |
| /api/health のready=false | 認証付きで設定・migrationの準備状態を確認。公開/healthは生存確認のみ |
| 汎用500 | DBの実スキーマ・migration・バインディング・暗号鍵の変更有無を確認 |
| SSO 403 | 任意secretが32文字以上か、0002適用、TTL・署名・再使用・時計差を確認 |

問い合わせには時刻、操作、HTTPステータス、安全な診断コード、使用コミットを記載します。トークン、鍵、SSO URL、D1の内容は送らないでください。
