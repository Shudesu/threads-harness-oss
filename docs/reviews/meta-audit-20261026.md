# Meta連携レジスタの照合・対応 — 2026-10-26

対象: Threads Harness OSS v0.1.1からv0.1.2への変更。IGは対象外。

| 指摘 | 現行版との照合・対応 |
|---|---|
| B-1 全エラー破棄 | v0.1.1ですでに数値コード保持・接続エラー表示済み。v0.1.2ではerror_kindの安全な列挙とUI表示を追加 |
| B-2 失効でキュー消費 | 確認。既知の失効はclaim前に停止し、Metaの認証拒否もアカウントを停止。未試行のqueued/processingを保持。再接続後は明示的に再開 |
| B-3 文字数 | 共通関数で絵文字クラスタをUTF-8換算。API・画面・MCP共通。かな/漢字は1コードポイント=1。見た目の文字数とは区別 |
| B-4 コンテナ診断 | ERROR/EXPIRED/PUBLISHEDを区別。error_messageは公式に列挙された固定文字列だけを保持し、任意の上流文面を除去 |
| B-5 伝播レース | 状態確認GETの404とIN_PROGRESSを同じコンテナで1分間隔、最大5回まで確認。publishのcode 24/4279009の自動再送は採用しない |
| B-6 クォータ | 予約時に投稿/返信の枠と既存予約を確認。将来分は保証せず警告、実行前に再確認。枠不足なら待機し5分後に確認 |
| B-7 shares | 0006で列を追加、6指標を取得・保存・表示。未取得はnullを維持 |
| B-8 早期検出 | 接続時にprofile/debug_tokenに加え投稿枠取得を確認。quota=0でも接続自体は保存可能 |
| A/E マニュアル | 取得・交換・資格情報・期限・Webhook・クォータ・リンク上限・返信権限・再開手順を現行実装と一致させた |

## 採用しなかった断定

- 本レジスタのB-1/C「profileだけ」「一律500」はv0.1.1以前のコードに対する記述。
- User Token Generatorの全発行分が必ず長期であることは、今回の実トークンでは未検証。長期と確認できれば交換せず利用、短命の場合だけ交換する手順とした。
- 452だけでシークレット取り違えとは断定しない。トークン種類も確認する。
- publish POSTの24/4279009が絶対に未実行であるという公式保証を確認できないため、自動再送の根拠にしない。ネットワーク不明・公開済み可能性もneeds_reviewのまま。
- 返信作成と返信枠取得の公式仕様はthreads_manage_repliesを要求する。新規接続の必須3権限は維持し、連投は追加権限を案内する。content_publishだけの連投可否は未実地検証。
- 公開/非公開プロフィールの90日許諾延長は公式ページ間に表現差がある。実際のdata_access_expires_atを優先し、未知の期限や延長可否を推定しない。

## 検証方針

接続、失効時の同tick停止、保持後の明示再開、競合予約の残枠、絵文字境界、コンテナ終端状態と5回上限、sharesの0/null、数値診断の秘匿をローカルテストで検証。実workerdでは実際のDOを通したエラー分類・再接続・予約まで合成資格情報で確認する。実SNS公開や実トークン検証とは区別する。

追加migrationは0006のみ（0001〜0005が適用済みの場合）。秘密鍵や保存済み投稿は削除しない。

一次資料: [投稿・絵文字・リンク](https://developers.facebook.com/documentation/threads/posts.md)、[クォータ](https://developers.facebook.com/documentation/threads/overview.md)、[状態と確認回数](https://developers.facebook.com/documentation/threads/troubleshooting.md)、[返信](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/create-replies.md)、[6指標](https://developers.facebook.com/documentation/threads/insights.md)、[Threads資格情報](https://github.com/fbsamples/threads_api/blob/main/README.md)。

検証結果: 71テスト・Python 3テスト・型チェック・Vite build・WFP dry-runが成功。実workerdの接続201・下書き201・DO経由予約200、token_invalid保持、GET 8回・公開0回を確認。
