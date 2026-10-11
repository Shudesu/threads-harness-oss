# VPSワークフローからの移行

従来の Python 自動投稿器の「フック → 本文 → 結論」の3連投を、D1に各段階を保存するクラウド処理へ移植しています。2〜10件を扱い、標準の運用例は3件です。

- `POST /api/chains`: `{ "accountId": "...", "parts": ["導入", "本文", "結論"] }` を下書きとして保存。
- 返った `ids[0]` の `/api/posts/:id/queue` に POST すると、連投全体を予約。`scheduledAt` は任意の未来のISO日時。
- 先頭記事の公開IDを得てから次の記事を `reply_to_id` 付きで作成。各段階を一度だけ処理し、成否不明なら後続も停止。
- `/cancel` と `/archive` は先頭IDから全件を操作。公開処理開始後の取消や、部分失敗した連投の非表示は拒否。
- 公開後の `/api/posts/:id/insights` に POST すると、Metaから表示数等を読み取り保存。`GET /api/insights?accountId=...` は保存済み指標を集計。未取得はnullで、ゼロと区別。

## 既存の原稿生成器を接続する

生成器を投稿APIに直結せず、JSONの `parts` 配列または区切り行 `---` を含む `raw_text` を標準出力へ渡します。生成器自体のニュース取得・モデル呼び出しは利用者側で設定します。

`THREADS_HARNESS_URL`（HTTPS origin）、`THREADS_HARNESS_API_KEY`、`THREADS_ACCOUNT_ID` を秘密管理から環境変数に読み込んで実行します。

```sh
python3 scripts/legacy-draft.py --receipt .local/receipts/article-001.json < draft.json
```

このコマンドは下書きだけを作成します。記事ごとに固定のreceiptを再利用してください。入力と宛先のハッシュを検証し、保存済みなら再送せず、通信の成否不明なら停止します。receiptを自動削除して再実行しないでください。

VPS版の出力ラベル除去を流用していますが、500文字超の切り捨て、固定の宣伝リンク注入、投稿時の無条件リトライは引き継いでいません。入力が長い場合は原稿を修正します。

## API仕様の確認先

- [Meta公式: 返信作成](https://www.postman.com/meta/threads/request/y4uzu58/respond-to-replies)
- [Meta公式: 投稿インサイト](https://www.postman.com/meta/threads/request/434u2bd/get-post-insights)

旧環境の本文・ログ・分析数値・アカウント設定・資格情報はOSSに含めません。インサイトはMetaの権限・取得可否に依存します。以前の表示数は新しいアカウントや投稿内容の成果を保証しません。
