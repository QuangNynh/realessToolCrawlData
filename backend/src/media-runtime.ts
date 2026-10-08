import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { executablePath } from './binary-paths';
import type { MediaRuntimeStatus } from './media-types';

export const mediaFfmpeg = executablePath(require('@ffmpeg-installer/ffmpeg').path) as string;
export const mediaEnvironment = () => ({ ...process.env, PYTHONUNBUFFERED: '1', PATH: [path.dirname(mediaFfmpeg), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(path.delimiter) });
// Argument arrays only: file names never become shell commands.
export function runMediaProcess(executable: string, args: string[], signal: AbortSignal, onOutput?: (text: string) => void, timeout = 12 * 60 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Đã hủy xử lý'));
    const child = spawn(executable, args, { env: mediaEnvironment(), windowsHide: true });
    let tail = '', forceKill: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { child.kill('SIGTERM'); forceKill = setTimeout(() => child.kill('SIGKILL'), 3000); forceKill.unref(); };
    const timer = setTimeout(stop, timeout); timer.unref();
    signal.addEventListener('abort', stop, { once: true });
    const receive = (chunk: Buffer) => { const text = chunk.toString(); tail = (tail + text).slice(-16_000); onOutput?.(text); };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    const cleanup = () => { clearTimeout(timer); if (forceKill) clearTimeout(forceKill); signal.removeEventListener('abort', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      cleanup();
      if (signal.aborted) reject(new Error('Đã hủy xử lý'));
      else if (code !== 0) reject(new Error(tail.trim() || `Không thể chạy ${path.basename(executable)} (mã ${code})`));
      else resolve(tail);
    });
  });
}

export class WhisperRuntime {
  private state: MediaRuntimeStatus = { ready: false, checking: false, installing: false, message: 'Đang kiểm tra Whisper…' };
  private check?: Promise<void>;
  private controller?: AbortController;
  constructor(readonly directory: string) {}
  private bin(name: string) { return path.join(this.directory, process.platform === 'win32' ? 'Scripts' : 'bin', name + (process.platform === 'win32' ? '.exe' : '')); }
  status() { return { ...this.state }; }
  async refresh() {
    if (this.state.installing) return;
    if (!this.check) this.check = this.discover().finally(() => { this.check = undefined; });
    await this.check;
  }
  private async discover() {
    this.state.checking = true;
    const candidates = [process.env.WHISPER_PATH, this.bin('whisper'), process.platform === 'darwin' ? '/opt/homebrew/bin/whisper' : undefined, '/usr/local/bin/whisper', 'whisper'].filter(Boolean) as string[];
    let reason = 'Chưa có Whisper. Bấm Cài / sửa Whisper để cài môi trường riêng (cần Python 3 và internet).';
    for (const command of new Set(candidates)) {
      if (path.isAbsolute(command) && !fs.existsSync(command)) continue;
      try {
        await runMediaProcess(command, ['--help'], AbortSignal.timeout(25_000), undefined, 25_000);
        this.state = { ready: true, checking: false, installing: false, message: 'Whisper sẵn sàng · nhận dạng giọng nói trên máy', executable: command };
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reason = 'Whisper hiện có không chạy được. Bấm Cài / sửa Whisper để tạo môi trường riêng.';
      }
    }
    this.state = { ready: false, checking: false, installing: false, message: reason };
  }
  async executable() {
    if (!this.state.ready) await this.refresh();
    if (!this.state.ready || !this.state.executable) throw new Error(this.state.message);
    return this.state.executable;
  }
  install() {
    if (this.state.installing) return this.status();
    this.controller = new AbortController();
    this.state = { ready: false, checking: false, installing: true, message: 'Đang tìm Python 3…' };
    void this.setup(this.controller.signal).catch(error => {
      this.state = { ready: false, checking: false, installing: false, message: `Cài Whisper thất bại: ${(error instanceof Error ? error.message : String(error)).slice(-1200)}` };
    });
    return this.status();
  }
  private async setup(signal: AbortSignal) {
    await this.check;
    this.state = { ready: false, checking: false, installing: true, message: 'Đang tạo môi trường Python riêng…' };
    let python = '';
    for (const candidate of [process.env.PYTHON_PATH, '/opt/homebrew/opt/python@3.11/bin/python3.11', '/usr/local/opt/python@3.11/bin/python3.11', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3.11', 'python3', 'python'].filter(Boolean) as string[]) {
      try {
        await runMediaProcess(candidate, ['-c', 'import sys, platform, venv; assert sys.version_info >= (3, 9); assert platform.system() != "Darwin" or platform.mac_ver()[0]; print(sys.version)'], signal, undefined, 10_000);
        python = candidate; break;
      } catch { if (signal.aborted) throw new Error('Đã hủy cài đặt'); }
    }
    if (!python) throw new Error('Không tìm thấy Python 3. Hãy cài Python 3 rồi thử lại.');
    fs.mkdirSync(path.dirname(this.directory), { recursive: true });
    await runMediaProcess(python, ['-m', 'venv', '--clear', '--without-pip', this.directory], signal, undefined, 120_000);
    // Bootstrap with the host pip: some Homebrew Python builds cannot run ensurepip's truststore.
    // legacy-certs still verifies TLS with pip's bundled CA certificates.
    await runMediaProcess(python, ['-m', 'pip', '--python', this.bin('python'), 'install', '--disable-pip-version-check', '--no-cache-dir', '--use-deprecated=legacy-certs', 'pip'], signal, undefined, 120_000);
    this.state.message = 'Đang tải Whisper và PyTorch. Lần đầu có thể mất vài phút và dùng hơn 1 GB dung lượng…';
    await runMediaProcess(this.bin('python'), ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--use-deprecated=legacy-certs', 'openai-whisper==20250625'], signal, undefined, 30 * 60 * 1000);
    await runMediaProcess(this.bin('whisper'), ['--help'], signal, undefined, 90_000);
    this.state = { ready: true, checking: false, installing: false, message: 'Whisper sẵn sàng · môi trường riêng đã cài', executable: this.bin('whisper') };
  }
  modelDirectory() {
    // Reuse existing official model weights without duplicating hundreds of MB.
    const existing = path.join(os.homedir(), '.cache', 'whisper');
    return fs.existsSync(existing) ? existing : path.join(this.directory, 'models');
  }
  shutdown() { this.controller?.abort(); }
}
