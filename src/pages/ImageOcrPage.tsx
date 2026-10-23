import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FolderOpen, Loader2, Pause, RotateCcw, Settings2, X } from 'lucide-react';
import './image-ocr.css';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import type { AiSnapshot } from '../../backend/src/ai-types';
import type { OcrRequest, OcrSnapshot, OcrItem } from '../../backend/src/image-ocr-types';

const selectClass = 'ocr-select';
export function ImageOcrPage() {
  const [ai, setAi] = useState<AiSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<OcrSnapshot>({ job: null });
  const [folder, setFolder] = useState<{ id: string; name: string; files: string[] } | null>(null);
  const [model, setModel] = useState(''), [keyId, setKeyId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState('');
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [copied, setCopied] = useState(false);
  const resultPane = useRef<HTMLDivElement>(null);
  const followText = useRef(true);
  const resetEpoch = useRef(0);
  const resetting = useRef(false);
  const mounted = useRef(false);
  const initialized = useRef(false);
  const job = snapshot.job;
  const request = (input: OcrRequest): Promise<any> => {
    if (!window.desktopOcr) return Promise.reject(new Error('Mở chức năng này trong ứng dụng Desktop.'));
    return window.desktopOcr.request(input);
  };
  const loadAi = async () => {
    if (!window.desktopAi) throw new Error('Mở chức năng này trong ứng dụng Desktop.');
    const data = await window.desktopAi.request({ action: 'status' }) as AiSnapshot;
    if (!mounted.current) return;
    setAi(data);
    setModel(current => data.models.some(item => item.id === current && item.kind === 'chat') ? current : data.models.find(item => item.id === data.defaultModelId && item.kind === 'chat')?.id || data.models.find(item => item.kind === 'chat')?.id || '');
    setKeyId(current => data.keys.some(key => key.id === current) ? current : data.keys[0]?.id || '');
  };
  useEffect(() => {
    mounted.current = true;
    let current = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const epoch = resetEpoch.current;
      try { const data = await request({ action: 'get' }) as OcrSnapshot; if (current && !resetting.current && epoch === resetEpoch.current) {
        setSnapshot(data);
        if (!initialized.current) { initialized.current = true; if (data.job) { setModel(data.job.model); setKeyId(data.job.keyId); } }
      } }
      catch (failure) { if (current) setError(failure instanceof Error ? failure.message : String(failure)); }
      if (current) timer = setTimeout(poll, 1500);
    };
    void poll();
    void loadAi().catch(failure => { if (current) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { current = false; mounted.current = false; clearTimeout(timer); };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const control = (action: 'pause' | 'resume' | 'retry') => void run(async () => {
    const data = await request({ action, model, keyId });
    if (mounted.current) setSnapshot(data);
  });
  const completed = job?.items.filter(item => item.status === 'completed').length || 0;
  const failed = job?.items.filter(item => item.status === 'failed').length || 0;
  const empty = job?.items.filter(item => item.status === 'completed' && !item.text?.trim()).length || 0;
  const running = job?.status === 'running';
  const working = snapshot.working ?? running;
  const locked = Boolean(job && job.status !== 'completed' && job.status !== 'failed');
  const rows: OcrItem[] = folder ? folder.files.map(name => ({ name, status: 'pending', text: undefined, error: undefined, attempts: 0 })) : job?.items || [];
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pages);
  useEffect(() => {
    let current = true;
    const epoch = resetEpoch.current;
    setPreviewLoaded(false); setPreviewError(''); setCopied(false);
    if (!job || folder) { setPreview(''); return; }
    void request({ action: 'text' }).then(data => { if (current && !resetting.current && epoch === resetEpoch.current) { setPreview(data.content || ''); setPreviewLoaded(true); } }).catch(() => { if (current && epoch === resetEpoch.current) setPreviewError('Mở lại ứng dụng để xem và sao chép text. Tiến độ đã đọc vẫn được giữ.'); });
    return () => { current = false; };
  }, [job?.id, completed, folder?.id]);
  useLayoutEffect(() => { followText.current = true; }, [job?.id, folder?.id]);
  useLayoutEffect(() => {
    const pane = resultPane.current;
    if (pane && followText.current) pane.scrollTop = pane.scrollHeight;
  }, [preview, job?.id, folder?.id]);
  const choose = () => void run(async () => {
    if (!window.desktopOcr) throw new Error('Cần mở ứng dụng Desktop');
    const selected = await window.desktopOcr.selectFolder();
    if (mounted.current && selected) { setFolder(selected); setPage(1); setCopied(false); }
  });
  const start = () => void run(async () => {
    if (!folder) return;
    const data = await request({ action: 'create', folderId: folder.id, model, keyId });
    if (mounted.current) { setSnapshot(data); setFolder(null); setPage(1); setCopied(false); }
  });
  const copy = () => void run(async () => {
    const data = await request({ action: 'text' });
    if (window.desktopScripts) await window.desktopScripts.copy(data.content);
    else await navigator.clipboard.writeText(data.content);
    if (mounted.current) setCopied(true);
  });
  const reset = () => void run(async () => {
    resetting.current = true; resetEpoch.current++;
    try {
      const data = await request({ action: 'reset' });
      if (!mounted.current) return;
      setSnapshot(data); setFolder(null); setPreview(''); setPreviewLoaded(false); setPreviewError('');
      setCopied(false); setDragging(false); setPage(1); followText.current = true;
    } finally { resetting.current = false; resetEpoch.current++; }
  });
  const showingJob = job && !folder;
  return <div className="ocr-studio">
    {showingJob && <header className="ocr-progress-header">
      <div className="ocr-job-status"><span>{{ running: 'Đang giải mã ảnh…', paused: 'Đã tạm dừng', completed: 'Đã hoàn tất', failed: 'Còn ảnh bị lỗi' }[job.status]}</span><strong className="ocr-progress-value">{completed}/{job.items.length} ảnh · {Math.round(completed / job.items.length * 100)}%{running && <Loader2 size={15} className="animate-spin" aria-label="Đang xử lý ảnh" />}{failed ? ` · ${failed} lỗi` : ''}</strong></div>
      <div className="ocr-progress" role="progressbar" aria-label="Ảnh đã đọc" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={job.items.length}><div style={{ width: `${completed / job.items.length * 100}%` }} /></div>
    </header>}
    {error && <p role="alert" className="ocr-alert">{error.includes('Thao tác đọc ảnh không hợp lệ') ? 'Mở lại ứng dụng để dùng các thao tác mới. Tiến độ đã đọc vẫn được giữ.' : error}</p>}
    <div className="ocr-workspace">
      <section className="ocr-panel ocr-upload-panel" aria-labelledby="ocr-upload-heading">
        <div className="ocr-upload-header"><h2 id="ocr-upload-heading">📂 Tải Ảnh Của Bạn Lên</h2><button type="button" className="ocr-reset" disabled={busy || (!job && !folder)} onClick={reset}><RotateCcw size={14} /> Làm mới</button></div>
        <div className={`ocr-dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy && !locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => {
          event.preventDefault(); setDragging(false);
          if (busy || locked || running) return;
          const files = Array.from(event.dataTransfer.files);
          void run(async () => {
            if (!window.desktopOcr?.dropFolder) throw new Error('Hãy mở lại ứng dụng để kéo thả folder hoặc bấm Chọn từ máy tính.');
            const selected = await window.desktopOcr.dropFolder(files);
            if (mounted.current) { setFolder(selected); setPage(1); setCopied(false); }
          });
        }}>
          <span className="ocr-camera" aria-hidden="true">{folder || showingJob ? '🗂️' : '📸'}</span>
          <h3>{folder ? folder.name : showingJob ? job.folder.split(/[\\/]/).pop() : 'Kéo & thả folder ảnh vào đây'}</h3>
          <p>{folder ? `${folder.files.length} ảnh · đã sắp xếp theo tên` : showingJob ? `${completed}/${job.items.length} ảnh đã đọc${failed ? ` · ${failed} lỗi` : ''}` : 'JPG, PNG, WebP và nhiều định dạng khác'}</p>
          <button type="button" className="ocr-choose" disabled={busy || locked || running} onClick={choose}>Chọn từ máy tính</button>
          {folder && <button className="ocr-clear" type="button" disabled={busy} onClick={() => setFolder(null)}><X size={13} /> Bỏ chọn folder</button>}
        </div>
        <Dialog>
          <DialogTrigger asChild><button type="button" className="ocr-config-trigger" disabled={busy}><Settings2 size={15} /><span>Model & API key</span><span className="ocr-model-caption">{ai?.models.find(item => item.id === model)?.name || 'Antigravity'}</span></button></DialogTrigger>
          <DialogContent className="ocr-config-dialog border-slate-200 bg-white text-slate-800">
            <DialogHeader><DialogTitle>Model & API key</DialogTitle><DialogDescription className="text-slate-500">Chọn model hỗ trợ đọc ảnh và API key Antigravity của bạn.</DialogDescription></DialogHeader>
            <div className="ocr-config-body">
              {!ai?.connected && <p>Kết nối tài khoản và tạo API key ở màn AI / Antigravity.</p>}
              <label>Model hỗ trợ đọc ảnh<select className={selectClass} value={model} disabled={busy || running} onChange={event => setModel(event.target.value)}><option value="">Chọn model</option>{ai?.models.filter(item => item.kind === 'chat').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>API key cá nhân<select className={selectClass} value={keyId} disabled={busy || running} onChange={event => setKeyId(event.target.value)}><option value="">Chọn API key</option>{ai?.keys.map(key => <option key={key.id} value={key.id}>{key.name} · {key.preview}</option>)}</select></label>
              <button className="ocr-link" type="button" disabled={busy || running} onClick={() => void run(loadAi)}>Tải lại model / API key</button>
              {error && <p role="alert" className="ocr-inline-error">{error}</p>}
            </div>
            <DialogFooter><DialogClose asChild><button type="button" className="ocr-dialog-done">Xong</button></DialogClose></DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="ocr-upload-actions">
          {showingJob && !running && empty > 0 && <button type="button" className="ocr-run ocr-secondary-run" disabled={busy || working || !ai?.connected || !model || !keyId} onClick={() => control('retry')}><RotateCcw size={18} /> THỬ LẠI {empty} ẢNH TRỐNG</button>}
          {showingJob && job.error && <p role="alert" className="ocr-inline-error">{job.error}</p>}
          {showingJob && running ? <button className="ocr-run ocr-secondary-run" disabled={busy} onClick={() => control('pause')}><Pause size={18} /> TẠM DỪNG</button> : showingJob && job.status !== 'completed' ? <button className="ocr-run" disabled={busy || !ai?.connected || !model || !keyId} onClick={() => control(failed ? 'retry' : 'resume')}><RotateCcw size={18} /> {failed ? 'THỬ LẠI ẢNH LỖI / TIẾP TỤC' : 'TIẾP TỤC GIẢI MÃ 🔮'}</button> : <button className="ocr-run" disabled={busy || !folder || !ai?.connected || !model || !keyId} onClick={start}>{busy ? <Loader2 className="animate-spin" size={18} /> : null}CHẠY THẦN CHÚ 🔮</button>}
        </div>
      </section>
      <section className="ocr-panel ocr-result-panel" aria-labelledby="ocr-result-heading">
        <div className="ocr-result-header"><h2 id="ocr-result-heading">✨ Kết Quả Giải Mã ✨</h2><div className="ocr-result-actions"><button type="button" className="ocr-copy" disabled={busy || !showingJob || !completed || !previewLoaded} onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Đã sao chép' : 'Sao chép'}</button><button type="button" className="ocr-copy" disabled={busy || !showingJob || !completed || working || running} title={running || working ? 'Tạm dừng hoặc chờ đọc ảnh xong để tải TXT' : 'Tải file TXT kết quả'} onClick={() => void run(async () => { await request({ action: 'download' }); })}><Download size={13} />Tải TXT</button></div></div>
        <div ref={resultPane} onScroll={event => {
          const pane = event.currentTarget;
          followText.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 48;
        }} className={`ocr-result ${preview && showingJob ? 'has-text' : ''}`} tabIndex={0} aria-label="Văn bản đọc từ ảnh">
          {preview && showingJob ? <pre>{preview}</pre> : <div className="ocr-placeholder">{showingJob && previewError ? <p>{previewError}</p> : showingJob && completed && !previewLoaded ? <p>Đang tải văn bản…</p> : showingJob && running ? <><Loader2 className="mx-auto mb-4 animate-spin" size={22} /><p>Đang đọc ảnh của bạn…</p><p>Văn bản sẽ xuất hiện tại đây.</p></> : showingJob && completed ? <><p>Ảnh đã đọc không có chữ.</p><p>Dòng trống được giữ theo đúng thứ tự ảnh.</p></> : <><p>Hệ thống đang chờ lệnh thần chú...</p><p>Hãy bấm CHẠY THẦN CHÚ để bắt đầu!</p></>}</div>}
        </div>
        <p className="ocr-note">* Mỗi ảnh một dòng, không xuống dòng trong văn bản của từng ảnh.</p>
        {showingJob && job.status === 'completed' && <button type="button" className="ocr-output" disabled={busy} onClick={() => void run(async () => { await request({ action: 'reveal' }); })}><FolderOpen size={16} /> Mở file TXT đã lưu</button>}
      </section>
    </div>
    {!!rows.length && <details className="ocr-file-details" open={failed > 0 || undefined}>
      <summary>Danh sách ảnh <span>{rows.length} ảnh · theo thứ tự tên file</span></summary>
      <div className="ocr-file-list">{rows.slice((currentPage - 1) * 50, currentPage * 50).map((item, index) => <div className="ocr-file-row" key={item.name}><span className="ocr-file-index">{(currentPage - 1) * 50 + index + 1}</span><div><p>{item.name}</p><span className={item.status === 'failed' ? 'ocr-inline-error' : ''}>{{ pending: 'Đang chờ', processing: 'Đang đọc', completed: 'Đã đọc', failed: 'Lỗi' }[item.status]}</span>{item.error && <p className="ocr-inline-error">{item.error}</p>}</div>{item.status === 'processing' && <Loader2 className="animate-spin" size={16} />}</div>)}</div>
      <div className="ocr-pagination"><span>Trang {currentPage}/{pages}</span><div><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trước</button><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Sau</button></div></div>
    </details>}
  </div>;
}
