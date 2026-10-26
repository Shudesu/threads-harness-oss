import { Button } from "@cloudflare/kumo/components/button";
import { countThreadsText, validThreadsText } from "../shared/text.mjs";
import {
  validDraftContent,
  validMediaUrl,
  type MediaItem,
} from "../shared/media.mjs";
import { Icon, Panel } from "./ui";
export type Editor = {
  id: string | null;
  text: string;
  media: MediaItem[];
  mode: string;
  chain: boolean;
};
export const emptyEditor = (): Editor => ({
  id: null,
  text: "",
  media: [],
  mode: "TEXT",
  chain: false,
});
export function editorParts(value: Editor) {
  return value.chain && !value.id
    ? value.text.split(/\n---\n/).map((p) => p.trim())
    : [value.text];
}
export function validEditor(value: Editor) {
  const parts = editorParts(value);
  return value.chain && !value.id
    ? parts.length >= 2 && parts.length <= 10 && parts.every(validThreadsText)
    : validDraftContent(value.text, value.media) &&
        (value.mode !== "CAROUSEL" || value.media.length >= 2);
}
export function MediaList({ items }: { items: MediaItem[] }) {
  if (!items.length) return null;
  return (
    <ol className="media-list">
      {items.map((item, i) => (
        <li key={i}>
          <span className="media-icon">
            <Icon name={item.type === "IMAGE" ? "image" : "video"} />
          </span>
          <span className="media-link">
            <strong>
              {i + 1}. {item.type === "IMAGE" ? "画像" : "動画"}
            </strong>
            {validMediaUrl(item.url) ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                title={item.url}
              >
                {item.url}
              </a>
            ) : (
              <span className="muted">素材URLを入力してください</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
export function Composer({
  value,
  setValue,
  busy,
  connected,
  username,
  save,
  close,
}: {
  value: Editor;
  setValue: (v: Editor) => void;
  busy: boolean;
  connected: boolean;
  username?: string;
  save: () => void;
  close: () => void;
}) {
  const parts = editorParts(value);
  const changeMode = (mode: string) => {
    if (
      value.media.some((m) => m.url) &&
      !window.confirm("入力中の素材URLを消して投稿形式を変更しますか？")
    )
      return;
    setValue({
      ...value,
      mode,
      media:
        mode === "TEXT"
          ? []
          : mode === "CAROUSEL"
            ? [
                { type: "IMAGE", url: "" },
                { type: "IMAGE", url: "" },
              ]
            : [{ type: mode as "IMAGE" | "VIDEO", url: "" }],
    });
  };
  const move = (index: number, delta: number) => {
    const media = [...value.media];
    [media[index], media[index + delta]] = [media[index + delta], media[index]];
    setValue({ ...value, media });
  };
  return (
    <div className="composer-layout">
      <Panel title={value.id ? "下書きを編集" : "投稿の内容"}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (validEditor(value) && connected && !busy) save();
          }}
        >
          <fieldset disabled={busy} className="form-stack">
            {!value.id && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={value.chain}
                  disabled={value.media.length > 0 || busy}
                  onChange={(e) =>
                    setValue({ ...value, chain: e.target.checked })
                  }
                />
                <span>
                  連投を作成する
                  <span className="muted small">
                    2〜10件の投稿を、返信でつなぎます。
                  </span>
                </span>
              </label>
            )}
            <label className="field">
              <span>投稿形式</span>
              <select
                value={value.mode}
                disabled={busy || (value.chain && !value.id)}
                onChange={(e) => changeMode(e.target.value)}
              >
                <option value="TEXT">テキスト</option>
                <option value="IMAGE">画像1枚</option>
                <option value="VIDEO">動画1本</option>
                <option value="CAROUSEL">
                  カルーセル（画像・動画2〜20件）
                </option>
              </select>
            </label>
            <label className="field">
              <span>
                本文
                {value.media.length > 0 && (
                  <span className="muted normal">（省略可）</span>
                )}
              </span>
              <textarea
                rows={8}
                value={value.text}
                onChange={(e) => setValue({ ...value, text: e.target.value })}
                placeholder={
                  value.chain
                    ? "1件目の本文\n---\n2件目の本文"
                    : "伝えたいことを書いてください。"
                }
              />
              {value.chain && !value.id && (
                <span className="field-help">
                  投稿の区切りに、改行した「---」を入力してください。
                </span>
              )}
            </label>
            <div className="character-count">
              {parts.map((part, i) => (
                <span
                  className={countThreadsText(part) > 500 ? "danger-text" : ""}
                  key={i}
                >
                  {parts.length > 1 ? `${i + 1}件目 ` : ""}
                  {countThreadsText(part)} / 500
                </span>
              ))}
              <span className="muted">絵文字はUTF-8換算</span>
            </div>
            {value.mode !== "TEXT" && (
              <section className="form-stack">
                <div>
                  <h3>添付素材</h3>
                  <p className="field-help">
                    ログイン不要で取得できる公開HTTPS
                    URLを指定します。直接アップロードには対応していません。
                  </p>
                </div>
                {value.media.map((item, i) => (
                  <div className="media-editor" key={i}>
                    <div className="row-between">
                      <strong>素材 {i + 1}</strong>
                      {value.mode === "CAROUSEL" && (
                        <div className="button-row">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`素材${i + 1}を前へ`}
                            disabled={busy || i === 0}
                            onClick={() => move(i, -1)}
                          >
                            前へ
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`素材${i + 1}を後へ`}
                            disabled={busy || i === value.media.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            後へ
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`素材${i + 1}を外す`}
                            disabled={busy || value.media.length <= 2}
                            onClick={() =>
                              setValue({
                                ...value,
                                media: value.media.filter((_, j) => i !== j),
                              })
                            }
                          >
                            外す
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="media-inputs">
                      <label className="field">
                        <span>種類</span>
                        <select
                          aria-label={`素材${i + 1}の種類`}
                          value={item.type}
                          disabled={busy || value.mode !== "CAROUSEL"}
                          onChange={(e) =>
                            setValue({
                              ...value,
                              media: value.media.map((m, j) =>
                                j === i
                                  ? {
                                      ...m,
                                      type: e.target.value as "IMAGE" | "VIDEO",
                                    }
                                  : m,
                              ),
                            })
                          }
                        >
                          <option value="IMAGE">画像</option>
                          <option value="VIDEO">動画</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>公開URL</span>
                        <input
                          type="url"
                          aria-label={`素材${i + 1}の公開URL`}
                          aria-invalid={Boolean(
                            item.url && !validMediaUrl(item.url),
                          )}
                          value={item.url}
                          placeholder="https://..."
                          onChange={(e) =>
                            setValue({
                              ...value,
                              media: value.media.map((m, j) =>
                                j === i ? { ...m, url: e.target.value } : m,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    {item.url && !validMediaUrl(item.url) && (
                      <p className="danger-text small">
                        認証情報を含まない公開HTTPS URLを入力してください。
                      </p>
                    )}
                  </div>
                ))}
                {value.mode === "CAROUSEL" && (
                  <Button
                    type="button"
                    disabled={busy || value.media.length >= 20}
                    onClick={() =>
                      setValue({
                        ...value,
                        media: [...value.media, { type: "IMAGE", url: "" }],
                      })
                    }
                  >
                    素材を追加（{value.media.length}/20）
                  </Button>
                )}
                <details className="help-details">
                  <summary>素材の仕様と予約時の注意</summary>
                  <p>
                    画像はJPEG/PNG・8MB以下。動画はMP4/MOV・5分以内・1GB以下。素材の最終的な処理可否はMeta側で判定されます。公開が完了するまでURLと素材を維持してください。
                  </p>
                </details>
              </section>
            )}
            <div className="form-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !connected || !validEditor(value)}
              >
                {busy ? "保存中…" : "下書きを保存"}
              </Button>
              {value.id && (
                <Button type="button" disabled={busy} onClick={close}>
                  編集を閉じる
                </Button>
              )}
              <p className="field-help">保存しただけでは公開されません。</p>
            </div>
          </fieldset>
        </form>
      </Panel>
      <aside className="composer-preview">
        <Panel
          title="内容のプレビュー"
          description="Threads上の見た目とは異なる場合があります。"
        >
          <div className="preview-account">
            <span className="account-avatar">@</span>
            <div>
              <strong>@{username ?? "アカウント未選択"}</strong>
              <p className="muted small">
                {value.chain && !value.id
                  ? `連投 · ${parts.length}件`
                  : "新しい投稿"}
              </p>
            </div>
          </div>
          {parts.map((part, i) => (
            <div className="preview-part" key={i}>
              {parts.length > 1 && <span className="eyebrow">{i + 1}件目</span>}
              <p className={`post-text ${part ? "" : "muted"}`}>
                {part || "本文を入力すると、ここに表示されます。"}
              </p>
              {i === 0 && <MediaList items={value.media} />}
            </div>
          ))}
          <p className="field-help">
            素材はリンクから確認できます。自動では読み込みません。
          </p>
        </Panel>
      </aside>
    </div>
  );
}
