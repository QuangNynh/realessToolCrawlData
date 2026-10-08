import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { classifyDownloadError, retryDelay, youtubeVideoId, type DownloadErrorKind } from './youtube-download-policy';

export type MediaKind = 'audio' | 'video';
export interface DownloadItem {
  id: string;
  index: number;
  videoId: string;
  videoUrl: string;
  status: 'pending' | 'loading' | 'retrying' | 'success' | 'failed';
  attempts: number;
  progress: number;
  nextAttemptAt: number;
  title?: string;
  error?: string;
  errorKind?: DownloadErrorKind;
  outputPath?: string;
  sourcePath?: string;
  bytes?: number;
  sha256?: string;
}
export interface DownloadBatch {
  id: string;
  kind: MediaKind;
  quality: string;
  directory: string;
  createdAt: number;
  paused: boolean;
  items: DownloadItem[];
}
export interface MediaFile { file: string; title: string; extension: string }
type Downloader = (batch: DownloadBatch, item: DownloadItem, workspace: string, signal: AbortSignal, progress: (value: number) => void) => Promise<MediaFile>;
const qualities = ['2160p', '4k', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];

// One worker is shared by audio and video. Retrying jobs keep their .part files,
// and a YouTube block stops new requests from every batch.
export class YouTubeDownloadQueue {
  private batches: DownloadBatch[] = [];
  private cooldownUntil = 0;
  private blockCount = 0;
  private nextStartAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: { batch: DownloadBatch; item: DownloadItem; controller: AbortController };
  private stopped = false;
  private persistenceError?: string;
  private readonly file: string;
  private readonly workRoot: string;

  constructor(private readonly root: string, private readonly download: Downloader, private readonly pacingMs = 4000, private readonly random = Math.random) {
    fs.mkdirSync(root, { recursive: true });
    this.file = path.join(root, 'queue.json');
    this.workRoot = path.join(root, 'files');
    this.restore();
    this.schedule();
  }

  private restore() {
    if (!fs.existsSync(this.file) && !fs.existsSync(this.file + '.bak')) return;
    let saved: any;
    for (const file of [this.file, this.file + '.bak']) {
      try {
        const candidate = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (candidate.version !== 1 || !Array.isArray(candidate.batches)) throw new Error('Invalid queue');
        saved = candidate;
        break;
      } catch { /* Try the last committed backup. */ }
    }
    if (!saved) throw new Error('Không thể đọc hàng đợi YouTube. Hãy giữ queue.json và queue.json.bak để khôi phục.');
    this.batches = saved.batches;
    this.cooldownUntil = Number(saved.cooldownUntil) || 0;
    this.blockCount = Number(saved.blockCount) || 0;
    for (const batch of this.batches) {
      for (const item of batch.items) {
        if (item.status === 'loading') {
          item.status = 'retrying';
          item.progress = 0;
          item.nextAttemptAt = Date.now();
        }
      }
    }
  }

  private persist() {
    const temporary = this.file + '.tmp';
    const descriptor = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ version: 1, batches: this.batches, cooldownUntil: this.cooldownUntil, blockCount: this.blockCount }));
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    // The backup always contains a complete snapshot, including on Windows.
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    fs.renameSync(temporary, this.file);
  }

  snapshot() {
    return structuredClone({ batches: this.batches, cooldownUntil: this.cooldownUntil, active: this.active?.item.id || null, error: this.persistenceError || null });
  }

  add(input: { urls: string[]; kind: MediaKind; quality?: string; directory: string }) {
    if (!Array.isArray(input.urls) || !input.urls.length || input.urls.length > 1000) throw new Error('Mỗi lô cần từ 1 đến 1.000 URL YouTube');
    if (!['audio', 'video'].includes(input.kind)) throw new Error('Loại tải không hợp lệ');
    const quality = input.quality || '1080p';
    if (!qualities.includes(quality)) throw new Error('Chất lượng video không hợp lệ');
    if (!path.isAbsolute(input.directory) || !fs.statSync(input.directory).isDirectory()) throw new Error('Thư mục tải xuống không tồn tại');
    fs.accessSync(input.directory, fs.constants.W_OK);
    const ids = [...new Set(input.urls.map(youtubeVideoId))];
    const batch: DownloadBatch = {
      id: randomUUID(), kind: input.kind, quality, directory: input.directory,
      createdAt: Date.now(), paused: false,
      items: ids.map((id, i) => ({ id: randomUUID(), index: i + 1, videoId: id, videoUrl: `https://www.youtube.com/watch?v=${id}`, status: 'pending', attempts: 0, progress: 0, nextAttemptAt: 0 })),
    };
    this.batches.push(batch);
    try { this.persist(); } catch (error) { this.batches.pop(); throw error; }
    this.schedule();
    return structuredClone(batch);
  }

  control(id: string, action: 'pause' | 'resume' | 'retry') {
    const batch = this.batches.find(batch => batch.id === id);
    if (!batch) throw new Error('Không tìm thấy lô tải');
    if (!['pause', 'resume', 'retry'].includes(action)) throw new Error('Thao tác không hợp lệ');
    batch.paused = action === 'pause';
    if (action === 'retry') {
      for (const item of batch.items) {
        if (item.status === 'failed') {
          item.status = 'pending'; item.attempts = 0; item.nextAttemptAt = 0; item.error = undefined; item.errorKind = undefined;
        }
      }
    }
    // Pause is graceful: finish the file being written and stop before the next.
    this.persist();
    if (this.persistenceError) { this.persistenceError = undefined; this.stopped = false; }
    this.schedule();
    return this.snapshot();
  }

  clearHistory(kind: MediaKind) {
    if (!['audio', 'video'].includes(kind)) throw new Error('Loại lịch sử tải không hợp lệ');
    const finished = this.batches.filter(batch => batch.kind === kind && batch.id !== this.active?.batch.id
      && batch.items.every(item => item.status === 'success' || item.status === 'failed'));
    const removed = new Set<string>();
    const cleanupErrors: string[] = [];
    for (const batch of finished) {
      try {
        for (const item of batch.items) {
          // Only delete our own workspaces and staging files. Never follow
          // sourcePath/outputPath from the manifest into the user's media.
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) throw new Error('ID file tạm không hợp lệ');
          fs.rmSync(path.join(this.workRoot, item.id), { recursive: true, force: true });
          fs.rmSync(path.join(batch.directory, `.lenyt-${item.id}.part`), { force: true });
        }
        removed.add(batch.id);
      } catch (error) {
        // Keep a history entry if cleanup failed, so the user can retry it.
        cleanupErrors.push(`Không thể dọn lô ${new Date(batch.createdAt).toLocaleString('vi-VN')}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (removed.size) {
      const previous = this.batches;
      this.batches = previous.filter(batch => !removed.has(batch.id));
      try { this.persist(); }
      catch (error) { this.batches = previous; throw error; }
      if (this.persistenceError) { this.persistenceError = undefined; this.stopped = false; }
      // Compact the backup too, so cleared history cannot return on recovery
      // and neither manifest continues growing with deleted entries.
      try {
        fs.copyFileSync(this.file, this.file + '.bak');
        const descriptor = fs.openSync(this.file + '.bak', 'r+');
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      } catch (error) {
        cleanupErrors.push(`Không thể thu gọn bản sao lịch sử: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.schedule();
    }
    return { ...this.snapshot(), clearedBatches: removed.size, cleanupErrors };
  }

  private schedule() {
    if (this.stopped || this.active) return;
    if (this.timer) clearTimeout(this.timer);
    const candidates = this.batches.filter(batch => !batch.paused).flatMap(batch => batch.items.filter(item => item.status === 'pending' || item.status === 'retrying'));
    if (!candidates.length) return;
    const due = Math.max(this.cooldownUntil, this.nextStartAt, Math.min(...candidates.map(item => item.nextAttemptAt)));
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, Math.min(2_147_483_647, Math.max(0, due - Date.now())));
    this.timer.unref();
  }

  private async tick() {
    if (this.stopped || this.active) return;
    if (Date.now() < Math.max(this.cooldownUntil, this.nextStartAt)) { this.schedule(); return; }
    const batch = this.batches.find(batch => !batch.paused && batch.items.some(item => ['pending', 'retrying'].includes(item.status) && item.nextAttemptAt <= Date.now()));
    const item = batch?.items.find(item => ['pending', 'retrying'].includes(item.status) && item.nextAttemptAt <= Date.now());
    if (!batch || !item) { this.schedule(); return; }
    const controller = new AbortController();
    this.active = { batch, item, controller };
    const workspace = path.join(this.workRoot, item.id);
    try {
      item.status = 'loading'; item.attempts++; item.progress = 0;
      this.persist();
      fs.mkdirSync(workspace, { recursive: true });
      // Recover a file committed before a crash without downloading it again.
      if (!(await this.committed(item))) {
        let media: MediaFile;
        if (item.sourcePath && fs.existsSync(item.sourcePath) && item.bytes === fs.statSync(item.sourcePath).size) {
          media = { file: item.sourcePath, title: item.title || item.videoId, extension: path.extname(item.sourcePath).slice(1) };
        } else {
          media = await this.download(batch, item, workspace, controller.signal, value => { item.progress = Math.min(99, Math.max(0, value)); });
        }
        if (this.stopped) throw new Error('Download interrupted');
        await this.commit(batch, item, media);
      }
      item.status = 'success'; item.progress = 100; item.error = undefined; item.errorKind = undefined; item.nextAttemptAt = 0;
      this.blockCount = 0;
      this.persist();
      try { fs.rmSync(workspace, { recursive: true, force: true }); }
      catch (error) { console.warn('[YouTube queue] Could not remove completed workspace:', error); }
    } catch (error) {
      item.progress = 0;
      if (this.stopped) { item.status = 'retrying'; item.nextAttemptAt = Date.now(); }
      else {
        const failure = classifyDownloadError(error);
        item.error = failure.message; item.errorKind = failure.kind;
        if (failure.kind === 'unavailable' || failure.kind === 'filesystem' || (failure.kind === 'unknown' && item.attempts >= 5)) {
          item.status = 'failed';
          if (failure.kind === 'filesystem') batch.paused = true;
        } else {
          item.status = 'retrying';
          const attempts = failure.kind === 'rate_limit' ? ++this.blockCount : item.attempts;
          const delay = Math.max(retryDelay(failure.kind, attempts, this.random), failure.retryAfterMs);
          item.nextAttemptAt = Date.now() + delay;
          if (failure.kind === 'rate_limit' || failure.kind === 'network') this.cooldownUntil = Math.max(this.cooldownUntil, item.nextAttemptAt);
        }
      }
      try { this.persist(); } catch (saveError) {
        // Stop work if we cannot record it; continuing would lose recovery data.
        this.stopped = true;
        batch.paused = true;
        item.status = 'failed';
        item.errorKind = 'filesystem';
        this.persistenceError = `Không thể lưu hàng đợi. Khắc phục ổ đĩa/quyền ghi rồi thử lại: ${saveError instanceof Error ? saveError.message : String(saveError)}`;
        item.error = this.persistenceError;
        console.error('[YouTube queue] Cannot save queue:', saveError);
      }
    } finally {
      this.active = undefined;
      this.nextStartAt = Date.now() + this.pacingMs * (1 + this.random() * 0.5);
      this.schedule();
    }
  }

  private async checksum(file: string) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  }

  private async committed(item: DownloadItem) {
    try {
      return Boolean(item.outputPath && item.bytes && item.sha256 && fs.statSync(item.outputPath).size === item.bytes
        && await this.checksum(item.outputPath) === item.sha256);
    }
    catch { return false; }
  }

  private async commit(batch: DownloadBatch, item: DownloadItem, media: MediaFile) {
    const bytes = fs.statSync(media.file).size;
    if (!bytes) throw new Error('File tải về rỗng');
    if (!/^[a-z0-9]{2,5}$/i.test(media.extension)) throw new Error('Định dạng file không hợp lệ');
    const existing = new Set(this.batches.flatMap(batch => batch.items.filter(other => other !== item).map(other => other.outputPath)));
    if (!item.outputPath || fs.existsSync(item.outputPath)) {
      let target = path.join(batch.directory, `${item.index}.${media.extension}`);
      let suffix = 2;
      while (fs.existsSync(target) || existing.has(target)) target = path.join(batch.directory, `${item.index} (${suffix++}).${media.extension}`);
      item.outputPath = target;
    }
    item.bytes = bytes; item.title = media.title; item.sourcePath = media.file;
    item.sha256 = await this.checksum(media.file);
    this.persist();
    const temporary = path.join(batch.directory, `.lenyt-${item.id}.part`);
    await fs.promises.copyFile(media.file, temporary);
    const descriptor = await fs.promises.open(temporary, 'r+');
    try { await descriptor.sync(); } finally { await descriptor.close(); }
    if (fs.statSync(temporary).size !== bytes) throw new Error('File tải về incomplete');
    // link() creates the destination exclusively, so an unrelated existing file
    // is never overwritten even when another application writes at the same time.
    try { await fs.promises.link(temporary, item.outputPath); }
    catch (error: any) {
      // FAT/exFAT and some network volumes do not support hard links.
      if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error;
      await fs.promises.copyFile(temporary, item.outputPath, fs.constants.COPYFILE_EXCL);
      const final = await fs.promises.open(item.outputPath, 'r+');
      try { await final.sync(); } finally { await final.close(); }
    }
    await fs.promises.unlink(temporary);
    if (fs.statSync(item.outputPath).size !== bytes) throw new Error('File tải về incomplete');
  }

  shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.active?.controller.abort();
    this.persist();
  }
}
