import { spawn } from 'node:child_process';
import { mediaEnvironment } from './media-runtime';
import { nativeSpeechCommand } from './native-architecture';

interface Command { executable: string; args: string[]; env?: NodeJS.ProcessEnv }

// PCM passes through Node's pipe() in bounded buffers with backpressure, never
// through Renderer IPC, JSON, or an intermediate WAV. Only text is collected.
export function runMoonshinePipeline(decoderCommand: Command, recognizerCommand: Command, signal: AbortSignal,
  onOutput: (text: string) => void, onDecoderOutput: (text: string) => void, timeout = 12 * 60 * 60_000): Promise<string> {
  if (signal.aborted) return Promise.reject(new Error('Đã hủy xử lý'));
  const decoderSpec = nativeSpeechCommand(decoderCommand.executable, decoderCommand.args);
  const recognizerSpec = nativeSpeechCommand(recognizerCommand.executable, recognizerCommand.args);
  return new Promise((resolve, reject) => {
    const env = mediaEnvironment();
    const recognizer = spawn(recognizerSpec.executable, recognizerSpec.args, { env: { ...env, ...recognizerCommand.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const decoder = spawn(decoderSpec.executable, decoderSpec.args, { env: { ...env, ...decoderCommand.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', decodeError = '', failure: Error | undefined, closed = 0, killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      decoder.stdout.unpipe(recognizer.stdin);
      recognizer.stdin.destroy();
      for (const child of [decoder, recognizer]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      if (!killTimer) {
        killTimer = setTimeout(() => {
          for (const child of [decoder, recognizer]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 3000);
        killTimer.unref();
      }
    };
    const fail = (error: Error) => { failure ||= error; stop(); };
    const timer = setTimeout(() => fail(new Error('Quá thời gian chạy Moonshine.')), timeout); timer.unref();
    signal.addEventListener('abort', stop, { once: true });
    const finish = () => {
      if (++closed < 2) return;
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(new Error('Đã hủy xử lý'));
      else if (failure) reject(new Error([failure.message, output.trim(), decodeError.trim()].filter(Boolean).join('\n').slice(-16_000)));
      else resolve(output);
    };
    recognizer.stdout.setEncoding('utf8'); recognizer.stderr.setEncoding('utf8'); decoder.stderr.setEncoding('utf8');
    recognizer.stdout.on('data', (text: string) => { output = (output + text).slice(-16_000); onOutput(text); });
    recognizer.stderr.on('data', (text: string) => { output = (output + text).slice(-16_000); });
    decoder.stderr.on('data', (text: string) => { decodeError = (decodeError + text).slice(-4000); onDecoderOutput(text); });
    recognizer.once('error', fail); decoder.once('error', fail);
    recognizer.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') fail(error); });
    decoder.stdout.on('error', fail);
    recognizer.once('close', code => { if (code !== 0 && !signal.aborted) fail(new Error(`Moonshine thoát với mã ${code}`)); finish(); });
    decoder.once('close', code => { if (code !== 0 && !signal.aborted) fail(new Error(`FFmpeg không giải mã được audio (mã ${code})`)); finish(); });
    decoder.stdout.pipe(recognizer.stdin);
    if (signal.aborted) stop();
  });
}
