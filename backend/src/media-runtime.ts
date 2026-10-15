import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ffmpegBinaryPath } from './binary-paths';
import type { MediaRuntimeStatus } from './media-types';

export const mediaFfmpeg = ffmpegBinaryPath();
export const mediaEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  const pathKeys = Object.keys(env).filter(key => key.toUpperCase() === 'PATH');
  const currentPath = env.PATH || pathKeys.map(key => env[key]).find(Boolean) || '';
  // Windows environment keys are case insensitive. Send only one PATH so Node
  // cannot pick an inherited Path that omits the bundled FFmpeg directory.
  if (process.platform === 'win32') pathKeys.forEach(key => { delete env[key]; });
  return {
    ...env,
    // Whisper's --help includes non-Latin language names. Electron uses pipes,
    // where Windows Python otherwise falls back to a legacy code page (cp1252).
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    PATH: [path.dirname(mediaFfmpeg), ...(process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin']), currentPath].filter(Boolean).join(path.delimiter),
  };
};
// Argument arrays only: file names never become shell commands.
export function runMediaProcess(executable: string, args: string[], signal: AbortSignal, onOutput?: (text: string) => void, timeout = 12 * 60 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Đã hủy xử lý'));
    const child = spawn(executable, args, { env: mediaEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', timedOut = false, forceKill: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { child.kill('SIGTERM'); forceKill = setTimeout(() => child.kill('SIGKILL'), 3000); forceKill.unref(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout); timer.unref();
    signal.addEventListener('abort', stop, { once: true });
    const receive = (text: string) => { tail = (tail + text).slice(-16_000); onOutput?.(text); };
    // Decode each stream incrementally: a UTF-8 character may cross chunks.
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    const cleanup = () => { clearTimeout(timer); if (forceKill) clearTimeout(forceKill); signal.removeEventListener('abort', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      cleanup();
      if (signal.aborted) reject(new Error('Đã hủy xử lý'));
      else if (timedOut) reject(new Error(`Quá thời gian chạy ${path.basename(executable)}. ${tail.trim()}`.trim()));
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
    const candidates = [process.env.WHISPER_PATH, this.bin('whisper'), ...(process.platform === 'win32' ? [] : ['/opt/homebrew/bin/whisper', '/usr/local/bin/whisper']), 'whisper'].filter(Boolean) as string[];
    let reason = 'Chưa có Whisper. Bấm Cài / sửa Whisper để cài môi trường riêng (khuyến nghị Python 3.11 64-bit, cần internet).';
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
    this.state = { ready: false, checking: false, installing: true, message: 'Đang tìm Python 3…' };
    await prepareSpeechPython(this.directory, signal, stage => { this.state.message = stage; });
    this.state.message = 'Đang tải Whisper và PyTorch. Lần đầu có thể mất vài phút và dùng hơn 1 GB dung lượng…';
    await runMediaProcess(this.bin('python'), ['-X', 'utf8', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--use-deprecated=legacy-certs', '--no-input', 'openai-whisper==20250625'], signal, undefined, 30 * 60 * 1000);
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

export function pythonEnvironmentBinary(directory: string) {
  return path.join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

class PythonEnvironment {
  private async findPython(signal: AbortSignal, name: string) {
    const candidates: { command: string; args: string[] }[] = [];
    const add = (command: string | undefined, args: string[] = []) => { if (command) candidates.push({ command, args }); };
    add(process.env.PYTHON_PATH);
    if (process.platform === 'win32') {
      add('py', ['-3.11']);
      if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python311', 'python.exe'));
      if (process.env.ProgramFiles) add(path.join(process.env.ProgramFiles, 'Python311', 'python.exe'));
    } else {
      add('/opt/homebrew/opt/python@3.11/bin/python3.11');
      add('/usr/local/opt/python@3.11/bin/python3.11');
      add('/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11');
    }
    add('python3.11');
    if (process.platform === 'win32') add('py', ['-3']);
    else { add('/opt/homebrew/bin/python3'); add('/usr/local/bin/python3'); }
    add('python3'); add('python');
    // Python.org installations need not have been added to PATH on Windows.
    if (process.platform === 'win32') {
      for (const version of ['313', '312', '310', '39']) {
        if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', `Python${version}`, 'python.exe'));
        if (process.env.ProgramFiles) add(path.join(process.env.ProgramFiles, `Python${version}`, 'python.exe'));
      }
    }
    for (const { command, args } of candidates) {
      if (signal.aborted) throw new Error('Đã hủy cài đặt');
      if (path.isAbsolute(command) && !fs.existsSync(command)) continue;
      try {
        const output = await runMediaProcess(command, [...args, '-X', 'utf8', '-c',
          'import sys, struct, venv, platform; assert sys.version_info >= (3, 9); assert struct.calcsize("P") == 8; '
          + (process.platform === 'darwin' && process.arch === 'arm64' ? 'assert platform.machine() == "arm64", "Python must be arm64, not Rosetta"; ' : '')
          + 'print("LENYT_PYTHON=" + sys.executable)'], signal, undefined, 10_000);
        const executable = output.match(/^LENYT_PYTHON=(.+)$/m)?.[1].trim();
        if (executable) return executable;
      } catch { if (signal.aborted) throw new Error('Đã hủy cài đặt'); }
    }
    throw new Error(process.platform === 'win32'
      ? `Không tìm thấy Python 3 64-bit có venv. Hãy cài Python 3.11 64-bit từ python.org (kèm pip và Python Launcher), mở lại app rồi bấm Cài / sửa ${name}.`
      : `Không tìm thấy Python 3 ${process.arch === 'arm64' ? 'arm64 native (không dùng Rosetta)' : '64-bit'} có venv. Hãy cài Python 3.11 từ python.org hoặc Homebrew (brew install python@3.11), mở lại app rồi bấm Cài / sửa ${name}.`);
  }
  async preparePython(directory: string, signal: AbortSignal, onStage: (stage: string) => void, name: string) {
    const python = await this.findPython(signal, name);
    const target = pythonEnvironmentBinary(directory);
    onStage('Đang tạo môi trường Python riêng…');
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    await runMediaProcess(python, ['-X', 'utf8', '-m', 'venv', '--clear', '--without-pip', directory], signal, undefined, 120_000);
    onStage('Đang chuẩn bị pip trong môi trường riêng…');
    try {
      await runMediaProcess(target, ['-X', 'utf8', '-m', 'ensurepip', '--upgrade'], signal, undefined, 120_000);
    } catch {
      if (signal.aborted) throw new Error('Đã hủy cài đặt');
      // Homebrew fallback; the host pip installs into the target venv only.
      await runMediaProcess(python, ['-X', 'utf8', '-m', 'pip', '--python', target, 'install', '--disable-pip-version-check', '--no-cache-dir', '--use-deprecated=legacy-certs', '--no-input', 'pip'], signal, undefined, 120_000);
    }
    await runMediaProcess(target, ['-X', 'utf8', '-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', '--no-cache-dir', '--use-deprecated=legacy-certs', '--no-input', 'pip'], signal, undefined, 120_000);
    return target;
  }
}

export const prepareSpeechPython = (directory: string, signal: AbortSignal, onStage: (stage: string) => void, name = 'Whisper') => new PythonEnvironment().preparePython(directory, signal, onStage, name);
