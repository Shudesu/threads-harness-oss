# 07 問題の切り分け

| 症状・コード | 確認と対処 |
|---|---|
| 401 | 管理画面のAPIキーがそのWorkerの値か確認。Threadsトークンとは別 |
| 503 Service not configured | `API_KEY` が未設定。ローカルは `.dev.vars` を確認 |
| encryption_key_invalid | 32バイトbase64の暗号鍵か確認。既存鍵を安易に再生成しない |
| threads_meta_190 / 190_463 | 無効・失効トークン。Threads用のトークンを再発行して接続 |
| missing_permissions | 表示された権限をMeta側で追加し、ユーザー承認後に再発行 |
| token_inspection_failed | テスター承認、診断用アプリトークンの有効性・同じアプリかを確認 |
| threads_meta_10 / 200〜299 | 権限・対象ユーザー・Metaアプリの設定を確認 |
| HTTP 429 / Meta 4,17,32,341,613 | 利用制限。間隔を空ける。公開を無条件に再試行しない |
| connection_check_failed | 通信・タイムアウト。Metaと通信できる環境で接続確認を再実行 |
| 接続後しばらくして停止 | トークンとデータアクセスの両方の期限を確認 |
| 期限が不明 | 接続状態を確認。Metaから期限が得られない場合はMeta側で確認 |
| 予約できない | 接続状態、予約日時までの期限、下書き状態を確認 |
| needs_review | 診断コードとThreads側の投稿結果を照合。自動再送しない |
| /api/health のready=false | 認証付きで設定・migrationの準備状態を確認。公開/healthは生存確認のみ |
| 汎用500 | DBの実スキーマ・migration・バインディング・暗号鍵の変更有無を確認 |
| SSO 403 | 任意secretが32文字以上か、0002適用、TTL・署名・再使用・時計差を確認 |

問い合わせには時刻、操作、HTTPステータス、安全な診断コード、使用コミットを記載します。トークン、鍵、SSO URL、D1の内容は送らないでください。

## 診断分類と自己確認

| error_kind | 意味・操作 |
|---|---|
| token_invalid | Meta 190（463/467/460等を含む）または認証拒否。期限・取消・再認証を確認。未処理予約は保持して停止 |
| permission_denied | 必要権限を承認して再発行。連投はthreads_manage_repliesも確認 |
| rate_limited | API利用制限または公開枠待ち。250件超過のMetaコードを一つに固定して判定しない |
| action_blocked | Meta 368、1/2207051など。Meta側のアカウント状態を確認 |
| container_error | ERROR/EXPIRED/状態不明/確認回数超過。原稿の診断コードと公開結果を照合 |
| unknown | 未分類。HTTP・数値コードと発生操作を添えて調査する |

452 / 4279019は、長期トークンの再交換やThreads App Secretの取り違えも確認します。投稿内のユニークなリンクが6つ以上なら5つ以下に減らしてください。

トークン単体では、秘密をログに残さないクライアントから `GET https://graph.threads.net/v1.0/me?fields=id,username` に `Authorization: Bearer <Threadsユーザートークン>` を渡して確認できます。これで分かるのはプロフィール取得で、公開・返信・分析の全権限を保証しません。[公式Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)で実期限と権限も確認してください。URLやシェル履歴にトークンを直接書かないでください。
