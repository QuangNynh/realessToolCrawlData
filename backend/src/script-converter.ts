import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AiError } from './ai-types';
import type { AiGateway } from './ai-gateway';
import type { ScriptJob, ScriptJobSummary, ScriptRequest } from './script-converter-types';
import { exportScriptsDoc, exportScriptsText, parseScripts, scriptPrompt } from './script-converter-format';

type Gateway = Pick<AiGateway, 'snapshot' | 'validateDesktopKey' | 'desktopChat'>;
export class ScriptConverter {
  private jobs = new Map<string, ScriptJob>();
  private active?: { id: string; controller: AbortController };
  private stopped = false;
  constructor(private directory: string, private getGateway: () => Gateway, private retryDelay = 3000) {
    if (!fs.existsSync(directory)) return;
    for (const file of fs.readdirSync(directory).filter(name => /^[\w-]+\.json$/.test(name))) {
      const job: ScriptJob = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (file !== `${job.id}.json` || !Array.isArray(job.scripts)) throw new Error('Dữ liệu Script Converter không hợp lệ');
      if (job.status === 'running' || job.scripts.some(s => s.status === 'processing')) {
        job.status = 'paused'; job.error = 'Ứng dụng đã đóng khi đang xử lý. Bấm Tiếp tục để chạy các mục còn lại';
        job.scripts.forEach(s => { if (s.status === 'processing') s.status = 'pending'; });
        delete job.currentId; delete job.retryAt;
        this.save(job);
      }
      this.jobs.set(job.id, job);
    }
  }
  private summary(job: ScriptJob): ScriptJobSummary {
    const { scripts: _scripts, prompt: _prompt, ...summary } = job;
    return { ...summary };
  }
  snapshot() { return { jobs: [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => this.summary(job)) }; }
  get(id: unknown) {
    if (typeof id !== 'string' || !this.jobs.has(id)) throw new AiError('Không tìm thấy đợt chuyển đổi', 404);
    return this.jobs.get(id)!;
  }
  private save(job: ScriptJob) {
    job.total = job.scripts.length; job.completed = job.scripts.filter(s => s.status === 'completed').length; job.failed = job.scripts.filter(s => s.status === 'failed').length;
    job.revision++; job.updatedAt = new Date().toISOString();
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${job.id}.json`);
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(job)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }
  private config(model: unknown, keyId: unknown) {
    const gateway = this.getGateway();
    if (!gateway.snapshot().connected) throw new AiError('Kết nối Antigravity trong màn AI trước khi chuyển đổi', 401);
    if (typeof keyId !== 'string') throw new AiError('Chọn API key cá nhân');
    gateway.validateDesktopKey(keyId);
    if (typeof model === 'string') model = gateway.snapshot().modelAliases?.[model] || model;
    if (typeof model !== 'string' || !gateway.snapshot().models.some(m => m.id === model && m.kind === 'chat')) throw new AiError('Chọn model văn bản từ tài khoản Antigravity');
    return { model, keyId };
  }
  create(input: ScriptRequest) {
    if (this.stopped) throw new AiError('Ứng dụng đang đóng', 409);
    if (this.active) throw new AiError('Dừng đợt đang chạy trước khi bắt đầu đợt mới', 409);
    if (this.jobs.size >= 20) throw new AiError('Đã lưu 20 đợt. Xuất kết quả và xóa đợt cũ trước khi tạo thêm');
    const scripts = parseScripts(input.rawText, input.mode).map(script => ({ ...script, status: 'pending' as const, attempts: 0 }));
    scripts.forEach(script => scriptPrompt(input.prompt, script.content));
    const { model, keyId } = this.config(input.model, input.keyId);
    const now = new Date().toISOString();
    const job: ScriptJob = { id: randomUUID(), name: (input.name?.trim() || `Kịch bản ${new Date().toLocaleString('vi-VN')}`).slice(0, 120),
      model, keyId, prompt: input.prompt!, scripts, createdAt: now, updatedAt: now, revision: 0, status: 'running', total: scripts.length, completed: 0, failed: 0 };
    this.save(job); this.jobs.set(job.id, job); this.start(job);
    return structuredClone(job);
  }
  pause(id: unknown) {
    const job = this.get(id);
    if (job.status !== 'running') return structuredClone(job);
    job.status = 'paused';
    job.scripts.forEach(script => { if (script.status === 'processing') script.status = 'pending'; });
    delete job.currentId; delete job.retryAt; delete job.error;
    this.save(job);
    if (this.active?.id === job.id) this.active.controller.abort();
    return structuredClone(job);
  }
  resume(input: ScriptRequest) {
    const job = this.get(input.id);
    if (this.stopped) throw new AiError('Ứng dụng đang đóng', 409);
    if (this.active) throw new AiError('Một đợt đang xử lý hoặc đang dừng. Thử lại sau', 409);
    if (job.completed === job.total) return structuredClone(job);
    const { model, keyId } = this.config(input.model || job.model, input.keyId || job.keyId);
    job.model = model; job.keyId = keyId;
    for (const script of job.scripts) if (script.status !== 'completed') { script.status = 'pending'; script.attempts = 0; delete script.error; }
    job.status = 'running'; delete job.error; delete job.retryAt;
    this.save(job); this.start(job);
    return structuredClone(job);
  }
  delete(id: unknown) {
    const job = this.get(id);
    if (job.status === 'running' || this.active?.id === job.id) throw new AiError('Dừng xử lý trước khi xóa đợt này', 409);
    fs.unlinkSync(path.join(this.directory, `${job.id}.json`));
    this.jobs.delete(job.id);
    return this.snapshot();
  }
  private start(job: ScriptJob) {
    const run = { id: job.id, controller: new AbortController() };
    this.active = run;
    void this.process(job, run.controller.signal).catch(error => {
      if (run.controller.signal.aborted) return;
      job.status = 'paused'; job.error = error instanceof AiError ? error.message : 'Không thể lưu hoặc xử lý kịch bản. Kiểm tra dung lượng và thử lại';
      job.scripts.forEach(s => { if (s.status === 'processing') s.status = 'pending'; });
      delete job.currentId; delete job.retryAt;
      try { this.save(job); } catch { /* Preserve the previous atomic checkpoint. */ }
    }).finally(() => { if (this.active === run) this.active = undefined; });
  }
  private waitTime(error: AiError) {
    const seconds = Number(error.retryAfter);
    const date = error.retryAfter ? Date.parse(error.retryAfter) : NaN;
    const requested = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 0;
    return Math.max(error.status === 429 ? 30_000 : this.retryDelay, requested);
  }
  private async process(job: ScriptJob, signal: AbortSignal) {
    for (const script of job.scripts) {
      if (signal.aborted) return;
      if (script.status === 'completed') continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) return;
        script.status = 'processing'; script.attempts++; delete script.error;
        job.currentId = script.id; delete job.retryAt;
        this.save(job);
        try {
          const result = await this.getGateway().desktopChat(job.keyId, { model: job.model, messages: [{ role: 'user', content: scriptPrompt(job.prompt, script.content) }] }, signal);
          if (signal.aborted) return;
          const choice = result.choices?.[0];
          if (choice?.finish_reason === 'length') throw new AiError('Kết quả bị cắt do giới hạn model. Chọn model khác hoặc rút ngắn kịch bản', 422);
          const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
          if (!text.trim()) throw new AiError('Model không trả về nội dung văn bản', 502, 'upstream_error');
          if (Buffer.byteLength(text) + job.scripts.reduce((size, s) => size + Buffer.byteLength(s.result || ''), 0) > 32 * 1024 * 1024) throw new AiError('Kết quả đợt này vượt quá 32 MB. Xuất kết quả và chia thành đợt nhỏ hơn', 413);
          script.result = text; script.status = 'completed'; delete script.error;
          this.save(job); break;
        } catch (error) {
          if (signal.aborted) return;
          const failure = error instanceof AiError ? error : new AiError('Lỗi kết nối AI hoặc hết thời gian chờ', 502, 'upstream_error');
          script.error = failure.message; script.status = 'failed';
          if ([401, 403, 404].includes(failure.status) || (failure.status === 429 && attempt === 1)) {
            job.status = 'paused'; job.error = failure.status === 429 ? 'Antigravity đang giới hạn lượt gọi. Thử tiếp tục sau khi quota hồi phục' : failure.message;
            delete job.currentId; delete job.retryAt; this.save(job); return;
          }
          const retry = attempt === 0 && (failure.status === 429 || failure.status >= 500 || failure.status === 408);
          if (!retry) { this.save(job); break; }
          job.retryAt = new Date(Date.now() + this.waitTime(failure)).toISOString();
          this.save(job);
          await delay(Math.max(0, Date.parse(job.retryAt) - Date.now()), undefined, { signal });
        }
      }
    }
    if (signal.aborted) return;
    job.status = job.scripts.some(s => s.status === 'failed') ? 'failed' : 'completed';
    delete job.currentId; delete job.retryAt; this.save(job);
  }
  dispatch(input: ScriptRequest) {
    switch (input?.action) {
      case 'list': return this.snapshot();
      case 'parse': return { scripts: parseScripts(input.rawText, input.mode) };
      case 'create': return this.create(input);
      case 'get': return structuredClone(this.get(input.id));
      case 'pause': return this.pause(input.id);
      case 'resume': return this.resume(input);
      case 'delete': return this.delete(input.id);
      case 'export': {
        if (!['txt', 'doc'].includes(input.format || '')) throw new AiError('Định dạng xuất không hợp lệ');
        const job = this.get(input.id);
        return { filename: `converted_scripts_${job.id.slice(0, 8)}.${input.format}`, content: input.format === 'doc' ? exportScriptsDoc(job.scripts) : exportScriptsText(job.scripts),
          mime: input.format === 'doc' ? 'application/msword;charset=utf-8' : 'text/plain;charset=utf-8' };
      }
      default: throw new AiError('Thao tác Script Converter không hợp lệ');
    }
  }
  shutdown() { this.stopped = true; if (this.active) this.pause(this.active.id); }
}
