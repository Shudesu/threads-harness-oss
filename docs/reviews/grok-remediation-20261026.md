# Grokレビュー照合・修正記録 — 2026-10-26

対象は threads-harness-oss。調査報告を実コードとMeta一次資料で照合し、ローカルブランチで実装した。本番・GitHub・npmへの公開、実SNSへの送信は行っていない。

| 指摘 | 対応と確認 |
|---|---|
| トークン取得・配備手順不足 | README、英語概要、manual 01〜10、env/localテンプレート |
| プロフィールだけの接続確認 | debug_tokenで3権限・ユーザー一致・実期限を確認。テスター自己診断／同じアプリの診断token |
| 期限・失効が不明 | migration 0004、実期限2種、再確認、7日前警告、既知失効時の停止。未知は未知のまま |
| refresh未実装 | 今回は再接続導線と手動更新手順を採用。自動refreshは未実装 |
| エラーを破棄 | 数値Meta code/subcode・安全な分類をレスポンス/DB/UI/ログに残す。生の例外・上流本文は出さない |
| すべてneeds_review | 作成段階の明確な拒否だけfailed。公開段階・通信不明はneeds_reviewを維持し自動再送しない |
| 接続テスト不足 | 正常・失効・権限不足・不正鍵・不明期限・再接続競合をテスト |
| 空アラームの永久稼働 | 空なら停止。未来予約・中断処理を保持。キュー書込みと停止をDOの同じ排他区間で扱う |
| アカウント間の直列処理 | migration 0005。新規予約はaccount DO、既存予約はtenant DOに残し取りこぼさない |
| JSONCをJSON.parse | jsonc-parserを利用しコメント/末尾カンマ/構文エラーをテスト。コメント入りconfigでWFP生成成功 |
| MCPなし | stdio MCP 10ツール。env/API起動時検証、読み取り専用4ツール、投稿の明示確認、無条件再試行なし |
| 稼働情報不足 | 認証付き/api/healthで設定の有無・schema準備状態・件数。秘密は返さない |
| ログ/SECURITY/依存更新なし | observability、invocation logs無効、SECURITY、Dependabot、CIでbundle検証 |

## 判断の補足

- 「console.error(e)を1行追加」は採用しない。例外やURLに秘密が含まれ得るため固定イベントと安全なコードだけを記録した。
- 「dueがなければ止める」だけでは未来予約とqueue競合を取りこぼす。未処理予約を含めた起床時刻と排他処理を追加した。
- Meta公式はgraph.threads.netとgraph.threads.comの両方を案内しているため、ホストの変更は不要。
- 鍵の再生成禁止は旧READMEにも記載済みだった。新規の欠陥とは扱わず、手順書で再掲した。
- アプリID/secretの区別、refreshの24時間/未失効条件は公式資料で確認した。

## 検証と残る条件

- npm run check: 35件通過。TypeScript/Vite、Worker・MCP・JSONC・スケジューラ競合テスト。
- Python旧原稿アダプター: 3件通過。
- コメント入りwrangler.jsoncによるWFP生成・Wrangler dry-run成功。リモートuploadなし。
- 実Meta接続・公開・SSOの本番E2Eは未実施。ブラウザ自動操作なし。
- 配信前に0004/0005の実schemaと適用履歴、元の暗号鍵を確認する。
- WFPのobservabilityはmanifestにも保持するが、ホスト側がその設定を適用する必要がある。
- MCPはリポジトリ内で利用可能。npmへの公開やクライアント設定の書込みは行っていない。
