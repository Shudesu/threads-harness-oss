import { useState } from "react";
import { Button } from "@cloudflare/kumo/components/button";
import { Panel } from "./ui";
import type { Account } from "./model";
export function Integrations({
  accounts,
  selected,
}: {
  accounts: Account[];
  selected: string;
}) {
  const [notice, setNotice] = useState("");
  const config = JSON.stringify(
    {
      mcpServers: {
        "threads-harness": {
          command: "node",
          args: ["/absolute/path/to/threads-harness-oss/mcp/index.mjs"],
          env: {
            THREADS_HARNESS_API_URL: window.location.origin,
            THREADS_HARNESS_API_KEY: "<環境のAPIキー>",
            THREADS_HARNESS_READ_ONLY: "true",
          },
        },
      },
    },
    null,
    2,
  );
  const example = `curl '${window.location.origin}/api/accounts' \\\n  -H 'Authorization: Bearer <環境のAPIキー>'`;
  return (
    <div className="stack">
      <div className="alert alert-info">
        <strong>Threads Harnessは正式提供中です。</strong>
        <p>
          接続・投稿・MCP/APIを利用できます。OAuthログイン、自動トークン更新、直接ファイルアップロードには未対応です。
        </p>
      </div>
      <div className="settings-grid">
        <Panel
          title="専用MCP（stdio）"
          description="ローカルのAIクライアントから、この環境を操作します。"
        >
          <p className="small">
            リポジトリを取得してNode.js 22で <code>npm ci</code>{" "}
            を実行し、設定例のパスを実際の場所に置き換えてください。公開npmパッケージではありません。
          </p>
          <pre className="integration-code">{config}</pre>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(config);
                setNotice(
                  "設定例をコピーしました。APIキーの実値は含まれていません。",
                );
              } catch {
                setNotice(
                  "コピーできませんでした。設定例を選択してコピーしてください。",
                );
              }
            }}
          >
            設定例をコピー
          </Button>
          {notice && (
            <p role="status" className="field-help">
              {notice}
            </p>
          )}
          <p className="field-help">
            初期設定は読み取り専用です。更新操作を使う場合は{" "}
            <code>THREADS_HARNESS_READ_ONLY=false</code>{" "}
            に変更します。公開・予約・再開は本人の内容確認が必要です。
          </p>
          <a
            className="text-link"
            href="https://github.com/Shudesu/threads-harness-oss/blob/main/docs/mcp.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            MCP設定と16ツールの説明 ↗
          </a>
        </Panel>
        <Panel
          title="REST API / OpenAPI"
          description="APIキーをAuthorizationヘッダーで指定します。"
        >
          <pre className="integration-code">{example}</pre>
          <p className="small">
            Threadsアクセストークンではなく、この環境のAPIキーを使います。キーはチャットや公開リポジトリに貼らず、シークレット管理機能や環境変数で設定してください。
          </p>
          <a
            className="text-link"
            href="/openapi.json"
            target="_blank"
            rel="noopener noreferrer"
          >
            この環境のOpenAPI仕様を開く ↗
          </a>
          <a
            className="text-link"
            href="https://github.com/Shudesu/threads-harness-oss/blob/main/docs/api.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            APIリファレンス・エラー・ページ送り ↗
          </a>
          <p className="field-help">
            更新時は <code>accountId</code>{" "}
            を指定し、対象の原稿とアカウントを照合してください。成否不明の更新や公開は自動再試行しません。
          </p>
        </Panel>
      </div>
      <Panel title="操作対象のアカウント">
        <p className="small">
          1つの環境に複数アカウントを接続できます。操作ごとにアカウントIDを指定します。
        </p>
        <ul className="integration-accounts">
          {accounts.map((a) => (
            <li key={a.id}>
              <strong>@{a.username}</strong> <code>{a.id}</code>
              {a.id === selected && <span className="muted small">操作中</span>}
            </li>
          ))}
        </ul>
        <p className="inline-alert alert-warning">
          APIキーはこの環境の全アカウントを管理できます。MCPの読み取り専用設定やaccountId指定は、APIキー自体の権限を制限しません。別のお客様のデータは別ワークスペースで運用してください。
        </p>
      </Panel>
    </div>
  );
}
