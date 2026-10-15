import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MediaJob, MediaItem } from './media-types';
import { mediaFfmpeg, runMediaProcess, WhisperRuntime } from './media-runtime';
import { MoonshineRuntime } from './moonshine-runtime';
import { moonshineTranscribe } from './moonshine-transcribe';
import { runMoonshinePipeline } from './moonshine-pipeline';
import { formatSrtTiming } from './subtitle-timing';

export interface ProcessedMedia { path: string; extension: string; cleanup: () => void }
export type MediaProcessor = (input: string, job: MediaJob, item: MediaItem, signal: AbortSignal, update: (stage: string, progress?: number) => void) => Promise<ProcessedMedia>;
export function srtToScript(content: string) {
  return content.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/)
    .map(block => {
      const lines = block.split('\n');
      const timestamp = /^\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/;
      if (/^\d+$/.test(lines[0]?.trim()) && timestamp.test(lines[1] || '')) lines.shift();
      if (timestamp.test(lines[0] || '')) lines.shift();
      return lines.join(' ').trim();
    })
    .filter(Boolean).join('\n\n');
}
export function validSrt(content: string) {
  return /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(content) && srtToScript(content).length > 0;
}
export function createMediaProcessor(runtime: WhisperRuntime, moonshine?: MoonshineRuntime): MediaProcessor {
  return async (input, job, _item, signal, update) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-media-'));
    const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
    try {
      if (job.tool === 'extract') {
        const codec = { mp3: 'libmp3lame', wav: 'pcm_s16le', aac: 'aac', flac: 'flac', ogg: 'libvorbis' }[job.options.format];
        const output = path.join(directory, 'audio.' + job.options.format);
        update('Đang tách audio');
        let duration = 0, tail = '';
        await runMediaProcess(mediaFfmpeg, ['-nostdin', '-hide_banner', '-i', input, '-map', '0:a:0', '-vn', '-c:a', codec,
          ...(job.options.format === 'wav' || job.options.format === 'flac' ? [] : ['-b:a', `${job.options.bitrate}k`]), '-progress', 'pipe:1', '-y', output], signal, text => {
          tail = (tail + text).slice(-4096);
          const d = tail.match(/Duration: (\d+):(\d+):([\d.]+)/);
          if (d) duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
          const times = [...tail.matchAll(/out_time_us=(\d+)/g)];
          if (duration && times.length) update('Đang tách audio', Math.min(99, +times[times.length - 1][1] / 1e6 / duration * 100));
        });
        if (!fs.existsSync(output) || fs.statSync(output).size < 32) throw new Error('Video không có audio hoặc kết quả rỗng');
        return { path: output, extension: job.options.format, cleanup };
      }
      const engine = job.options.engine || 'whisper';
      const recognizer = engine === 'moonshine' ? moonshine : runtime;
      if (!recognizer) throw new Error('Moonshine chưa được cấu hình');
      const executable = await recognizer.executable();
      const output = path.join(directory, 'audio.srt');
      let audioDuration: number | undefined;
      if (engine === 'moonshine') {
        update('Moonshine đang chuẩn bị model (lần đầu cần tải)');
        const started = performance.now();
        let pending = '', decoderText = '', duration = 0;
        let metrics: Record<string, unknown> | undefined;
        const requestedProvider = (process.env.LENYT_MOONSHINE_PROVIDER || 'cpu').toLowerCase();
        let retriedOnCpu = false;
        const transcribe = (provider: string) => runMoonshinePipeline({ executable: mediaFfmpeg, args: ['-nostdin', '-hide_banner', '-nostats', '-i', input,
          '-map', '0:a:0', '-vn', '-sn', '-dn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'] },
        { executable, args: ['-X', 'utf8', '-c', moonshineTranscribe, output, recognizer.modelDirectory(), job.options.language, job.options.model], env: { LENYT_MOONSHINE_PROVIDER: provider } }, signal, text => {
          pending = (pending + text).slice(-16_000);
          const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('LENYT_MOONSHINE_METRICS=')) {
              try { metrics = JSON.parse(line.slice('LENYT_MOONSHINE_METRICS='.length)); } catch { /* Ignore incomplete diagnostic output. */ }
              continue;
            }
            if (!line.startsWith('LENYT_MOONSHINE=')) continue;
            try {
              const progress = JSON.parse(line.slice('LENYT_MOONSHINE='.length));
              if (progress.stage === 'download' && Number.isFinite(progress.progress)) update('Moonshine đang tải model', Math.max(0, Math.min(99, progress.progress)));
              else if (progress.stage === 'backend') update(progress.fallback ? 'CoreML không khởi tạo được · đang dùng CPU' : `Moonshine đang khởi tạo · ${progress.provider === 'CoreML,CPU' ? 'CoreML + CPU' : 'CPU'}`);
              else if (progress.stage === 'transcribe' && Number.isFinite(progress.seconds)) {
                update(`Moonshine đang nhận dạng · đã xử lý ${Math.floor(progress.seconds / 60)}:${String(Math.floor(progress.seconds % 60)).padStart(2, '0')}`, duration > 0 ? Math.max(0, Math.min(99, progress.seconds / duration * 100)) : undefined);
              }
            } catch { /* Native SDK logs are separate from progress records. */ }
          }
        }, text => {
          decoderText = (decoderText + text).slice(-4096);
          const match = decoderText.match(/Duration: (\d+):(\d+):([\d.]+)/);
          if (match) duration = +match[1] * 3600 + +match[2] * 60 + +match[3];
        });
        try { await transcribe(requestedProvider); }
        catch (error) {
          if (requestedProvider !== 'coreml' || signal.aborted) throw error;
          // CoreML can load successfully then reject the decoder's zero-length
          // initial KV cache during inference. Replay the original file once
          // on CPU; each attempt has its own bounded pipe and writes a fresh SRT.
          retriedOnCpu = true; metrics = undefined; pending = '';
          update('CoreML không chạy được model này · đang thử lại bằng CPU');
          await transcribe('cpu');
        }
        // No file paths or transcript text: separate cold model setup from
        // steady-state throughput when diagnosing long recordings.
        if (metrics) console.info('[Moonshine performance]', JSON.stringify({ ...metrics, requestedProvider, backendFallback: retriedOnCpu || metrics.backendFallback === true, pipelineSeconds: +(Math.max(0, performance.now() - started) / 1000).toFixed(3) }));
        if (metrics && typeof metrics.audioSeconds === 'number') audioDuration = metrics.audioSeconds;
      } else {
        const wav = path.join(directory, 'audio.wav');
        update('Chuẩn hóa audio 16 kHz');
        let decodeProgress = '';
        await runMediaProcess(mediaFfmpeg, ['-nostdin', '-hide_banner', '-i', input, '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-y', wav], signal, text => {
          decodeProgress = (decodeProgress + text).slice(-4096);
          const times = [...decodeProgress.matchAll(/out_time_us=(\d+)/g)];
          if (times.length) audioDuration = +times[times.length - 1][1] / 1e6;
        });
        update('Whisper đang nhận dạng (lần đầu có thể tải model)');
        await runMediaProcess(executable, [wav, '--model', job.options.model, '--model_dir', runtime.modelDirectory(), '--output_format', 'srt', '--output_dir', directory,
          '--fp16', 'False', '--device', 'cpu', '--threads', String(Math.min(4, os.cpus().length)), '--verbose', 'False', '--task', 'transcribe',
          ...(job.options.language === 'auto' ? [] : ['--language', job.options.language])], signal, text => {
          const matches = [...text.matchAll(/(\d+)%\|/g)];
          if (matches.length) update('Whisper đang nhận dạng', Math.min(99, +matches[matches.length - 1][1]));
        });
      }
      if (!fs.existsSync(output) || fs.statSync(output).size > 8 * 1024 * 1024) throw new Error('Không có phụ đề hợp lệ hoặc kết quả vượt 8 MB');
      const content = fs.readFileSync(output, 'utf8');
      if (!validSrt(content)) throw new Error('Không nhận dạng được lời nói trong file này');
      if (job.tool === 'script') {
        const script = path.join(directory, 'audio.txt');
        fs.writeFileSync(script, srtToScript(content), 'utf8');
        return { path: script, extension: 'txt', cleanup };
      }
      const formatted = formatSrtTiming(content, job.options.srtTiming || 'original', audioDuration, job.options.srtGapMs ?? 10);
      if (Buffer.byteLength(formatted, 'utf8') > 8 * 1024 * 1024) throw new Error('Phụ đề sau định dạng vượt 8 MB');
      if (formatted !== content) fs.writeFileSync(output, formatted, 'utf8');
      return { path: output, extension: 'srt', cleanup };
    } catch (error) { cleanup(); throw error; }
  };
}
