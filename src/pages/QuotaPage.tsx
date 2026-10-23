import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gauge, RefreshCw, EyeOff, Clock3, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AiQuotaSnapshot, AiQuotaRow } from '../../backend/src/antigravity-quota';

const preferenceKey = 'crawldata.quota.preferences';
const readPreferences = () => {
  try { const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
};
const remainingTime = (resetAt: string | null, now: number) => {
  if (!resetAt) return 'Chưa có thời điểm reset';
  const minutes = Math.ceil((Date.parse(resetAt) - now) / 60_000);
  if (!Number.isFinite(minutes)) return 'Chưa có thời điểm reset';
  if (minutes <= 0) return 'Đang chờ cập nhật';
  if (minutes < 60) return `Còn ${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Còn ${hours} giờ ${minutes % 60} phút` : `Còn ${Math.floor(hours / 24)} ngày ${hours % 24} giờ ${minutes % 60} phút`;
};
export function QuotaPage() {
  const [data, setData] = useState<AiQuotaSnapshot | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [auto, setAuto] = useState(() => readPreferences().auto !== false);
  const [sort, setSort] = useState(() => ['asc', 'desc'].includes(readPreferences().sort) ? readPreferences().sort as string : 'default');
  const [compact, setCompact] = useState(() => readPreferences().compact !== false);
  const [hidden, setHidden] = useState<Record<string, string[]>>(() => {
    const saved = readPreferences().hidden;
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  });
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [now, setNow] = useState(Date.now());
  const mounted = useRef(false), pending = useRef(false), nextRefresh = useRef(Date.now() + 60_000);
  const load = useCallback(async (force = false) => {
    if (pending.current || !mounted.current) return;
    pending.current = true; setLoading(true); setError('');
    try {
      if (!window.desktopAi) throw new Error('Mở màn quota trong ứng dụng Desktop.');
      const result = await window.desktopAi.request({ action: 'quota', force }) as AiQuotaSnapshot;
      if (!mounted.current) return;
      setConnected(true); setData(result);
      try { localStorage.setItem('crawldata.quota.cache', JSON.stringify(result)); } catch { /* Quota remains usable without disk cache. */ }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      pending.current = false; nextRefresh.current = Date.now() + 60_000;
      if (mounted.current) { setLoading(false); setNow(Date.now()); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let current = true;
    void (async () => {
      try {
        if (!window.desktopAi) throw new Error('Mở màn quota trong ứng dụng Desktop.');
        const status = await window.desktopAi.request({ action: 'status' });
        if (!current) return;
        setConnected(status.connected);
        if (!status.connected) { setData(null); return; }
        try {
          const cached = JSON.parse(localStorage.getItem('crawldata.quota.cache') || 'null');
          if (typeof status.email === 'string' && status.email && cached?.email === status.email && cached?.accountId && Array.isArray(cached.rows)) setData(cached);
        } catch { /* Ignore invalid cache. */ }
        await load();
      } catch (failure) { if (current) setError(failure instanceof Error ? failure.message : String(failure)); }
    })();
    return () => { current = false; mounted.current = false; };
  }, [load]);
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify({ auto, sort, compact, hidden })); } catch { /* Optional preferences. */ }
  }, [auto, sort, compact, hidden]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      if (auto && connected && Date.now() >= nextRefresh.current && !pending.current) void load();
    };
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [auto, connected, load]);
  const hiddenIds = data && Array.isArray(hidden[data.accountId]) ? hidden[data.accountId] : [];
  const rows = useMemo(() => {
    const visible = (data?.rows || []).filter(row => !hiddenIds.includes(row.id) && row.name.toLowerCase().includes(query.toLowerCase()));
    return sort === 'default' ? visible : [...visible].sort((a, b) => (sort === 'asc' ? a.remaining - b.remaining : b.remaining - a.remaining) || a.name.localeCompare(b.name));
  }, [data, hiddenIds, query, sort]);
  useEffect(() => { setPage(1); }, [query, sort, data?.accountId, hiddenIds.length]);
  const pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);
  const toggleRow = (row: AiQuotaRow, hide: boolean) => {
    if (!data) return;
    setHidden(previous => ({ ...previous, [data.accountId]: hide ? [...new Set([...hiddenIds, row.id])] : hiddenIds.filter(id => id !== row.id) }));
  };
  const selectClass = 'h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs';
  return <div className="mx-auto w-full min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Gauge className="h-5 w-5 text-amber-500" /><div><h1 className="text-xl font-semibold">Quota</h1></div></div><Button size="sm" variant="outline" disabled={loading || connected === false} onClick={() => void load(true)}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới</Button></div>
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" role="switch" checked={auto} onChange={event => { setAuto(event.target.checked); nextRefresh.current = Date.now() + 60_000; }} />Tự làm mới</label>
      <span className="text-xs text-muted-foreground">{loading ? 'Đang cập nhật…' : auto && connected ? `Cập nhật sau ${Math.max(0, Math.ceil((nextRefresh.current - now) / 1000))}s` : auto ? 'Tự làm mới sau khi kết nối' : 'Đã tắt tự làm mới'}</span>
      <div className="flex flex-wrap items-center gap-3 sm:ml-auto"><select aria-label="Sắp xếp quota" className={selectClass} value={sort} onChange={event => setSort(event.target.value)}><option value="default">Thứ tự mặc định</option><option value="asc">% còn lại: thấp → cao</option><option value="desc">% còn lại: cao → thấp</option></select><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!compact} onChange={event => setCompact(!event.target.checked)} />Chi tiết</label></div>
    </div>
    {error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error.includes('Thao tác AI không hợp lệ') ? 'Mở lại ứng dụng để sử dụng màn Quota mới.' : error}</p>}
    {connected === false && <div className="rounded-xl border bg-card p-6 text-sm"><p>Kết nối tài khoản Antigravity để xem quota.</p><Link className="mt-3 inline-block text-primary underline" to="/ai">Mở AI / Antigravity</Link></div>}
    {data && <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5"><div className="min-w-0"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /><h2 className="text-sm font-semibold">Antigravity</h2><span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{data.plan}</span></div><p className="mt-0.5 break-all text-xs text-muted-foreground">{data.email || 'Tài khoản đã kết nối'}</p></div><Link className="text-xs text-primary underline" to="/ai">Quản lý kết nối</Link></header>
      <div className="space-y-2 p-3">
        <label className="flex items-center gap-2 rounded-lg border px-3"><Search className="h-4 w-4 text-muted-foreground" /><input aria-label="Tìm model hoặc nhóm quota" className="h-8 w-full min-w-0 bg-transparent text-xs outline-none" placeholder="Tìm model / nhóm quota" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {data.message && <p className="text-xs text-muted-foreground">{data.message}</p>}
        {!rows.length && <p className="py-8 text-center text-sm text-muted-foreground">{data.rows.length ? 'Không có quota phù hợp hoặc các dòng đã được ẩn.' : 'Chưa có dữ liệu quota. Thử làm mới sau.'}</p>}
        <div className="divide-y">{rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => {
          const color = row.remaining > 50 ? 'bg-emerald-500' : row.remaining > 20 ? 'bg-amber-500' : 'bg-red-500';
          return <div key={row.id} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(150px,1.4fr)_minmax(120px,2fr)_minmax(130px,1fr)_auto] sm:items-center ${compact ? 'py-2' : 'py-3'}`}>
            <div className="min-w-0 truncate text-xs font-medium" title={row.name}>{row.name}</div>
            <div className="col-start-1 flex min-w-0 items-center gap-3 sm:col-start-auto">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Quota ${row.name}`} aria-valuenow={Math.round(row.remaining)} aria-valuemin={0} aria-valuemax={100}><div className={`h-full ${color}`} style={{ width: `${row.remaining}%` }} /></div>
              <strong className={`w-12 shrink-0 rounded px-1.5 py-1 text-right text-xs tabular-nums ${row.remaining > 50 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : row.remaining > 20 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-red-500/10 text-red-500'}`}>{Math.round(row.remaining)}%</strong>
            </div>
            <div className="col-start-1 text-[11px] text-muted-foreground sm:col-start-auto" title={row.resetAt ? new Date(row.resetAt).toLocaleString('vi-VN') : undefined}><p className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{remainingTime(row.resetAt, now)}</p>{!compact && row.resetAt && <p className="mt-1 text-muted-foreground">{new Date(row.resetAt).toLocaleString('vi-VN')}</p>}</div>
            <button type="button" aria-label={`Ẩn quota ${row.name}`} title="Ẩn dòng quota" className="col-start-2 row-start-1 rounded p-1 text-muted-foreground hover:bg-muted sm:col-start-auto sm:row-start-auto" onClick={() => toggleRow(row, true)}><EyeOff className="h-4 w-4" /></button>
          </div>;
        })}</div>
        {pages > 1 && <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs"><span>Trang {currentPage}/{pages} · {rows.length} quota</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button size="sm" variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></div>}
        {!!hiddenIds.length && <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground"><EyeOff className="h-3 w-3" /><span>Đã ẩn:</span>{data.rows.filter(row => hiddenIds.includes(row.id)).map(row => <button className="rounded border px-2 py-1 hover:bg-muted" key={row.id} onClick={() => toggleRow(row, false)} title="Hiện lại quota">{row.name}</button>)}</div>}
      </div>
      <footer className="border-t px-3 py-2 text-[11px] text-muted-foreground">Cập nhật: {new Date(data.updatedAt).toLocaleString('vi-VN')}{loading && ' · Đang làm mới…'}</footer>
    </section>}
    {!data && loading && <p role="status" className="py-8 text-center text-sm text-muted-foreground">Đang tải quota…</p>}
  </div>;
}
