import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@cloudflare/kumo/components/button';
import { Surface } from '@cloudflare/kumo/components/surface';
import { Badge } from '@cloudflare/kumo/components/badge';
import './style.css';

type Account = { id: string; username: string; status: string };
type Post = { id: string; text: string; status: string; scheduled_at: string | null; published_id: string | null; chain_id: string | null; part_index: number | null; views: number | null; likes: number | null; insights_updated_at: string | null };
const field = 'w-full rounded-lg border border-kumo-line bg-kumo-base p-3 text-kumo-default';
const labels: Record<string, string> = { draft: '下書き', queued: '公開待ち', creating: '準備中', processing: 'Threads処理中', publishing: '公開中', published: '公開済み', needs_review: '結果の確認が必要' };
function App() {
  const [key, setKey] = useState(() => sessionStorage.getItem('threads_api_key') ?? '');
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [chainMode, setChainMode] = useState(false);
  const parts = chainMode && !editing ? text.split(/\n---\n/).map(p => p.trim()) : [text];
  const validDraft = parts.every(p => p.trim() && [...p].length <= 500) && (chainMode && !editing ? parts.length >= 2 && parts.length <= 10 : true);

  const [token, setToken] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const selection = useRef('');
  const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`/api${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = await response.json() as { data: any; error?: string };
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return json.data;
  }, [key]);
  const refresh = useCallback(async (accountId: string) => {
    if (!accountId) { setPosts([]); return; }
    const rows = await api(`/posts?accountId=${encodeURIComponent(accountId)}`);
    if (selection.current === accountId) setPosts(rows);
  }, [api]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました'); }
    finally { lock.current = false; setBusy(false); }
  };
  const login = async () => {
    const rows: Account[] = await api('/accounts');
    sessionStorage.setItem('threads_api_key', key); setAccounts(rows); setConnected(true);
    const first = rows.find(a => a.status === 'connected')?.id ?? '';
    selection.current = first; setSelected(first); await refresh(first);
  };
  useEffect(() => {
    if (!connected || !selected) return;
    const timer = window.setInterval(() => { void refresh(selected).catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [connected, selected, refresh]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (text) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [text]);
  const choose = async (id: string) => {
    if (text && !confirm('入力中の内容があります。アカウントを切り替えますか？')) return;
    selection.current = id; setSelected(id); setPosts([]); setText(''); setEditing(null); await refresh(id);
  };
  return <div className="min-h-screen bg-kumo-canvas text-kumo-default"><main className="mx-auto max-w-6xl space-y-6 p-5 md:p-10">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-kumo-subtle">THE HARNESS CLOUD / PREVIEW</p><h1 className="mt-2 text-3xl font-semibold">Threads Harness</h1><p className="mt-2 text-kumo-subtle">原稿を残し、公開を進める。</p></div><Badge variant="neutral">連投・インサイト対応</Badge></header>
    {error && <Surface className="p-4"><p role="alert" className="text-kumo-danger">{error}</p></Surface>}
    {notice && <p role="status">{notice}</p>}
    {!connected ? <Surface className="mx-auto max-w-lg space-y-4 p-6"><h2 className="text-lg font-semibold">ワークスペースにログイン</h2><label className="block space-y-2"><span>APIキー</span><input className={field} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label><Button variant="primary" disabled={busy || !key} onClick={() => void run(login)}>ログイン</Button><p className="text-sm text-kumo-subtle">このタブのセッション中だけログイン情報を保持します。</p></Surface> : <>
      <Surface className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">アカウント</h2><Button disabled={busy} onClick={() => { sessionStorage.removeItem('threads_api_key'); setKey(''); setConnected(false); setPosts([]); setToken(''); }}>ログアウト</Button></div>
        <select aria-label="Threadsアカウント" className={field} value={selected} disabled={busy} onChange={e => void run(() => choose(e.target.value))}><option value="">接続済みアカウントを選択</option>{accounts.filter(a => a.status === 'connected').map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}</select>
        <details><summary className="cursor-pointer text-sm">Threadsアカウントを接続・更新</summary><div className="mt-4 space-y-3"><p className="text-sm text-kumo-subtle">Threads用のアクセストークンが必要です。接続はプロフィールの確認だけを行います。公開には threads_content_publish、分析には threads_manage_insights 権限が必要です。</p><label className="block space-y-2"><span>Threadsアクセストークン</span><input className={field} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label><Button disabled={busy || !token} onClick={() => void run(async () => { await api('/accounts', 'POST', { accessToken: token }); setToken(''); await login(); setNotice('アカウントを接続しました。'); })}>接続を確認して保存</Button></div></details>
      </Surface>
      <div className="grid gap-6 lg:grid-cols-2"><Surface className="space-y-4 p-5"><h2 className="font-semibold">{editing ? '下書きを編集' : '新しい原稿'}</h2>{!editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chainMode} disabled={busy} onChange={e => setChainMode(e.target.checked)} />連投を作成（区切りは改行した ---）</label>}<label className="block space-y-2"><span>本文</span><textarea rows={10} className={field} value={text} disabled={busy} onChange={e => setText(e.target.value)} placeholder="伝えたいことを書いてください。" /></label><p className="text-sm text-kumo-subtle">{parts.map((p, i) => `${i + 1}件目: ${[...p].length}/500文字`).join(' · ')}{chainMode && !editing ? ' · 2〜10件をまとめて保存' : ''}</p><div className="flex gap-3"><Button variant="primary" disabled={busy || !selected || !validDraft} onClick={() => void run(async () => { await api(editing ? `/posts/${editing}` : chainMode ? '/chains' : '/posts', editing ? 'PATCH' : 'POST', chainMode && !editing ? { parts, accountId: selected } : { text, accountId: selected }); setText(''); setEditing(null); await refresh(selected); setNotice('下書きを保存しました。'); })}>下書きを保存</Button>{editing && <Button disabled={busy} onClick={() => { if (!text || confirm('編集中の内容を閉じますか？')) { setText(''); setEditing(null); } }}>編集を閉じる</Button>}</div></Surface>
      <Surface className="space-y-4 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">原稿と公開履歴</h2><Button disabled={busy || !selected} onClick={() => void run(() => refresh(selected))}>更新</Button></div><label className="block space-y-2 text-sm"><span>予約日時（空欄なら保存済みの原稿を順次公開）</span><input className={field} type="datetime-local" value={scheduled} onChange={e => setScheduled(e.target.value)} /></label>
        {posts.length === 0 ? <p className="text-kumo-subtle">保存した原稿がここに並びます。</p> : <ul className="space-y-5">{posts.map(p => <li key={p.id} className="space-y-3 border-b border-kumo-line pb-5"><div className="flex gap-3"><Badge variant="neutral">{labels[p.status] ?? p.status}</Badge>{p.chain_id && <span className="text-xs text-kumo-subtle">連投 {(p.part_index ?? 0) + 1}件目 · {p.chain_id.slice(0, 6)}</span>}{p.scheduled_at && <span className="text-xs text-kumo-subtle">{new Date(p.scheduled_at).toLocaleString('ja-JP')}</span>}</div><p className="whitespace-pre-wrap break-words text-sm">{p.text}</p>{p.status === 'needs_review' && <p role="alert" className="text-sm text-kumo-danger">Threads側の公開結果を確認してください。重複を避けるため自動再送を停止しています。</p>}<div className="flex flex-wrap gap-2">{p.status === 'draft' && <><Button disabled={busy} onClick={() => { if (text && !confirm('入力中の内容を閉じて、この原稿を編集しますか？')) return; setEditing(p.id); setText(p.text); }}>編集</Button>{(!p.chain_id || p.part_index === 0) && <Button disabled={busy || Boolean(editing && posts.find(x => x.id === editing)?.chain_id === p.chain_id) || editing === p.id} onClick={() => { if (!confirm(`この原稿を${scheduled ? '指定日時に' : '準備ができ次第'}Threadsへ公開しますか？`)) return; void run(async () => { await api(`/posts/${p.id}/queue`, 'POST', scheduled ? { scheduledAt: new Date(scheduled).toISOString() } : {}); await refresh(selected); }); }}>{p.chain_id ? '連投をまとめて' : ''}{scheduled ? '予約する' : '公開する'}</Button>}</>}{p.status === 'queued' && (!p.chain_id || p.part_index === 0) && <Button disabled={busy} onClick={() => void run(async () => { await api(`/posts/${p.id}/cancel`, 'POST'); await refresh(selected); })}>予約取消</Button>}{['draft', 'published'].includes(p.status) && (!p.chain_id || p.part_index === 0) && <Button disabled={busy} onClick={() => void run(async () => { await api(`/posts/${p.id}/archive`, 'POST'); await refresh(selected); })}>一覧から非表示</Button>}</div>{p.published_id && <div className="space-y-2 text-xs text-kumo-subtle"><p>公開ID: {p.published_id}</p><p>表示 {p.views?.toLocaleString() ?? '未取得'} · いいね {p.likes?.toLocaleString() ?? '未取得'}{p.insights_updated_at ? ` · 取得 ${new Date(p.insights_updated_at).toLocaleString('ja-JP')}` : ''}</p><Button disabled={busy} onClick={() => void run(async () => { await api(`/posts/${p.id}/insights`, 'POST'); await refresh(selected); })}>インサイト取得</Button></div>}</li>)}</ul>}
      </Surface></div>
    </>}
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
