import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { AiGateway } from './ai-gateway';
import type { OcrItem, OcrJob, OcrSnapshot } from './image-ocr-types';

const imageExtension = /\.(png|jpe?g|webp|tiff?|gif|avif)$/i;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
export function imageNames(folder: string): string[] {
  if (!path.isAbsolute(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Folder ảnh không hợp lệ');
  const names = fs.readdirSync(folder, { withFileTypes: true }).filter(item => item.isFile() && imageExtension.test(item.name)).map(item => item.name);
  if (!names.length) throw new Error('Folder không có ảnh PNG, JPG, WEBP, TIFF, GIF hoặc AVIF');
  if (names.length > 5000) throw new Error('Mỗi đợt tối đa 5.000 ảnh');
  return names.sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}
export const oneLine = (text: string) => text.replace(/\s+/gu, ' ').trim();
const prompt = 'Read and transcribe ALL visible text in this image in reading order. Preserve the original language, spelling, punctuation and numbers. Do not translate, summarize, explain, add a heading or use Markdown fences. Return only the transcribed text. If the image contains no text, return exactly <NO_TEXT>.';
export class ImageOcr {
  private job: OcrJob | null = null;
  private controller?: AbortController;
  private active?: Promise<void>;
  private stopped = false;
  private resetting = false;
  constructor(private directory: string, private gateway: () => AiGateway) {
    fs.mkdirSync(directory, { recursive: true });
    try {
      const file = path.join(directory, 'current.json');
      if (fs.statSync(file).size > 32 * 1024 * 1024) throw Error('Too large');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as OcrJob;
      if (!path.isAbsolute(saved.folder) || !path.isAbsolute(saved.output) || !Array.isArray(saved.items) || saved.items.length > 5000 || saved.items.some(item => typeof item.name !== 'string' || path.basename(item.name) !== item.name || !imageExtension.test(item.name))) throw Error('Invalid batch');
      this.job = saved;
      saved.items.forEach(item => { if (item.status === 'processing') item.status = 'pending'; });
      if (saved.status === 'running') saved.status = 'paused';
    } catch { /* Fresh queue. */ }
  }
  snapshot(): OcrSnapshot { return { working: Boolean(this.active) || this.resetting, job: this.job ? { ...this.job, items: this.job.items.map(item => ({ ...item, text: item.text?.slice(0, 240) })) } : null }; }
  private save() {
    if (!this.job) return;
    const file = path.join(this.directory, 'current.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(this.job), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  private config(model: string, keyId: string) {
    const gateway = this.gateway();
    if (!gateway.snapshot().connected) throw new Error('Kết nối Antigravity trước khi đọc ảnh');
    gateway.validateDesktopKey(keyId);
    const resolved = gateway.snapshot().modelAliases?.[model] || model;
    if (!gateway.snapshot().models.some(item => item.id === resolved && item.kind === 'chat')) throw new Error('Chọn model hỗ trợ đọc ảnh trong danh sách Antigravity');
    return resolved;
  }
  create(folder: string, directory: string, model: string, keyId: string) {
    if (this.stopped || this.resetting || this.active || this.job?.items.some(item => item.status === 'pending' || item.status === 'processing')) throw new Error('Hoàn tất đợt hiện tại trước khi tạo đợt mới');
    const resolved = this.config(model, keyId);
    const names = imageNames(folder);
    if (!path.isAbsolute(directory) || !fs.statSync(directory).isDirectory()) throw new Error('Thư mục kết quả không hợp lệ');
    const id = randomUUID();
    const output = path.join(directory, `images-to-text-${id.slice(0, 8)}.txt`);
    fs.closeSync(fs.openSync(output, 'wx', 0o600));
    const previous = this.job;
    // Preserve recovered text in the old batch's output before replacing a failed batch.
    if (previous?.status === 'failed') {
      try { this.writeOutput(previous); } catch (error) { fs.rmSync(output, { force: true }); throw error; }
    }
    this.job = { id, folder, output, model: resolved, keyId, status: 'running', items: names.map(name => ({ name, status: 'pending', attempts: 0 })) };
    try { this.save(); } catch (error) { this.job = previous; fs.rmSync(output, { force: true }); throw error; }
    this.start(); return this.snapshot();
  }
  control(action: 'pause' | 'resume' | 'retry', model?: string, keyId?: string) {
    if (this.resetting) throw new Error('Đang làm mới đợt ảnh');
    if (!this.job) throw new Error('Chưa có đợt ảnh');
    if (action === 'pause') { this.job.status = 'paused'; this.controller?.abort(); this.save(); return this.snapshot(); }
    if (this.active) throw new Error('Chờ ảnh đang xử lý dừng rồi tiếp tục');
    this.job.model = this.config(model || this.job.model, keyId || this.job.keyId);
    this.job.keyId = keyId || this.job.keyId;
    this.job.items.forEach(item => { if (item.status === 'failed') { item.status = 'pending'; delete item.error; } });
    this.job.status = 'running'; delete this.job.error; this.save(); this.start(); return this.snapshot();
  }
  private start() {
    if (this.active || this.stopped) return;
    this.controller = new AbortController();
    this.active = this.process(this.controller.signal).finally(() => { this.active = undefined; this.controller = undefined; });
    // process() records failures, including disk failures, without an unhandled rejection.
    void this.active.catch(() => {});
  }
  private writeOutput(job: OcrJob) {
    const text = job.items.map(item => item.status === 'completed' ? item.text || '' : '').join('\n') + '\n';
    const staging = job.output + '.tmp';
    try { fs.writeFileSync(staging, text, { mode: 0o600 }); fs.renameSync(staging, job.output); }
    finally { fs.rmSync(staging, { force: true }); }
  }
  private async recognize(job: OcrJob, item: OcrItem, signal: AbortSignal) {
    const filename = path.join(job.folder, item.name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 50 * 1024 * 1024) throw new Error('Ảnh không còn tồn tại, là liên kết, hoặc vượt 50 MB');
    // Only one image in memory. Rotate using EXIF, retain resolution up to 4096px.
    const image = await sharp(filename, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (image.length > 16 * 1024 * 1024) throw new Error('Ảnh sau chuẩn hóa vượt 16 MB; hãy giảm kích thước ảnh');
    if (signal.aborted) throw new Error('Đã tạm dừng');
    const result = await this.gateway().desktopChat(job.keyId, { model: job.model, messages: [{ role: 'user', content: [
      { type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } },
    ] }] }, signal);
    const choice = result.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('Model trả text bị cắt. Chọn model khác hoặc chia ảnh nhỏ hơn');
    const text = (choice?.message as Record<string, unknown> | undefined)?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Model không trả text. Hãy chọn model hỗ trợ ảnh');
    return text.trim() === '<NO_TEXT>' ? '' : oneLine(text);
  }
  private async process(signal: AbortSignal) {
    const job = this.job!;
    try {
      for (const item of job.items) {
        if (signal.aborted || this.stopped || job.status !== 'running') return;
        if (item.status === 'completed') continue;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (signal.aborted) return;
          item.status = 'processing'; item.attempts++; delete item.error; this.save();
          try {
            const text = await this.recognize(job, item, signal);
            if (signal.aborted) { item.status = 'pending'; return; }
            const total = job.items.reduce((n, row) => n + Buffer.byteLength(row.text || ''), 0) + Buffer.byteLength(text);
            if (total > 24 * 1024 * 1024) throw new Error('Text vượt 24 MB; hãy chia folder thành các đợt nhỏ hơn');
            item.text = text; item.status = 'completed'; this.save(); break;
          } catch (error) {
            if (signal.aborted) { item.status = 'pending'; return; }
            item.status = 'failed'; item.error = (error instanceof Error ? error.message : String(error)).slice(0, 1200); this.save();
            const status = (error as { status?: number }).status;
            if (status && [400, 401, 403, 404, 429].includes(status)) { job.status = 'paused'; job.error = item.error; return; }
            if (attempt < 2) await new Promise<void>(resolve => {
              const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
              const timer = setTimeout(finish, 2000 * (attempt + 1)); signal.addEventListener('abort', finish, { once: true });
              if (signal.aborted) finish();
            });
          }
        }
      }
      job.status = job.items.every(item => item.status === 'completed') ? 'completed' : 'failed';
      if (job.status === 'completed') this.writeOutput(job);
    } catch (error) {
      job.status = 'paused';
      job.error = error instanceof Error ? error.message : String(error);
      const item = job.items.find(row => row.status === 'processing');
      if (item) { item.status = 'failed'; item.error = error instanceof Error ? error.message : String(error); }
    } finally {
      job.items.forEach(item => { if (item.status === 'processing') item.status = 'pending'; });
      try { this.save(); } catch { job.status = 'paused'; }
    }
  }
  async reset() {
    if (this.resetting) throw new Error('Đang làm mới đợt ảnh');
    this.resetting = true;
    try {
      if (this.job?.status === 'running') this.job.status = 'paused';
      this.controller?.abort();
      // Wait for the old worker's finally/save before removing its state.
      // It must never overwrite the next batch with a late inference result.
      await this.active;
      if (this.job?.items.some(item => item.status === 'completed')) this.writeOutput(this.job);
      fs.rmSync(path.join(this.directory, 'current.json'), { force: true });
      fs.rmSync(path.join(this.directory, 'current.json.tmp'), { force: true });
      this.job = null;
      return this.snapshot();
    } finally { this.resetting = false; }
  }
  text() {
    if (!this.job) return { content: '' };
    const last = this.job.items.reduce((index, item, i) => item.status === 'completed' ? i : index, -1);
    return { content: this.job.items.slice(0, last + 1).map(item => item.status === 'completed' ? item.text || '' : '').join('\n') };
  }
  exportText(filename: string, id: string) {
    if (!this.job || this.job.id !== id) throw new Error('Đợt ảnh đã thay đổi. Hãy chọn tải lại.');
    if (this.active || this.resetting || this.job.status === 'running') throw new Error('Hãy tạm dừng hoặc chờ đọc ảnh xong trước khi tải TXT');
    if (!this.job.items.some(item => item.status === 'completed')) throw new Error('Chưa có kết quả để tải');
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || path.extname(filename).toLowerCase() !== '.txt') throw new Error('Chọn vị trí lưu file TXT hợp lệ');
    this.writeOutput({ ...this.job, output: filename });
    return { output: filename };
  }
  output() {
    if (!this.job || this.job.status !== 'completed' || !fs.existsSync(this.job.output)) throw new Error('Chờ toàn bộ ảnh đọc xong để có file TXT đầy đủ');
    return this.job.output;
  }
  shutdown() { this.stopped = true; this.controller?.abort(); if (this.job?.status === 'running') this.job.status = 'paused'; this.save(); }
}
