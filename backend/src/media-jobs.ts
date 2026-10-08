import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { MediaItem, MediaJob, MediaOptions, MediaTool, MediaSnapshot, AudioFormat } from './media-types';
import { createMediaProcessor, MediaProcessor, ProcessedMedia } from './media-processor';
import { WhisperRuntime } from './media-runtime';

interface StoredItem extends MediaItem { input: string }
interface StoredJob extends MediaJob { items: StoredItem[] }
const isTool = (value: unknown): value is MediaTool => ['srt', 'script', 'extract'].includes(value as string);
const audioExtensions = /\.(mp3|wav|ogg|m4a|aac|wma|flac|opus|webm|aiff|aif)$/i;
const videoExtensions = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpeg|mpg|ts)$/i;
export function mediaOptions(input: Partial<MediaOptions>): MediaOptions {
  const model = input.model || 'base', language = input.language || 'auto', format = input.format || 'mp3', bitrate = input.bitrate || '320';
  if (!['tiny', 'base', 'small'].includes(model) || !['auto', 'vi', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'].includes(language) || !['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(format) || !['64', '128', '192', '256', '320'].includes(bitrate)) throw new Error('Tùy chọn chuyển đổi không hợp lệ');
  return { model, language, format: format as AudioFormat, bitrate };
}
const safeName = (name: string) => name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 140) || 'audio';

export class MediaJobs {
  readonly runtime: WhisperRuntime;
  private jobs: StoredJob[] = [];
  private active?: { job: StoredJob; item: StoredItem; controller: AbortController };
  private pumping = false;
  private stopped = false;
  private readonly processor: MediaProcessor;
  constructor(readonly directory: string, runtime?: WhisperRuntime, processor?: MediaProcessor) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.runtime = runtime || new WhisperRuntime(path.join(path.dirname(directory), 'media-runtime'));
    this.processor = processor || createMediaProcessor(this.runtime);
    try {
      const filename = path.join(directory, 'jobs.json');
      if (fs.statSync(filename).size > 8 * 1024 * 1024) throw new Error('History too large');
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (Array.isArray(saved)) this.jobs = saved.filter(job => isTool(job.tool) && typeof job.id === 'string' && typeof job.directory === 'string' && Array.isArray(job.items) && job.items.length <= 1000).slice(0, 20).map(job => ({
        ...job, options: mediaOptions(job.options || {}), paused: true,
        items: job.items.filter((item: StoredItem) => typeof item.input === 'string' && typeof item.id === 'string' && typeof item.name === 'string').map((item: StoredItem) => ({ ...item, status: item.status === 'running' ? 'pending' : item.status, stage: undefined })),
      }));
    } catch { /* Fresh queue; invalid history cannot become filesystem commands. */ }
  }
  snapshot(): MediaSnapshot { return { jobs: this.jobs.map(job => ({ ...job, items: job.items.map(({ input: _input, ...item }) => ({ ...item })) })), runtime: this.runtime.status() }; }
  private save() {
    const filename = path.join(this.directory, 'jobs.json'), temporary = filename + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.jobs), { mode: 0o600 });
    fs.renameSync(temporary, filename);
  }
  add(input: { tool: MediaTool; paths: string[]; directory: string; options?: Partial<MediaOptions> }) {
    if (this.stopped) throw new Error('Ứng dụng đang đóng');
    if (!isTool(input.tool) || !Array.isArray(input.paths) || !input.paths.length || input.paths.length > 1000) throw new Error('Chọn từ 1 đến 1.000 file cho mỗi đợt');
    if (this.jobs.length >= 20 || this.jobs.reduce((n, job) => n + job.items.length, 0) + input.paths.length > 5000) throw new Error('Hãy xóa lịch sử đã xong trước khi thêm đợt mới (tối đa 20 đợt / 5.000 file)');
    if (typeof input.directory !== 'string' || !path.isAbsolute(input.directory) || !fs.statSync(input.directory).isDirectory()) throw new Error('Thư mục tải xuống không hợp lệ');
    fs.accessSync(input.directory, fs.constants.W_OK);
    const options = mediaOptions(input.options || {});
    if (input.tool !== 'extract' && !this.runtime.status().ready) throw new Error(this.runtime.status().message);
    const paths = [...new Set(input.paths)];
    const items: StoredItem[] = paths.map(file => {
      if (typeof file !== 'string' || !path.isAbsolute(file) || !(input.tool === 'extract' ? videoExtensions : audioExtensions).test(file)) throw new Error('Định dạng file đầu vào không hợp lệ');
      const info = fs.statSync(file);
      if (!info.isFile() || !info.size) throw new Error(`File rỗng hoặc không tồn tại: ${path.basename(file)}`);
      return { id: randomUUID(), input: file, name: path.basename(file), bytes: info.size, status: 'pending' };
    });
    const job: StoredJob = { id: randomUUID(), tool: input.tool, createdAt: new Date().toISOString(), directory: input.directory, options, paused: false, items };
    this.jobs.unshift(job);
    try { this.save(); } catch (error) { this.jobs.shift(); throw error; }
    void this.pump();
    return this.snapshot();
  }
  private job(id: string) { const job = this.jobs.find(job => job.id === id); if (!job) throw new Error('Không tìm thấy đợt xử lý'); return job; }
  control(id: string, action: string) {
    const job = this.job(id);
    if (action === 'pause' || action === 'cancel') {
      job.paused = true;
      if (action === 'cancel') for (const item of job.items) if (item.status === 'pending' || item.status === 'running') { item.status = 'cancelled'; item.stage = undefined; }
      if (this.active?.job.id === id) this.active.controller.abort();
    } else if (action === 'resume' || action === 'retry') {
      if (job.tool !== 'extract' && !this.runtime.status().ready) throw new Error(this.runtime.status().message);
      if (action === 'retry') for (const item of job.items) if (item.status === 'failed' || item.status === 'cancelled') { item.status = 'pending'; item.error = undefined; item.progress = undefined; }
      job.paused = false;
    } else throw new Error('Thao tác không hợp lệ');
    this.save(); void this.pump(); return this.snapshot();
  }
  clear(tool: MediaTool) {
    if (!isTool(tool)) throw new Error('Chức năng không hợp lệ');
    this.jobs = this.jobs.filter(job => job.tool !== tool || job.items.some(item => item.status === 'pending' || item.status === 'running') || this.active?.job.id === job.id);
    this.save(); return this.snapshot();
  }
  private completedItem(id: string, itemId: string) {
    const item = this.job(id).items.find(item => item.id === itemId);
    if (!item || item.status !== 'completed' || !item.output || !fs.existsSync(item.output)) throw new Error('File kết quả không còn trong thư mục tải');
    return item;
  }
  preview(id: string, itemId: string) {
    if (this.job(id).tool === 'extract') throw new Error('Audio không có nội dung văn bản');
    const item = this.completedItem(id, itemId);
    if (fs.statSync(item.output!).size > 8 * 1024 * 1024) throw new Error('Kết quả quá lớn để xem trước');
    return { name: item.name, content: fs.readFileSync(item.output!, 'utf8') };
  }
  output(id: string, itemId: string) { return this.completedItem(id, itemId).output!; }
  async export(id: string, kind: 'txt' | 'zip') {
    const job = this.job(id), items = job.items.filter(item => item.status === 'completed' && item.output && fs.existsSync(item.output));
    if (!items.length) throw new Error('Chưa có file kết quả để xuất');
    if (kind === 'txt') {
      if (job.tool !== 'script') throw new Error('Chỉ Audio to Script hỗ trợ TXT gộp');
      let total = 0;
      const content = items.map((item, index) => {
        total += fs.statSync(item.output!).size;
        if (total > 8 * 1024 * 1024) throw new Error('TXT gộp tối đa 8 MB; hãy xuất ZIP hoặc dùng các file TXT riêng');
        return `${index + 1}. ${path.basename(item.name, path.extname(item.name))}\n\n${fs.readFileSync(item.output!, 'utf8').trim()}`;
      }).join('\n\n\n\n');
      return { filename: 'audio-to-script.txt', content };
    }
    if (kind !== 'zip') throw new Error('Kiểu xuất không hợp lệ');
    const filename = path.join(this.directory, `${randomUUID()}.zip`);
    try {
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createWriteStream(filename), archive = archiver('zip', { zlib: { level: 1 } });
        stream.on('close', resolve); stream.on('error', reject);
        archive.on('error', error => { stream.destroy(); reject(error); });
        archive.on('warning', error => { stream.destroy(); archive.abort(); reject(error); });
        archive.pipe(stream);
        items.forEach((item, index) => archive.file(item.output!, { name: `${String(index + 1).padStart(4, '0')}-${path.basename(item.output!)}` }));
        void archive.finalize().catch(reject);
      });
      const output = await this.publish({ path: filename, extension: 'zip', cleanup: () => {} }, job, 'audio-results');
      return { output };
    } finally { fs.rmSync(filename, { force: true }); }
  }
  private async publish(result: ProcessedMedia, job: MediaJob, name: string, signal?: AbortSignal) {
    const base = safeName(path.basename(name, path.extname(name)));
    const staging = path.join(job.directory, `.crawldata-${randomUUID()}.part`);
    try {
      await fs.promises.copyFile(result.path, staging, fs.constants.COPYFILE_EXCL);
      if (signal?.aborted) throw new Error('Đã hủy lưu file');
      for (let suffix = 0; suffix < 10000; suffix++) {
        const output = path.join(job.directory, `${base}${suffix ? ` (${suffix + 1})` : ''}.${result.extension}`);
        try {
          // Linking publishes a complete file atomically and cannot overwrite another file.
          await fs.promises.link(staging, output);
          return output;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code || '')) {
            try { await fs.promises.copyFile(staging, output, fs.constants.COPYFILE_EXCL); return output; }
            catch (failure) {
              if ((failure as NodeJS.ErrnoException).code === 'EEXIST') continue;
              await fs.promises.rm(output, { force: true }); throw failure;
            }
          }
          throw error;
        }
      }
      throw new Error('Có quá nhiều file cùng tên');
    } finally { await fs.promises.rm(staging, { force: true }); }
  }
  private async pump() {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (!this.stopped) {
        // One shared worker limits CPU, model memory and disk traffic across all three screens.
        const job = [...this.jobs].reverse().find(job => !job.paused && job.items.some(item => item.status === 'pending'));
        if (!job) break;
        const item = job.items.find(item => item.status === 'pending')!;
        const controller = new AbortController();
        this.active = { job, item, controller }; item.status = 'running'; item.error = undefined;
        let result: ProcessedMedia | undefined;
        try {
          this.save();
          result = await this.processor(item.input, job, item, controller.signal, (stage, progress) => { if (!controller.signal.aborted) { item.stage = stage; item.progress = progress; } });
          if (controller.signal.aborted) throw new Error('Đã hủy xử lý');
          item.stage = 'Đang lưu file';
          item.output = await this.publish(result, job, item.name, controller.signal);
          item.status = 'completed'; item.progress = 100; item.stage = 'Đã lưu file';
        } catch (error) {
          if (controller.signal.aborted) { if ((item as MediaItem).status !== 'cancelled') item.status = 'pending'; item.progress = undefined; item.stage = undefined; }
          else {
            item.status = 'failed'; item.stage = undefined; item.progress = undefined;
            item.error = (error instanceof Error ? error.message : String(error)).slice(-1800);
            if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code || '')) job.paused = true;
          }
        } finally {
          try { result?.cleanup(); } catch { /* A failure to clean temp files never discards a saved output. */ }
          this.active = undefined;
          try { this.save(); } catch { job.paused = true; }
        }
      }
    } finally { this.pumping = false; }
  }
  async dispatch(input: any) {
    switch (input?.action) {
      case 'list': return this.snapshot();
      case 'runtime': await this.runtime.refresh(); return this.snapshot();
      case 'install-whisper':
        if (this.jobs.some(job => job.tool !== 'extract' && !job.paused && job.items.some(item => item.status === 'pending' || item.status === 'running'))) throw new Error('Tạm dừng các đợt nhận dạng trước khi cài / sửa Whisper');
        return { ...this.snapshot(), runtime: this.runtime.install() };
      case 'create': return this.add(input);
      case 'pause': case 'resume': case 'retry': case 'cancel': return this.control(input.id, input.action);
      case 'clear': return this.clear(input.tool);
      case 'preview': return this.preview(input.id, input.itemId);
      case 'output': return { output: this.output(input.id, input.itemId) };
      case 'export': return this.export(input.id, input.kind);
      default: throw new Error('Thao tác media không hợp lệ');
    }
  }
  shutdown() { this.stopped = true; for (const job of this.jobs) job.paused = true; this.active?.controller.abort(); this.runtime.shutdown(); this.save(); }
}
