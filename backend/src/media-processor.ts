import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MediaJob, MediaItem } from './media-types';
import { mediaFfmpeg, runMediaProcess, WhisperRuntime } from './media-runtime';

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
export function createMediaProcessor(runtime: WhisperRuntime): MediaProcessor {
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
      const whisper = await runtime.executable();
      const wav = path.join(directory, 'audio.wav');
      update('Chuẩn hóa audio 16 kHz');
      await runMediaProcess(mediaFfmpeg, ['-nostdin', '-hide_banner', '-i', input, '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', '-y', wav], signal);
      update('Whisper đang nhận dạng (lần đầu có thể tải model)');
      await runMediaProcess(whisper, [wav, '--model', job.options.model, '--model_dir', runtime.modelDirectory(), '--output_format', 'srt', '--output_dir', directory,
        '--fp16', 'False', '--device', 'cpu', '--threads', String(Math.min(4, os.cpus().length)), '--verbose', 'False', '--task', 'transcribe',
        ...(job.options.language === 'auto' ? [] : ['--language', job.options.language])], signal, text => {
          const matches = [...text.matchAll(/(\d+)%\|/g)];
          if (matches.length) update('Whisper đang nhận dạng', Math.min(99, +matches[matches.length - 1][1]));
        });
      const output = path.join(directory, 'audio.srt');
      if (!fs.existsSync(output) || fs.statSync(output).size > 8 * 1024 * 1024) throw new Error('Không có phụ đề hợp lệ hoặc kết quả vượt 8 MB');
      const content = fs.readFileSync(output, 'utf8');
      if (!validSrt(content)) throw new Error('Không nhận dạng được lời nói trong file này');
      if (job.tool === 'script') {
        const script = path.join(directory, 'audio.txt');
        fs.writeFileSync(script, srtToScript(content), 'utf8');
        return { path: script, extension: 'txt', cleanup };
      }
      return { path: output, extension: 'srt', cleanup };
    } catch (error) { cleanup(); throw error; }
  };
}
