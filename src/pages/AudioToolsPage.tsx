import { useEffect, useRef, useState } from 'react';
import { Copy, Download, FileAudio, FileText, FolderOpen, Loader2, Pause, Play, RotateCcw, Scissors, Subtitles, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MediaJob, MediaOptions, MediaRequest, MediaSnapshot, MediaTool, SelectedMediaFile } from '../../backend/src/media-types';

const tools = {
  srt: { title: 'Convert Audio to SRT', subtitle: 'Nhận dạng giọng nói và tạo phụ đề có thời gian.', icon: Subtitles, button: 'Chuyển sang SRT' },
  script: { title: 'Audio to Script', subtitle: 'Chuyển lời nói thành văn bản để đọc, sao chép hoặc đưa vào AI Script Converter.', icon: FileText, button: 'Chuyển sang Script' },
  extract: { title: 'Extract Audio', subtitle: 'Tách âm thanh từ video sang MP3, WAV, AAC, FLAC hoặc OGG.', icon: Scissors, button: 'Tách audio' },
};
const defaults: MediaOptions = { model: 'base', language: 'auto', format: 'mp3', bitrate: '320' };
const selectClass = 'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const sizeOf = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const request = (input: MediaRequest) => {
  if (!window.desktopMedia) return Promise.reject(new Error('Mở chức năng này trong ứng dụng Desktop để chọn file trên máy.'));
  return window.desktopMedia.request(input);
};
function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function AudioToolsPage({ tool }: { tool: MediaTool }) {
  const config = tools[tool], Icon = config.icon;
  const [snapshot, setSnapshot] = useState<MediaSnapshot>({ jobs: [], runtime: { ready: false, checking: true, installing: false, message: 'Đang kiểm tra Whisper…' } });
  const [files, setFiles] = useState<SelectedMediaFile[]>([]);
  const [options, setOptions] = useState(defaults);
  const [selected, setSelected] = useState<string | null | undefined>();
  const selection = useRef<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(1), [filter, setFilter] = useState('all');
  const [viewer, setViewer] = useState<{ name: string; content: string } | null>(null);
  const [confirm, setConfirm] = useState<'clear' | 'cancel' | null>(null);
  const mounted = useRef(false);
  const jobs = snapshot.jobs.filter(job => job.tool === tool);
  const job = jobs.find(job => job.id === selected);
  const selectJob = (id: string | null) => { selection.current = id; setSelected(id); setPage(1); setFilter('all'); };
  const apply = (data: MediaSnapshot) => {
    if (!mounted.current) return;
    setSnapshot(data);
    if (selection.current === undefined) selectJob(data.jobs.find(job => job.tool === tool)?.id || null);
  };
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { apply(await request({ action: 'list' })); }
      catch (failure) { if (mounted.current) setError(messageOf(failure)); }
      if (mounted.current) timer = setTimeout(poll, 1000);
    };
    void poll();
    if (tool !== 'extract') void request({ action: 'runtime' }).then(apply).catch(failure => { if (mounted.current) setError(messageOf(failure)); });
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [tool]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (failure) { if (mounted.current) setError(messageOf(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const addFiles = (selectedFiles: SelectedMediaFile[]) => {
    if (!mounted.current || !selectedFiles.length) return;
    setFiles(previous => [...previous, ...selectedFiles].slice(0, 1000));
    selectJob(null);
    if (files.length + selectedFiles.length > 1000) toast.error('Mỗi đợt tối đa 1.000 file; chỉ giữ 1.000 file đầu tiên.');
  };
  const choose = () => void run(async () => { if (!window.desktopMedia) throw new Error('Cần mở ứng dụng Desktop'); addFiles(await window.desktopMedia.select(tool)); });
  const start = () => void run(async () => {
    const data: MediaSnapshot = await request({ action: 'create', tool, fileIds: files.map(file => file.id), options });
    if (!mounted.current) return;
    apply(data); selectJob(data.jobs[0].id); setFiles([]); toast.success('Đã thêm vào hàng đợi. Kết quả được lưu tự động.');
  });
  const control = (action: 'pause' | 'resume' | 'retry' | 'cancel') => void run(async () => {
    if (!job) return;
    apply(await request({ action, id: job.id })); setConfirm(null);
  });
  const preview = (itemId: string) => void run(async () => {
    if (!job) return;
    const result = await request({ action: 'preview', id: job.id, itemId });
    if (mounted.current) setViewer(result);
  });
  const copy = async (text: string) => {
    if (window.desktopScripts) await window.desktopScripts.copy(text); else await navigator.clipboard.writeText(text);
    toast.success('Đã sao chép');
  };
  const exportJob = (kind: 'txt' | 'zip', copying = false) => void run(async () => {
    if (!job) return;
    const result = await request({ action: 'export', id: job.id, kind });
    if (kind === 'txt') { if (copying) await copy(result.content); else downloadText(result.content, result.filename); }
    else toast.success(`Đã lưu ZIP: ${result.output}`);
  });
  const counts = job ? {
    completed: job.items.filter(item => item.status === 'completed').length,
    failed: job.items.filter(item => item.status === 'failed').length,
    cancelled: job.items.filter(item => item.status === 'cancelled').length,
    pending: job.items.filter(item => item.status === 'pending').length,
    running: job.items.some(item => item.status === 'running'),
  } : null;
  const results = job?.items.filter(item => filter === 'all' || item.status === filter) || [];
  const pages = Math.max(1, Math.ceil((job ? results.length : files.length) / 50));
  const currentPage = Math.min(page, pages);
  const clearable = jobs.some(job => job.items.every(item => !['pending', 'running'].includes(item.status)));
  const ready = tool === 'extract' || snapshot.runtime.ready;
  const finished = Boolean(counts && !counts.pending && !counts.running);
  const jobLabel = (job: MediaJob) => `${new Date(job.createdAt).toLocaleString('vi-VN')} · ${job.items.length} file · ${job.items.filter(item => item.status === 'completed').length} xong`;

  return <div className="mx-auto max-w-6xl min-w-0 space-y-5 p-4 sm:p-6" data-media-tool={tool}>
    <div className="flex items-start gap-3">
      <div className="rounded-xl bg-primary/10 p-3 text-primary"><Icon className="h-6 w-6" /></div>
      <div className="min-w-0"><h1 className="text-xl font-bold sm:text-2xl">{config.title}</h1><p className="mt-1 text-sm text-muted-foreground">{config.subtitle}</p></div>
    </div>
    {error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {tool !== 'extract' && <Card className="flex flex-col gap-3 border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="text-sm font-semibold">Nhận dạng giọng nói · Whisper</p><p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground" aria-live="polite">{snapshot.runtime.message}</p></div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy || snapshot.runtime.checking || snapshot.runtime.installing || counts?.running} onClick={() => void run(async () => apply(await request({ action: 'runtime' })))}>Kiểm tra lại</Button>
        {!snapshot.runtime.ready && <Button size="sm" disabled={busy || snapshot.runtime.checking || snapshot.runtime.installing} onClick={() => void run(async () => apply(await request({ action: 'install-whisper' })))}>{snapshot.runtime.installing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{snapshot.runtime.installing ? 'Đang cài Whisper' : 'Cài / sửa Whisper'}</Button>}
      </div>
    </Card>}
    <Card className="space-y-4 border-border p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">Đợt đã lưu
          <select aria-label="Đợt xử lý audio" className={selectClass} value={selected || ''} onChange={event => selectJob(event.target.value || null)}>
            <option value="">Đợt mới</option>{jobs.map(job => <option key={job.id} value={job.id}>{jobLabel(job)}</option>)}
          </select>
        </label>
        <Button variant="outline" disabled={busy || !clearable} onClick={() => setConfirm('clear')}><Trash2 className="mr-2 h-4 w-4" />Xóa lịch sử xử lý</Button>
      </div>
      {!job ? <>
        <div className="grid gap-4 sm:grid-cols-2">
          {tool === 'extract' ? <>
            <label className="space-y-1 text-sm font-medium">Định dạng
              <select id="media-format" className={selectClass} value={options.format} onChange={event => setOptions(previous => ({ ...previous, format: event.target.value as MediaOptions['format'] }))}>{['mp3', 'wav', 'aac', 'flac', 'ogg'].map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select>
            </label>
            <label className="space-y-1 text-sm font-medium">Bitrate
              <select id="media-bitrate" className={selectClass} value={options.bitrate} disabled={options.format === 'wav' || options.format === 'flac'} onChange={event => setOptions(previous => ({ ...previous, bitrate: event.target.value as MediaOptions['bitrate'] }))}>{['64', '128', '192', '256', '320'].map(value => <option key={value} value={value}>{value} kbps</option>)}</select>
              <span className="block text-xs font-normal text-muted-foreground">WAV và FLAC giữ chất lượng, không dùng bitrate.</span>
            </label>
          </> : <>
            <label className="space-y-1 text-sm font-medium">Model Whisper
              <select id="media-model" className={selectClass} value={options.model} onChange={event => setOptions(previous => ({ ...previous, model: event.target.value as MediaOptions['model'] }))}><option value="tiny">Tiny · nhanh</option><option value="base">Base · cân bằng</option><option value="small">Small · chính xác hơn, chậm hơn</option></select>
            </label>
            <label className="space-y-1 text-sm font-medium">Ngôn ngữ trong audio
              <select id="media-language" className={selectClass} value={options.language} onChange={event => setOptions(previous => ({ ...previous, language: event.target.value as MediaOptions['language'] }))}>{Object.entries({ auto: 'Tự nhận dạng', vi: 'Tiếng Việt', en: 'Tiếng Anh', zh: 'Tiếng Trung', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', fr: 'Tiếng Pháp', de: 'Tiếng Đức', es: 'Tiếng Tây Ban Nha' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
          </>}
        </div>
        <button type="button" disabled={busy} onClick={choose}
          onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) { const dropped = Array.from(event.dataTransfer.files); void run(async () => { if (!window.desktopMedia) throw new Error('Cần mở ứng dụng Desktop'); addFiles(await window.desktopMedia.files(dropped, tool)); }); } }}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`}>
          <Upload className="h-7 w-7 text-muted-foreground" /><span className="font-medium">Chọn hoặc kéo thả {tool === 'extract' ? 'video' : 'audio'} vào đây</span><span className="text-xs text-muted-foreground">Nhiều file · tối đa 1.000 file mỗi đợt · đọc trực tiếp từ máy</span>
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Đã chọn {files.length} file</span><div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy || !files.length} onClick={() => setFiles([])}>Bỏ danh sách</Button><Button disabled={busy || !files.length || !ready} onClick={start}><Play className="mr-2 h-4 w-4" />{config.button}</Button></div></div>
      </> : counts && <>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div><h2 className="font-semibold">{finished ? 'Đã kết thúc' : job.paused ? 'Đã tạm dừng' : counts.running ? 'Đang xử lý' : 'Đang chờ lượt'}</h2><p className="mt-1 text-sm text-muted-foreground">{counts.completed}/{job.items.length} đã lưu · {counts.failed} lỗi · {counts.cancelled} đã hủy</p></div>
          <div className="flex flex-wrap gap-2">
            {!finished && (job.paused ? <Button disabled={busy || !ready} onClick={() => control('resume')}><Play className="mr-2 h-4 w-4" />Tiếp tục</Button> : <Button variant="outline" disabled={busy} onClick={() => control('pause')}><Pause className="mr-2 h-4 w-4" />Tạm dừng</Button>)}
            {!!(counts.failed + counts.cancelled) && <Button variant="outline" disabled={busy || counts.running || !ready} onClick={() => control('retry')}><RotateCcw className="mr-2 h-4 w-4" />Thử lại file lỗi / hủy</Button>}
            {!finished && <Button variant="outline" disabled={busy} onClick={() => setConfirm('cancel')}>Hủy đợt</Button>}
          </div>
        </div>
        <Progress value={(counts.completed + counts.failed + counts.cancelled) / job.items.length * 100} />
        <p className="break-all text-xs text-muted-foreground">Thư mục kết quả: {job.directory}</p>
        <div className="flex flex-wrap gap-2">
          {tool !== 'extract' && <Button variant="outline" disabled={busy || !counts.completed} onClick={() => exportJob('zip')}><Download className="mr-2 h-4 w-4" />Xuất ZIP</Button>}
          {tool === 'script' && <><Button variant="outline" disabled={busy || !counts.completed} onClick={() => exportJob('txt')}><Download className="mr-2 h-4 w-4" />Xuất TXT gộp</Button><Button variant="outline" disabled={busy || !counts.completed} onClick={() => exportJob('txt', true)}><Copy className="mr-2 h-4 w-4" />Sao chép tất cả</Button></>}
          <Button variant="ghost" onClick={() => { selectJob(null); setFiles([]); }}>Tạo đợt mới</Button>
        </div>
      </>}
      <p className="text-xs text-muted-foreground">Xử lý lần lượt, chuyển màn vẫn chạy. File được lưu tự động vào thư mục tải đã chọn và không ghi đè file cũ. Đợt chưa xong được giữ để tiếp tục sau khi mở lại app.</p>
    </Card>
    {(job || files.length > 0) && <Card className="min-w-0 overflow-hidden border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">{job ? 'Kết quả xử lý' : 'File đã chọn'}</h2>{job && <select aria-label="Lọc trạng thái audio" className={`${selectClass} !w-auto`} value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">Tất cả ({job.items.length})</option><option value="completed">Đã lưu file</option><option value="failed">Lỗi</option><option value="pending">Đang chờ</option><option value="running">Đang xử lý</option><option value="cancelled">Đã hủy</option></select>}</div>
      <div className="divide-y divide-border">{job ? results.slice((currentPage - 1) * 50, currentPage * 50).map(item => <article key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <FileAudio className="hidden h-5 w-5 shrink-0 text-muted-foreground sm:block" /><div className="min-w-0 flex-1 space-y-1"><p className="break-all text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{sizeOf(item.bytes)} · <span className={item.status === 'failed' ? 'text-destructive' : item.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : ''}>{item.status === 'running' ? item.stage || 'Đang xử lý' : { pending: 'Đang chờ', completed: 'Đã lưu file', failed: 'Lỗi', cancelled: 'Đã hủy' }[item.status]}</span>{item.status === 'running' && item.progress !== undefined ? ` · ${Math.round(item.progress)}%` : ''}</p>{item.error && <p className="whitespace-pre-wrap break-words text-xs text-destructive">{item.error}</p>}{item.output && <p className="break-all text-xs text-muted-foreground">{item.output}</p>}</div>
        {item.status === 'running' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
        {item.status === 'completed' && <div className="flex shrink-0 flex-wrap gap-2">{tool !== 'extract' && <Button size="sm" variant="outline" disabled={busy} onClick={() => preview(item.id)}>Xem kết quả</Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await request({ action: 'reveal', id: job.id, itemId: item.id }); })}><FolderOpen className="mr-2 h-4 w-4" />Mở thư mục</Button></div>}
      </article>) : files.slice((currentPage - 1) * 50, currentPage * 50).map(file => <article key={file.id} className="flex items-center gap-3 p-4"><FileAudio className="h-5 w-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{sizeOf(file.bytes)}</p></div><Button size="icon" variant="ghost" aria-label={`Bỏ ${file.name}`} disabled={busy} onClick={() => setFiles(previous => previous.filter(item => item.id !== file.id))}><X className="h-4 w-4" /></Button></article>)}</div>
      {job && !results.length && <p className="p-6 text-center text-sm text-muted-foreground">Không có file ở trạng thái này.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4 text-sm"><span className="text-muted-foreground">Trang {currentPage}/{pages} · 50 file/trang</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button size="sm" variant="outline" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></div>
    </Card>}
    <Dialog open={!!viewer} onOpenChange={open => { if (!open) setViewer(null); }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle className="break-all pr-5">{viewer?.name}</DialogTitle><DialogDescription>{tool === 'srt' ? 'Phụ đề SRT có thời gian.' : 'Lời nói đã chuyển thành văn bản.'}</DialogDescription></DialogHeader><pre className="max-h-[55dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-sm">{viewer?.content}</pre><DialogFooter className="gap-2"><Button variant="outline" onClick={() => void run(async () => copy(viewer?.content || ''))}>Sao chép</Button><Button onClick={() => { if (viewer) downloadText(viewer.content, viewer.name.replace(/\.[^.]+$/, '') + (tool === 'srt' ? '.srt' : '.txt')); }}>Tải kết quả</Button><Button variant="ghost" onClick={() => setViewer(null)}>Đóng</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm === 'clear' ? 'Xóa lịch sử xử lý?' : 'Hủy đợt xử lý?'}</DialogTitle><DialogDescription>{confirm === 'clear' ? 'Xóa các đợt đã kết thúc khỏi danh sách. File kết quả và file gốc được giữ nguyên. Đợt chưa xong vẫn được giữ để tiếp tục.' : 'Dừng file đang xử lý và hủy các file đang chờ. File đã lưu được giữ nguyên; có thể thử lại các file đã hủy.'}</DialogDescription></DialogHeader><DialogFooter className="gap-2"><Button variant="outline" onClick={() => setConfirm(null)}>Quay lại</Button><Button variant="destructive" disabled={busy} onClick={() => { if (confirm === 'cancel') control('cancel'); else void run(async () => { const data: MediaSnapshot = await request({ action: 'clear', tool }); apply(data); if (!data.jobs.some(job => job.id === selected)) selectJob(null); setConfirm(null); }); }}>{confirm === 'clear' ? 'Xóa lịch sử' : 'Hủy xử lý'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
