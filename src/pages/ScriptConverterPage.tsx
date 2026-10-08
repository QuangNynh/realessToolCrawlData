import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, Eye, FileText, Loader2, Play, Plus, RefreshCw, Square, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AiSnapshot } from '../../backend/src/ai-types';
import type { ConvertedScript, ScriptJob, ScriptJobSummary, ScriptRequest, ScriptSnapshot } from '../../backend/src/script-converter-types';

const DEFAULT_PROMPT = 'Dịch kịch bản sau sang tiếng Việt tự nhiên, mượt mà:\n\n[SCRIPT]';
const EXAMPLE = '1.\nhttps://www.youtube.com/watch?v=VIDEO_ID\n\nTiêu đề kịch bản\n\nNội dung kịch bản cần chuyển đổi...\n\n2.\nhttps://www.youtube.com/watch?v=VIDEO_ID_2\n\nTiêu đề thứ hai\n\nNội dung kịch bản thứ hai...';
const statusLabel = { pending: 'Chờ xử lý', processing: 'Đang xử lý', completed: 'Hoàn thành', failed: 'Lỗi', paused: 'Đã dừng', running: 'Đang chạy' };
const messageOf = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Không thể xử lý kịch bản';
async function request(input: ScriptRequest) {
  if (!window.desktopScripts) throw new Error('Mở ứng dụng Desktop để sử dụng Script Converter');
  return window.desktopScripts.request(input);
}
async function copy(text: string) {
  try { if (window.desktopScripts) await window.desktopScripts.copy(text); else await navigator.clipboard.writeText(text); toast.success('Đã sao chép'); }
  catch { toast.error('Không thể sao chép. Hãy chọn nội dung và sao chép thủ công'); }
}

export function ScriptConverterPage() {
  const [ai, setAi] = useState<AiSnapshot>({ connected: false, connecting: false, keys: [], models: [] });
  const [jobs, setJobs] = useState<ScriptJobSummary[]>([]);
  const [job, setJob] = useState<ScriptJob | null>(null);
  const [draft, setDraft] = useState<ConvertedScript[]>([]);
  const [selected, setSelected] = useState<string | null>();
  const selection = useRef<string | null | undefined>(undefined);
  const revision = useRef(-1);
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'batch' | 'single'>('batch');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState('');
  const [keyId, setKeyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [viewer, setViewer] = useState<{ title: string; content: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const select = (id: string | null) => {
    selection.current = id; revision.current = -1; setSelected(id); setJob(null); setPage(1); setFilter('all');
  };
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [snapshot, account]: [ScriptSnapshot, AiSnapshot] = await Promise.all([
          request({ action: 'list' }), window.desktopAi ? window.desktopAi.request({ action: 'status' }) : Promise.resolve(ai),
        ]);
        if (!mounted.current) return;
        setJobs(snapshot.jobs); setAi(account);
        setModel(previous => account.models.some(m => m.id === previous && m.kind === 'chat') ? previous : account.modelAliases?.[previous] || account.defaultModelId || account.models.find(m => m.kind === 'chat')?.id || '');
        setKeyId(previous => account.keys.some(k => k.id === previous) ? previous : account.keys[0]?.id || '');
        if (selection.current === undefined) select(snapshot.jobs[0]?.id || null);
        const selectedSummary = snapshot.jobs.find(j => j.id === selection.current);
        if (selectedSummary && selectedSummary.revision !== revision.current) {
          const data: ScriptJob = await request({ action: 'get', id: selectedSummary.id });
          if (mounted.current && selection.current === data.id && data.revision >= revision.current) {
            const firstLoad = revision.current === -1;
            revision.current = data.revision; setJob(data);
            if (firstLoad) { setPrompt(data.prompt); setModel(account.modelAliases?.[data.model] || data.model); setKeyId(data.keyId); }
          }
        }
      } catch (failure) { if (mounted.current) setError(messageOf(failure)); }
      if (mounted.current) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); };
  }, []);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (failure) { if (mounted.current) setError(messageOf(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const readFile = (file?: File) => {
    if (!file || busy || selected) return;
    void run(async () => {
      if (!/\.txt$/i.test(file.name)) throw new Error('Vui lòng chọn file .txt');
      if (file.size > 8 * 1024 * 1024) throw new Error('File kịch bản tối đa 8 MB');
      const text = await file.text();
      if (!mounted.current) return;
      setRawText(text); setFileName(file.name); setDraft([]); toast.success(`Đã đọc ${file.name}`);
    });
  };
  const parse = () => void run(async () => {
    const result = await request({ action: 'parse', rawText, mode });
    if (!mounted.current) return;
    select(null); setDraft(result.scripts.map((script: ConvertedScript) => ({ ...script, status: 'pending', attempts: 0 })));
    toast.success(`Đã phân tích ${result.scripts.length} kịch bản`);
  });
  const start = () => void run(async () => {
    const data: ScriptJob = await request({ action: 'create', rawText, mode, prompt, model, keyId, name: fileName });
    if (!mounted.current) return;
    select(data.id); revision.current = data.revision; setJob(data); setDraft([]);
    const { scripts: _scripts, prompt: _prompt, ...summary } = data;
    setJobs(previous => [summary, ...previous]);
    toast.success('Đã bắt đầu chuyển đổi');
  });
  const control = (action: 'pause' | 'resume') => void run(async () => {
    if (!job) return;
    const data: ScriptJob = await request({ action, id: job.id, model, keyId });
    if (mounted.current && selection.current === data.id) { revision.current = data.revision; setJob(data); }
  });
  const exportResult = (format: 'txt' | 'doc', clipboard = false) => void run(async () => {
    if (!job) return;
    const result = await request({ action: 'export', id: job.id, format });
    if (clipboard) { await copy(result.content); return; }
    const url = URL.createObjectURL(new Blob([result.content], { type: result.mime }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const remove = () => void run(async () => {
    if (!job) return;
    const result: ScriptSnapshot = await request({ action: 'delete', id: job.id });
    if (!mounted.current) return;
    setJobs(result.jobs); select(result.jobs[0]?.id || null); setDeleting(false); toast.success('Đã xóa dữ liệu đợt chuyển đổi');
  });
  const refreshModels = () => void run(async () => {
    if (window.desktopAi) setAi(await window.desktopAi.request({ action: 'refresh-models' }));
  });
  const scripts = job?.scripts || (selected ? [] : draft);
  const filtered = scripts.filter(script => filter === 'all' || script.status === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  const active = jobs.some(item => item.status === 'running') || job?.status === 'running';
  const canRun = ai.connected && !ai.connecting && Boolean(model && keyId) && !busy && !active;
  const percent = scripts.length ? Math.round((job?.completed || 0) / scripts.length * 100) : 0;
  const selectClass = 'h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm';

  return <div className='mx-auto max-w-6xl space-y-5'>
    <header><h1 className='flex items-center gap-2 text-2xl font-semibold'><FileText className='h-6 w-6 shrink-0 text-primary' />AI Script Converter</h1>
      <p className='mt-2 text-sm text-muted-foreground'>Chuyển đổi, dịch hoặc viết lại nhiều kịch bản bằng prompt của bạn và model Antigravity.</p></header>
    <section className='space-y-3 rounded-lg border bg-card p-4 sm:p-6'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='min-w-0 flex-1 basis-64'><label htmlFor='script-history' className='mb-2 block text-sm font-medium'>Đợt đã lưu ({jobs.length}/20)</label>
          <select id='script-history' value={selected || ''} onChange={event => select(event.target.value || null)} disabled={busy} className={selectClass}>
            <option value=''>Đợt mới</option>{jobs.map(item => <option key={item.id} value={item.id}>{item.name} · {item.completed}/{item.total} · {statusLabel[item.status]}</option>)}
          </select></div>
        <Button variant='outline' disabled={busy} onClick={() => { select(null); setPrompt(DEFAULT_PROMPT); setError(''); }}><Plus className='mr-2 h-4 w-4' />Đợt mới</Button>
        <Button variant='outline' disabled={busy || !job || job.status === 'running'} className='text-destructive' onClick={() => setDeleting(true)}><Trash2 className='mr-2 h-4 w-4' />Xóa đợt đã lưu</Button>
      </div>
      <p className='text-xs text-muted-foreground'>Tiến độ được lưu trên máy. Chuyển màn hình vẫn tiếp tục chạy; đóng ứng dụng sẽ dừng và có thể tiếp tục khi mở lại.</p>
    </section>
    <section className='grid gap-6 rounded-lg border bg-card p-4 sm:p-6 lg:grid-cols-2'>
      <div className='min-w-0 space-y-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'><h2 className='font-semibold'>1. Nhập kịch bản</h2>
          <Button variant='outline' size='sm' disabled={busy || Boolean(selected)} onClick={() => fileInput.current?.click()}><Upload className='mr-2 h-4 w-4' />Tải file TXT</Button></div>
        <input ref={fileInput} type='file' accept='.txt,text/plain' className='hidden' aria-label='Chọn file kịch bản TXT' onChange={event => { readFile(event.target.files?.[0]); event.target.value = ''; }} />
        <label htmlFor='script-mode' className='sr-only'>Chế độ nhập</label><select id='script-mode' value={mode} className={selectClass} disabled={busy || Boolean(selected)} onChange={event => { setMode(event.target.value as 'batch' | 'single'); setDraft([]); }}>
          <option value='batch'>Nhiều kịch bản (số thứ tự / URL / tiêu đề / nội dung)</option><option value='single'>Kịch bản đơn (văn bản tự do)</option></select>
        {selected ? <div className='rounded-md bg-muted p-4 text-sm'><p>Đang xem đợt đã lưu: <strong className='break-words'>{job?.name || 'Đang tải…'}</strong></p><p className='mt-2 text-muted-foreground'>Bấm Xem gốc ở từng mục để đọc nội dung. Bấm Đợt mới để nhập file khác.</p></div>
          : <div className={`rounded-md border ${dragging ? 'border-primary bg-primary/5' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); readFile(event.dataTransfer.files[0]); }}>
            <Textarea aria-label='Nội dung kịch bản' value={rawText} disabled={busy} onChange={event => { setRawText(event.target.value); setDraft([]); }} placeholder={mode === 'batch' ? EXAMPLE : 'Dán kịch bản cần chuyển đổi hoặc kéo thả file TXT…'} className='min-h-60 border-0 font-mono text-sm' />
          </div>}
        {!selected && <><p className='break-words text-xs text-muted-foreground'>{fileName || 'Kéo thả file TXT hoặc dán nội dung.'} Tối đa 8 MB / 1.000 kịch bản.</p>
          <Button variant='outline' disabled={busy || !rawText.trim() || !window.desktopScripts} onClick={parse}><RefreshCw className='mr-2 h-4 w-4' />Phân tích kịch bản</Button></>}
      </div>
      <div className='min-w-0 space-y-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'><h2 className='font-semibold'>2. Model và prompt</h2><Link to='/ai' className='text-sm text-primary underline'>Kết nối / tạo API key</Link></div>
        {!ai.connected && <p className='text-sm text-muted-foreground'>Kết nối Antigravity và tạo API key ở màn AI để bắt đầu.</p>}
        <div><label htmlFor='script-key' className='mb-1 block text-sm'>API key cá nhân</label><select id='script-key' className={selectClass} value={keyId} disabled={busy || job?.status === 'running'} onChange={event => setKeyId(event.target.value)}>
          {!ai.keys.length && <option value=''>Chưa có API key</option>}{ai.keys.map(key => <option key={key.id} value={key.id}>{key.name} ({key.preview})</option>)}</select></div>
        <div><label htmlFor='script-model' className='mb-1 block text-sm'>Model văn bản</label><div className='flex min-w-0 gap-2'>
          <select id='script-model' className={selectClass} value={model} disabled={busy || job?.status === 'running'} onChange={event => setModel(event.target.value)}>
            {!ai.models.some(item => item.kind === 'chat') && <option value=''>Chưa có model</option>}{ai.models.filter(item => item.kind === 'chat').map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select>
          <Button variant='outline' size='icon' aria-label='Làm mới model cho kịch bản' disabled={busy || active || !ai.connected} onClick={refreshModels}><RefreshCw className='h-4 w-4' /></Button></div></div>
        <div><label htmlFor='script-prompt' className='mb-1 block text-sm'>Prompt cấu hình (bắt buộc có [SCRIPT])</label>
          <Textarea id='script-prompt' value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy || Boolean(selected)} className='min-h-32' maxLength={100000} /></div>
        <p className='text-xs text-muted-foreground'>[SCRIPT] được thay bằng nội dung từng kịch bản. Chạy tuần tự; tự thử lại một lần khi gặp lỗi tạm thời. Một key dùng được với tất cả model văn bản khả dụng.</p>
      </div>
    </section>
    {error && <p role='alert' className='break-words rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>{error}</p>}
    {active && job?.status !== 'running' && <p role='status' className='text-sm text-muted-foreground'>Một đợt khác đang chạy. Chọn đợt đó trong lịch sử và bấm Dừng chạy trước khi bắt đầu đợt này.</p>}
    {(scripts.length > 0 || selected) && <section className='space-y-4 rounded-lg border bg-card p-4 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div><h2 className='font-semibold'>Kết quả ({job?.completed || 0}/{scripts.length})</h2><p role='status' className='text-sm text-muted-foreground'>{job ? statusLabel[job.status] : 'Đã phân tích, sẵn sàng chuyển đổi'}{job?.currentId && ` · Kịch bản ${job.currentId}`}</p></div>
        <div className='flex flex-wrap gap-2'>
          {job?.status === 'running' ? <Button variant='outline' disabled={busy} onClick={() => control('pause')}><Square className='mr-2 h-4 w-4' />Dừng chạy</Button>
            : job ? job.completed < job.total && <Button disabled={!canRun} onClick={() => control('resume')}><Play className='mr-2 h-4 w-4' />{job.status === 'failed' ? 'Chạy lại mục lỗi' : 'Tiếp tục'}</Button>
            : <Button disabled={!canRun || !draft.length || !prompt.includes('[SCRIPT]')} onClick={start}><Play className='mr-2 h-4 w-4' />Bắt đầu chạy AI</Button>}
          {job && <><Button variant='outline' disabled={busy} onClick={() => exportResult('txt', true)}><Copy className='mr-2 h-4 w-4' />Sao chép kết quả</Button>
            <Button variant='outline' disabled={busy} onClick={() => exportResult('txt')}><Download className='mr-2 h-4 w-4' />Xuất TXT</Button>
            <Button variant='outline' disabled={busy} onClick={() => exportResult('doc')}><Download className='mr-2 h-4 w-4' />Xuất Word</Button></>}
        </div>
      </div>
      {job && <><div role='progressbar' aria-label='Tiến độ chuyển đổi' aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className='h-2 overflow-hidden rounded-full bg-muted'><div className='h-full bg-primary transition-[width]' style={{ width: `${percent}%` }} /></div>
        <p className='text-xs text-muted-foreground'>{job.completed} thành công · {job.failed} lỗi · {job.total - job.completed - job.failed} chưa hoàn tất. Khi xuất, mục chưa hoàn tất giữ nội dung gốc.</p></>}
      {job?.retryAt && <p role='status' className='text-sm text-amber-600 dark:text-amber-400'>Đang chờ thử lại đến {new Date(job.retryAt).toLocaleTimeString('vi-VN')}. Có thể bấm Dừng chạy.</p>}
      {job?.error && <p role='alert' className='break-words text-sm text-destructive'>{job.error}</p>}
      <div className='flex flex-wrap items-center justify-between gap-2'><label className='flex items-center gap-2 text-sm'>Lọc trạng thái<select aria-label='Lọc trạng thái kịch bản' className='h-9 rounded-md border bg-background px-2' value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}>
        <option value='all'>Tất cả ({scripts.length})</option>{['pending', 'processing', 'completed', 'failed'].map(status => <option key={status} value={status}>{statusLabel[status as keyof typeof statusLabel]}</option>)}</select></label>
        <p className='text-xs text-muted-foreground'>{filtered.length} mục · 50 mục/trang</p></div>
      <div className='space-y-2'>{visible.map(script => <article key={script.id} className={`min-w-0 rounded-md border p-3 ${script.status === 'processing' ? 'border-primary/50 bg-primary/5' : ''}`}>
        <div className='flex flex-wrap items-start justify-between gap-2'><div className='min-w-0 flex-1 basis-48'><p className='break-words text-sm font-medium'>{script.indexText} {script.title}</p>
          {/^https?:\/\//i.test(script.link) && <a className='text-xs text-primary underline' href={script.link} target='_blank' rel='noopener noreferrer'>Link video</a>}
          <p className='mt-1 line-clamp-2 break-words text-xs text-muted-foreground'>{script.result || script.content}</p></div>
          <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${script.status === 'failed' ? 'bg-destructive/10 text-destructive' : script.status === 'completed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
            {script.status === 'processing' && <Loader2 className='h-3 w-3 animate-spin' />}{statusLabel[script.status]}{script.attempts > 0 && ` · ${script.attempts} lần`}</span></div>
        {script.error && <p className='mt-2 break-words text-xs text-destructive'>{script.error}</p>}
        <div className='mt-2 flex flex-wrap gap-2'><Button variant='ghost' size='sm' onClick={() => setViewer({ title: `Kịch bản gốc ${script.indexText}`, content: script.content })}><Eye className='mr-1 h-3.5 w-3.5' />Xem gốc</Button>
          <Button variant='ghost' size='sm' disabled={!script.result} onClick={() => setViewer({ title: `Kết quả AI ${script.indexText}`, content: script.result || '' })}><Eye className='mr-1 h-3.5 w-3.5' />Xem kết quả</Button></div>
      </article>)}</div>
      {!visible.length && <p className='text-sm text-muted-foreground'>{selected && !job ? 'Đang tải kịch bản…' : 'Không có mục khớp trạng thái này.'}</p>}
      <div className='flex flex-wrap items-center justify-end gap-2'><Button variant='outline' size='sm' disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trang trước</Button>
        <span className='text-sm'>Trang {currentPage}/{pages}</span><Button variant='outline' size='sm' disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Trang sau</Button></div>
    </section>}
    <Dialog open={Boolean(viewer)} onOpenChange={open => { if (!open) setViewer(null); }}><DialogContent className='max-w-3xl'>
      <DialogHeader><DialogTitle>{viewer?.title}</DialogTitle><DialogDescription>Nội dung đầy đủ của kịch bản đã chọn.</DialogDescription></DialogHeader>
      <pre className='max-h-[55dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm'>{viewer?.content}</pre>
      <DialogFooter><Button variant='outline' onClick={() => setViewer(null)}>Đóng</Button><Button onClick={() => void copy(viewer?.content || '')}><Copy className='mr-2 h-4 w-4' />Sao chép</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={deleting} onOpenChange={setDeleting}><DialogContent><DialogHeader><DialogTitle>Xóa đợt chuyển đổi đã lưu?</DialogTitle><DialogDescription>Xóa toàn bộ nội dung gốc và kết quả của đợt này khỏi ứng dụng. Hãy xuất kết quả cần giữ trước khi xóa.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant='outline' disabled={busy} onClick={() => setDeleting(false)}>Hủy</Button><Button variant='destructive' disabled={busy} onClick={remove}>Xóa dữ liệu đợt này</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
