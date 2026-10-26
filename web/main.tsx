import { validDraftContent, type MediaItem } from '../shared/media.mjs';
import { countThreadsText, validThreadsText } from '../shared/text.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@cloudflare/kumo/components/button';
import { Surface } from '@cloudflare/kumo/components/surface';
import { Badge } from '@cloudflare/kumo/components/badge';
import './style.css';

type Account = { queue_paused: number; pending_count: number; last_error_kind: string | null; id: string; username: string; status: string; token_expires_at: string | null; data_access_expires_at: string | null; permissions_checked_at: string | null; last_error_code: string | null };
type Post = { media_json: string; error_kind: string | null; next_attempt_at: string | null; shares: number | null; replies: number | null; reposts: number | null; quotes: number | null; error_code: string | null; id: string; text: string; status: string; scheduled_at: string | null; published_id: string | null; chain_id: string | null; part_index: number | null; views: number | null; likes: number | null; insights_updated_at: string | null };
const field = 'w-full rounded-lg border border-kumo-line bg-kumo-base p-3 text-kumo-default';
const accountLabels: Record<string, string> = { connected: '接続済み', disconnected: '切断済み', expired: '期限切れ・再接続が必要', reauth_required: '再接続が必要' };
const dateLabel = (date: string | null) => date ? new Date(date).toLocaleString('ja-JP') : '不明（接続日からは推定しません）';
const errorLabels: Record<string, string> = { token_invalid: 'トークン無効', permission_denied: '権限不足', rate_limited: '利用上限', action_blocked: 'Metaによる制限', container_error: 'コンテナ処理', unknown: '未分類' };
const labels: Record<string, string> = { failed: '公開前に停止', draft: '下書き', queued: '公開待ち', creating: '準備中', processing: 'Threads処理中', publishing: '公開中', published: '公開済み', needs_review: '結果の確認が必要' };
function App() {
  const [key, setKey] = useState(() => sessionStorage.getItem('threads_api_key') ?? '');
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState('');
  const activeAccount = accounts.find(a => a.id === selected);
  const accountConnected = activeAccount?.status === 'connected';
  const canPublish = accountConnected && !activeAccount?.queue_paused;
  const [limits, setLimits] = useState<{ posts: { remaining: number; total: number }; replies?: { remaining: number; total: number }; checkedAt: string } | null>(null);
  const expiringSoon = [activeAccount?.token_expires_at, activeAccount?.data_access_expires_at].some(date => date && Date.parse(date) <= Date.now() + 7 * 86400000);
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaMode, setMediaMode] = useState('TEXT');
  const resetMedia = () => { setMedia([]); setMediaMode('TEXT'); };
  const [chainMode, setChainMode] = useState(false);
  const parts = chainMode && !editing ? text.split(/\n---\n/).map(p => p.trim()) : [text];
  const validDraft = (chainMode && !editing ? parts.every(p => validThreadsText(p)) : validDraftContent(text, media)) && (mediaMode !== 'CAROUSEL' || media.length >= 2) && (chainMode && !editing ? parts.length >= 2 && parts.length <= 10 : true);

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
    setAccounts(await api('/accounts'));
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
  const login = async (preferredId?: string) => {
    const rows: Account[] = await api('/accounts');
    sessionStorage.setItem('threads_api_key', key); setAccounts(rows); setConnected(true);
    const preferred = preferredId ?? selection.current;
    const first = rows.find(a => a.id === preferred)?.id ?? rows.find(a => a.status === 'connected')?.id ?? rows[0]?.id ?? '';
    if (selection.current !== first) setLimits(null);
    selection.current = first; setSelected(first); await refresh(first);
  };
  useEffect(() => {
    if (!connected || !selected) return;
    const timer = window.setInterval(() => { void refresh(selected).catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [connected, selected, refresh]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (text || media.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [text, media]);
  const choose = async (id: string) => {
    if ((text || media.length) && !confirm('入力中の内容があります。アカウントを切り替えますか？')) return;
    setLimits(null); selection.current = id; setSelected(id); setPosts([]); setText(''); resetMedia(); setEditing(null); await refresh(id);
  };
  return <div className="min-h-screen bg-kumo-canvas text-kumo-default"><main className="mx-auto max-w-6xl space-y-6 p-5 md:p-10">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-kumo-subtle">OSS ALPHA</p><h1 className="mt-2 text-3xl font-semibold">Threads Harness</h1><p className="mt-2 text-kumo-subtle">原稿を残し、公開を進める。</p></div><Badge variant="neutral">画像・動画・カルーセル対応</Badge></header>
    {error && <Surface className="p-4"><p role="alert" className="text-kumo-danger">{error}</p></Surface>}
    {notice && <p role="status">{notice}</p>}
    {!connected ? <Surface className="mx-auto max-w-lg space-y-4 p-6"><h2 className="text-lg font-semibold">ワークスペースにログイン</h2><label className="block space-y-2"><span>APIキー</span><input className={field} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label><Button variant="primary" disabled={busy || !key} onClick={() => void run(() => login())}>ログイン</Button><p className="text-sm text-kumo-subtle">このタブのセッション中だけログイン情報を保持します。</p></Surface> : <>
      <Surface className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">アカウント</h2><Button disabled={busy} onClick={() => { sessionStorage.removeItem('threads_api_key'); setKey(''); setConnected(false); setPosts([]); setToken(''); }}>ログアウト</Button></div>
        <select aria-label="Threadsアカウント" className={field} value={selected} disabled={busy} onChange={e => void run(() => choose(e.target.value))}><option value="">アカウントを選択</option>{accounts.map(a => <option key={a.id} value={a.id}>@{a.username} · {accountLabels[a.status] ?? a.status}</option>)}</select>
        {activeAccount && <div className="space-y-2 text-sm"><p>{accountLabels[activeAccount.status] ?? activeAccount.status} · 最終権限確認: {activeAccount.permissions_checked_at ? dateLabel(activeAccount.permissions_checked_at) : '未確認'}</p><p>トークン期限: {dateLabel(activeAccount.token_expires_at)}</p><p>データアクセス期限: {dateLabel(activeAccount.data_access_expires_at)}</p>{(!canPublish || expiringSoon || !activeAccount.token_expires_at || !activeAccount.permissions_checked_at) && <p role="status">{accountConnected && activeAccount.queue_paused ? '接続は復旧しています。保留中の予約を確認してから再開してください。' : !canPublish ? '新しいトークンで接続し直してください。未処理の予約と履歴は残っています。' : expiringSoon ? '期限まで7日以内です。期限前に新しいトークンで接続し直してください。' : '期限または権限が未確認です。接続状態を確認し、期限を確認してください。'} 自動更新はありません。</p>}{activeAccount.last_error_code && <p>直近の診断: {errorLabels[activeAccount.last_error_kind ?? ''] ?? ''} {activeAccount.last_error_code}</p>}<p>未処理の予約: {activeAccount.pending_count}件{activeAccount.queue_paused ? '（一時停止中）' : ''}</p><div className="flex flex-wrap gap-3"><Button disabled={busy || !accountConnected || (!activeAccount.pending_count && !activeAccount.queue_paused)} onClick={() => { if (!confirm(`@${activeAccount.username} の未処理予約 ${activeAccount.pending_count}件を再開しますか？日時を過ぎた原稿は順次公開されます。本文・順序・日時を確認してください。`)) return; void run(async () => { await api(`/accounts/${selected}/resume`, 'POST', { confirmed: true }); await refresh(selected); setNotice('未処理予約の再開を受け付けました。'); }); }}>{activeAccount.pending_count ? '残っている予約を再開' : '予約の一時停止を解除'}</Button><Button disabled={busy || activeAccount.status === 'disconnected'} onClick={() => void run(async () => { try { await api(`/accounts/${selected}/check`, 'POST'); setNotice('プロフィール・権限・期限を確認しました。'); } finally { await refresh(selected); } })}>接続状態を確認</Button><Button disabled={busy || activeAccount.status === 'disconnected'} onClick={() => { if (confirm('この環境から切断しますか？保存済みのトークンを削除し、投稿処理を停止します。下書きと履歴は残ります。')) void run(async () => { await api(`/accounts/${selected}/disconnect`, 'POST'); await refresh(selected); setNotice('切断しました。処理中だった投稿はThreads側の公開結果を確認してください。'); }); }}>切断</Button></div></div>}
        {activeAccount && <div className="space-y-2 text-sm"><Button disabled={busy || !accountConnected} onClick={() => void run(async () => { setLimits(await api(`/accounts/${selected}/limits${chainMode ? '?replies=1' : ''}`)); })}>現在の投稿枠を確認{chainMode ? '（返信含む）' : ''}</Button>{limits && <p>投稿残り {limits.posts.remaining}/{limits.posts.total}{limits.replies ? ` · 返信残り ${limits.replies.remaining}/${limits.replies.total}` : ''} · 確認 {new Date(limits.checkedAt).toLocaleString('ja-JP')}</p>}<p>投稿枠はローリング24時間で変動します。予約時と公開直前に再確認し、公開直前に不足した場合は待機します。連投の返信枠確認には threads_manage_replies 権限が必要です。</p></div>}
        <details><summary className="cursor-pointer text-sm">Threadsアカウントを接続・更新</summary><div className="mt-4 space-y-3"><p className="text-sm text-kumo-subtle">Metaアプリで発行したThreadsユーザーアクセストークンを入力してください。OAuthログイン・自動更新には未対応です。threads_basic / threads_content_publish / threads_manage_insights の3権限と期限を確認します。テスター以外は管理者による診断用アプリトークンの設定が必要です。同じアカウントの新しいトークンを保存すると、履歴を保持して再接続します。</p><label className="block space-y-2"><span>Threadsアクセストークン</span><input className={field} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label><Button disabled={busy || !token} onClick={() => void run(async () => { const profile = await api('/accounts', 'POST', { accessToken: token }); setToken(''); await login(profile.id); setNotice('アカウントを接続しました。'); })}>接続を確認して保存</Button></div></details>
      </Surface>
      <div className="grid gap-6 lg:grid-cols-2"><Surface className="space-y-4 p-5"><h2 className="font-semibold">{editing ? '下書きを編集' : '新しい原稿'}</h2>{!editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chainMode} disabled={busy || media.length > 0} onChange={e => setChainMode(e.target.checked)} />連投を作成（区切りは改行した ---）</label>}<label className="block space-y-2"><span>投稿形式</span><select className={field} value={mediaMode} disabled={busy || (chainMode && !editing)} onChange={e => { if (media.length && !confirm('入力中のメディアURLを消して形式を変更しますか？')) return; const mode = e.target.value; setMediaMode(mode); setMedia(mode === 'TEXT' ? [] : mode === 'CAROUSEL' ? [{type:'IMAGE',url:''},{type:'IMAGE',url:''}] : [{type:mode as 'IMAGE' | 'VIDEO',url:''}]); }}><option value="TEXT">テキスト</option><option value="IMAGE">画像1枚</option><option value="VIDEO">動画1本</option><option value="CAROUSEL">カルーセル（画像・動画2〜20件）</option></select></label>
        {mediaMode !== 'TEXT' && <div className="space-y-3"><p className="text-sm">ログイン不要で取得できる公開HTTPS URLを指定してください。端末からのアップロードは未対応です。予約の公開完了までURLと素材を維持してください。</p><p className="text-xs text-kumo-subtle">画像: JPEG/PNG・8MB以下。動画: MP4/MOV・最大5分・1GB以下。素材の形式・サイズ・処理可否はMeta側で判定されます。</p>{media.map((m,i) => <div key={i} className="space-y-2"><label className="block">素材 {i+1}<select aria-label={`素材${i+1}の種類`} className={field} value={m.type} disabled={busy || mediaMode !== 'CAROUSEL'} onChange={e=>setMedia(media.map((x,j)=>i===j?{...x,type:e.target.value as 'IMAGE'|'VIDEO'}:x))}><option value="IMAGE">画像</option><option value="VIDEO">動画</option></select><input aria-label={`素材${i+1}の公開URL`} type="url" className={field} value={m.url} disabled={busy} placeholder="https://..." onChange={e=>setMedia(media.map((x,j)=>i===j?{...x,url:e.target.value}:x))}/></label>{mediaMode === 'CAROUSEL' && <div className="flex gap-2"><Button disabled={busy || i===0} onClick={()=>{ const reordered=[...media]; [reordered[i-1],reordered[i]]=[reordered[i],reordered[i-1]]; setMedia(reordered); }}>前へ</Button><Button disabled={busy || i===media.length-1} onClick={()=>{ const reordered=[...media]; [reordered[i+1],reordered[i]]=[reordered[i],reordered[i+1]]; setMedia(reordered); }}>後へ</Button><Button disabled={busy || media.length<=2} onClick={()=>setMedia(media.filter((_,j)=>j!==i))}>素材を外す</Button></div>}</div>)}{mediaMode==='CAROUSEL' && <Button disabled={busy || media.length>=20} onClick={()=>setMedia([...media,{type:'IMAGE',url:''}])}>素材を追加</Button>}</div>}
        <label className="block space-y-2"><span>本文{media.length ? '（省略可）' : ''}</span><textarea rows={10} className={field} value={text} disabled={busy} onChange={e => setText(e.target.value)} placeholder="伝えたいことを書いてください。" /></label><p className="text-sm text-kumo-subtle">{parts.map((p, i) => `${i + 1}件目: ${countThreadsText(p)}/500換算`).join(' · ')}{chainMode && !editing ? ' · 2〜10件をまとめて保存' : ''} · 絵文字はUTF-8バイト長で換算</p><div className="flex gap-3"><Button variant="primary" disabled={busy || !accountConnected || !validDraft} onClick={() => void run(async () => { await api(editing ? `/posts/${editing}` : chainMode ? '/chains' : '/posts', editing ? 'PATCH' : 'POST', chainMode && !editing ? { parts, accountId: selected } : { text, media, accountId: selected }); setText(''); resetMedia(); setEditing(null); await refresh(selected); setNotice('下書きを保存しました。'); })}>下書きを保存</Button>{editing && <Button disabled={busy} onClick={() => { if ((!text && !media.length) || confirm('編集中の内容を閉じますか？')) { setText(''); resetMedia(); setEditing(null); } }}>編集を閉じる</Button>}</div></Surface>
      <Surface className="space-y-4 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">原稿と公開履歴</h2><Button disabled={busy || !selected} onClick={() => void run(() => refresh(selected))}>更新</Button></div><label className="block space-y-2 text-sm"><span>予約日時（空欄なら保存済みの原稿を順次公開）</span><input className={field} type="datetime-local" value={scheduled} onChange={e => setScheduled(e.target.value)} /></label>
        {posts.length === 0 ? <p className="text-kumo-subtle">保存した原稿がここに並びます。</p> : <ul className="space-y-5">{posts.map(p => <li key={p.id} className="space-y-3 border-b border-kumo-line pb-5"><div className="flex gap-3"><Badge variant="neutral">{labels[p.status] ?? p.status}</Badge>{p.chain_id && <span className="text-xs text-kumo-subtle">連投 {(p.part_index ?? 0) + 1}件目 · {p.chain_id.slice(0, 6)}</span>}{p.scheduled_at && <span className="text-xs text-kumo-subtle">{new Date(p.scheduled_at).toLocaleString('ja-JP')}</span>}</div><p className="whitespace-pre-wrap break-words text-sm">{p.text}</p>{JSON.parse(p.media_json || '[]').length > 0 && <ol className="space-y-1 text-xs">{(JSON.parse(p.media_json) as MediaItem[]).map((m,i)=><li key={i} className="break-all">{i+1}. {m.type==='IMAGE'?'画像':'動画'}: <a href={m.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="underline">{m.url}</a></li>)}</ol>}{['queued', 'processing'].includes(p.status) && p.error_code && <p className="text-sm">待機中: {errorLabels[p.error_kind ?? ''] ?? ''} · {p.error_code}{p.next_attempt_at ? ` · 次回確認 ${new Date(p.next_attempt_at).toLocaleString('ja-JP')}` : ''}</p>}{p.status === 'failed' && <p role="alert" className="text-sm text-kumo-danger">公開前に停止しました。診断: {errorLabels[p.error_kind ?? ''] ?? ''} {p.error_code}。原因を解消し、必要なら新しい下書きを作成してください。自動再送はしません。</p>}{p.status === 'needs_review' && <p role="alert" className="text-sm text-kumo-danger">Threads側の公開結果を確認してください。重複を避けるため自動再送を停止しています。{p.error_code && ` 診断: ${errorLabels[p.error_kind ?? ''] ?? ''} ${p.error_code}`}</p>}<div className="flex flex-wrap gap-2">{p.status === 'draft' && <><Button disabled={busy} onClick={() => { if ((text || media.length) && !confirm('入力中の内容を閉じて、この原稿を編集しますか？')) return; setEditing(p.id); setText(p.text); const items: MediaItem[] = JSON.parse(p.media_json || '[]'); setMedia(items); setMediaMode(items.length>1?'CAROUSEL':items[0]?.type ?? 'TEXT'); }}>編集</Button>{(!p.chain_id || p.part_index === 0) && <Button disabled={busy || !canPublish || Boolean(editing && posts.find(x => x.id === editing)?.chain_id === p.chain_id) || editing === p.id} onClick={() => { if (!confirm(`この原稿（添付素材 ${JSON.parse(p.media_json || '[]').length}件を含む）を${scheduled ? '指定日時に' : '準備ができ次第'}Threadsへ公開しますか？`)) return; void run(async () => { const result = await api(`/posts/${p.id}/queue`, 'POST', scheduled ? { scheduledAt: new Date(scheduled).toISOString() } : {}); setLimits(result.limits); setNotice(result.warning ?? '公開待ちに登録しました。'); await refresh(selected); }); }}>{p.chain_id ? '連投をまとめて' : ''}{scheduled ? '予約する' : '公開する'}</Button>}</>}{p.status === 'queued' && (!p.chain_id || p.part_index === 0) && <Button disabled={busy} onClick={() => void run(async () => { await api(`/posts/${p.id}/cancel`, 'POST'); await refresh(selected); })}>予約取消</Button>}{['draft', 'published'].includes(p.status) && (!p.chain_id || p.part_index === 0) && <Button disabled={busy} onClick={() => void run(async () => { await api(`/posts/${p.id}/archive`, 'POST'); await refresh(selected); })}>一覧から非表示</Button>}</div>{p.published_id && <div className="space-y-2 text-xs text-kumo-subtle"><p>公開ID: {p.published_id}</p><p>表示 {p.views?.toLocaleString() ?? '未取得'} · いいね {p.likes?.toLocaleString() ?? '未取得'} · 返信 {p.replies?.toLocaleString() ?? '未取得'} · 再投稿 {p.reposts?.toLocaleString() ?? '未取得'} · 引用 {p.quotes?.toLocaleString() ?? '未取得'} · シェア {p.shares?.toLocaleString() ?? '未取得'}{p.insights_updated_at ? ` · 取得 ${new Date(p.insights_updated_at).toLocaleString('ja-JP')}` : ''}</p><Button disabled={busy || !accountConnected} onClick={() => void run(async () => { await api(`/posts/${p.id}/insights`, 'POST'); await refresh(selected); })}>インサイト取得</Button></div>}</li>)}</ul>}
      </Surface></div>
    </>}
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
