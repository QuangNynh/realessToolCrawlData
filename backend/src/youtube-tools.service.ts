import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import Ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { exec as youtubeDlExec } from 'youtube-dl-exec';
import { executablePath } from './binary-paths';
import { youtubeVideoId } from './youtube-download-policy';
import { playableMp4 } from './video-file';
import type { MediaFile, MediaKind } from './youtube-download-queue';
import { getMediaJobs } from './media-instance';
import { createMediaProcessor, srtToScript } from './media-processor';

const execFileAsync = promisify(execFile);
const ffmpegPath: string = executablePath(require('@ffmpeg-installer/ffmpeg').path);
Ffmpeg.setFfmpegPath(ffmpegPath);
// Preserve native ESM loading in the CommonJS Electron backend.
const loadYoutube = new Function('return import("youtubei.js")') as () => Promise<any>;
const loadTranscript = new Function('return import("youtube-transcript-plus")') as () => Promise<any>;
const fetchTranscript = async (id: string, options: any) => (await loadTranscript()).fetchTranscript(id, options);

function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try { return await task(); }
    finally {
      const next = queue.shift();
      if (next) next(); else active--;
    }
  };
}

export class YouTubeToolsService {
  private youtube: any;
  private initialization?: Promise<void>;
  private async ready() {
    if (!this.initialization) {
      this.initialization = loadYoutube().then(async ({ Innertube }) => {
        this.youtube = await Innertube.create();
      }).catch(error => { this.initialization = undefined; throw error; });
    }
    await this.initialization;
  }

  private extractVideoId(value: string): string {
    return youtubeVideoId(value);
  }
  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---------------- METADATA BUILDER ---------------- */
  private buildMetadata(info: any, videoId: string) {
    return {
      videoId,
      title: info.basic_info.title,
      description: info.basic_info.short_description,
      author: info.basic_info.author,
      channelId: info.basic_info.channel_id,
      thumbnails: info.basic_info.thumbnail,
      durationSeconds: info.basic_info.duration,
      viewCount: Number(info.basic_info.view_count || 0),
      likeCount: Number(info.basic_info.like_count || 0),
      isLive: info.basic_info.is_live,
      category: info.basic_info.category,
      keywords: info.basic_info.keywords,
    };
  }

  /* ---------------- FETCH TRANSCRIPT SAFE ---------------- */
  private async fetchTranscriptWithFallback(
    videoId: string,
    preferredLang = 'en',
  ) {
    const langs = [preferredLang, 'en', undefined];
    let usedLang = preferredLang;

    for (const lang of langs) {
      try {
        const transcript = await fetchTranscript(videoId, lang ? { lang } : {});
        usedLang = lang || 'auto';
        return { transcript, usedLang };
      } catch (err: any) {

        if (!err.message?.includes('transcript')) {
          throw err;
        }
      }
    }

    return { transcript: null, usedLang: null };
  }

  /* ---------------- GET SINGLE TRANSCRIPT ---------------- */
  async getTranscript(videoId: string, preferredLang = 'en') {
    videoId = this.extractVideoId(videoId);
    const maxRetries = 10;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.ready();
        const info = await this.youtube.getInfo(videoId);
        const metadata = this.buildMetadata(info, videoId);

        const { transcript, usedLang } = await this.fetchTranscriptWithFallback(
          videoId,
          preferredLang,
        );

        return {
          success: !!transcript,
          videoId,
          transcript,
          transcriptLanguage: usedLang,
          metadata,
          attempts: attempt,
        };
      } catch (error: any) {

        lastError = error;

        // Check for rate limiting
        if (error?.response?.status === 429) {
          console.log('Rate limited. Retrying after 10s...');
          await this.sleep(10000);
          continue;
        }

        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    return {
      success: false,
      videoId,
      transcript: null,
      transcriptLanguage: null,
      metadata: null,

      error: lastError?.message || 'Unknown error',
      attempts: maxRetries,
    };
  }

  /* ---------------- METADATA ONLY ---------------- */
  async getAll(videoId: string) {
    try {
      const info = await this.youtube.getInfo(videoId);
      return {
        metadata: this.buildMetadata(info, videoId),
      };
    } catch (error: any) {
      throw new Error(
        `Error fetching video info: ${error.message}`,
      );
    }
  }

  /* ---------------- BATCH TRANSCRIPTS ---------------- */
  async getTranscripts(videoIds: string[], preferredLang = 'en') {
    const concurrency = 15; // số request chạy song song
    const limit = pLimit(concurrency);

    const tasks = videoIds.map((videoId) =>
      limit(() => this.getTranscript(videoId, preferredLang)),
    );

    const results = await Promise.all(tasks);

    return results;
  }
  private sanitizeFilename(filename: string): string {
    return (
      filename
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid characters
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Remove emoticons
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Remove symbols & pictographs
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Remove transport & map symbols
        .replace(/[\u{2600}-\u{26FF}]/gu, '') // Remove misc symbols
        .replace(/[\u{2700}-\u{27BF}]/gu, '') // Remove dingbats
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Remove supplemental symbols
        .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Remove extended symbols
        .replace(/[^\x20-\x7E]/g, '') // Keep only ASCII printable characters
        .trim()
        .substring(0, 200) || 'audio'
    ); // Limit length and provide fallback
  }

  async getChannelVideos(url: string) {
    try {
      // Bước 1: flatPlaylist:true → lấy danh sách video ID rất nhanh
      const ytDlOpts: any = {
        dumpSingleJson: true,
        flatPlaylist: true,
        ignoreConfig: true,
        noWarnings: true,
        socketTimeout: 30,
        retries: 3,
        extractorRetries: 1,
        sleepRequests: 0.75,
      };
      const result = await youtubeDlExec(url, ytDlOpts);

      if (!result) {
        throw new Error('No data returned from youtube-dl');
      }

      const parsed = JSON.parse(result.stdout);
      const rawEntries: any[] = [];
      const visit = (entry: any) => {
        if (Array.isArray(entry.entries)) entry.entries.forEach(visit);
        else if (entry.id) rawEntries.push(entry);
      };
      visit(parsed);
      // Flat channel entries already contain the fields used by the table.
      // Avoid one additional player request per video in a 1,000-item channel.
      const seen = new Set<string>();
      const validVideos = rawEntries.filter(entry => {
        if (!/^[\w-]{11}$/.test(entry.id) || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      }).map(entry => ({
        id: entry.id,
        title: entry.title ?? null,
        url: `https://www.youtube.com/watch?v=${entry.id}`,
        description: entry.description ?? null,
        duration: entry.duration ?? null,
        view_count: entry.view_count ?? null,
        like_count: entry.like_count ?? null,
        channel_id: entry.channel_id ?? parsed.channel_id ?? null,
        channel: entry.channel ?? entry.uploader ?? parsed.channel ?? null,
        thumbnails: entry.thumbnails ?? null,
        keywords: entry.tags ?? [],
        is_live: entry.live_status === 'is_live',
        category: entry.categories?.[0] ?? null,
        created_at: entry.timestamp || entry.release_timestamp
          ? new Date((entry.timestamp || entry.release_timestamp) * 1000).toISOString() : null,
      }));

      return {
        type: parsed.extractor_key ?? parsed._type ?? 'unknown',
        channelId: parsed.channel_id ?? parsed.uploader_id ?? null,
        channel: parsed.channel ?? parsed.uploader ?? null,
        channelUrl: parsed.channel_url ?? null,
        title: parsed.title ?? null,
        totalVideos: validVideos.length,
        videos: validVideos,
      };
    } catch (error: any) {
      throw new Error(
        `Error fetching channel videos: ${(error as Error).message}`,
      );
    }
  }

  /* ---------------- DOWNLOAD IMAGE ---------------- */
  async downloadImage(imageUrl: string, res: Response) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      let buffer: Buffer = Buffer.from(response.data);

      // Validate buffer is not empty
      if (buffer.length === 0) {
        throw new Error('Downloaded image is empty');
      }

      // Detect actual image type from buffer magic numbers
      let contentType = 'image/jpeg';
      let extension = 'jpg';
      let needsConversion = false;

      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        contentType = 'image/jpeg';
        extension = 'jpg';
      } else if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      ) {
        contentType = 'image/png';
        extension = 'png';
      } else if (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46
      ) {
        contentType = 'image/gif';
        extension = 'gif';
      } else if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46
      ) {
        // WebP detected - convert to JPG for Canva compatibility
        needsConversion = true;
        contentType = 'image/jpeg';
        extension = 'jpg';
      }

      // Convert WebP to JPG if needed
      if (needsConversion) {
        console.log('Converting WebP to JPG for Canva compatibility...');
        buffer = await sharp(buffer).jpeg({ quality: 95 }).toBuffer();
      }

      // Extract filename from URL
      const urlParts = imageUrl.split('/');
      const urlFilename = urlParts[urlParts.length - 1]
        .split('?')[0]
        .split('.')[0];
      const sanitizedFilename = this.sanitizeFilename(urlFilename || 'image');
      const filename = `${sanitizedFilename}.${extension}`;

      console.log(
        `Downloading image: ${filename}, size: ${buffer.length} bytes, type: ${contentType}`,
      );

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length.toString());
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.end(buffer);
    } catch (error: any) {
      console.error('Image download error:', error);
      throw new Error(
        `Error downloading image: ${error.message}`,
      );
    }
  }


  private async download(url: string, output: string, format: string, video = false, signal?: AbortSignal, progress?: (value: number) => void): Promise<string> {
    const options: any = {
      format, output, noPlaylist: true, noWarnings: true, ignoreConfig: true,
      ffmpegLocation: ffmpegPath,
      jsRuntimes: `node:${process.execPath}`,
      continue: true, part: true, socketTimeout: 30,
      retries: 3, fragmentRetries: 3, extractorRetries: 1, fileAccessRetries: 2,
      retrySleep: ['http:exp=2:15', 'fragment:exp=2:15', 'extractor:5'],
      sleepRequests: 0.75, concurrentFragments: 2,
      abortOnUnavailableFragments: true,
      matchFilters: '!is_live',
      newline: true, progress: true, progressDelta: 1,
      progressTemplate: 'download:LENYT_PROGRESS=%(progress._percent_str)s',
      print: ['after_move:LENYT_TITLE=%(title)j', 'after_move:LENYT_FILE=%(filepath)j'],
      ...(video ? { mergeOutputFormat: 'mp4' } : {}),
    };
    const child = youtubeDlExec(`https://www.youtube.com/watch?v=${this.extractVideoId(url)}`, options, {
      signal,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    });
    let pending = '';
    child.stdout?.on('data', (data: Buffer) => {
      pending += data.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const percentage = line.match(/LENYT_PROGRESS=\s*([\d.]+)%/);
        if (percentage) progress?.(Number(percentage[1]));
      }
    });
    try {
      const result = await child;
      return result.stdout || '';
    } catch (error: any) {
      // tinyspawn's message contains the command, whereas stderr contains the
      // actual YouTube failure needed by the shared retry policy.
      if (error.stderr) error.message = error.stderr;
      throw error;
    }
  }

  async prepareMedia(url: string, kind: MediaKind, directory: string, quality = '1080p', signal?: AbortSignal, progress?: (value: number) => void): Promise<MediaFile> {
    const heights: Record<string, number> = { '2160p': 2160, '4k': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360, '240p': 240, '144p': 144 };
    const height = heights[quality] || 1080;
    const format = kind === 'audio' ? 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio'
      : `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
    const output = await this.download(url, path.join(directory, 'media.%(ext)s'), format, kind === 'video', signal, progress);
    const encodedPath = output.match(/^LENYT_FILE=(.*)$/m)?.[1];
    if (!encodedPath) throw new Error('Không tìm thấy file media đã tải');
    const raw = JSON.parse(encodedPath);
    if (typeof raw !== 'string' || path.dirname(path.resolve(raw)) !== path.resolve(directory)) throw new Error('Đường dẫn file tải không hợp lệ');
    if (!fs.statSync(raw).size) throw new Error('File tải về rỗng');
    let file = raw;
    if (kind === 'video') {
      file = await playableMp4(raw, path.join(directory, 'video.mp4'), ffmpegPath, signal);
    } else {
      const inspection = await execFileAsync(ffmpegPath, ['-hide_banner', '-nostdin', '-i', raw, '-map', '0:a:0', '-t', '1', '-f', 'null', '-'], {
        signal, timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true,
      });
      if (!/Audio:/.test(inspection.stderr)) throw new Error('File tải về không có audio hợp lệ');
    }
    return { file, title: this.titleFromDownload(output, this.extractVideoId(url)), extension: path.extname(file).slice(1) };
  }

  private titleFromDownload(output: string, fallback: string) {
    const json = output.match(/^LENYT_TITLE=(.*)$/m)?.[1];
    if (json) {
      try {
        const title = JSON.parse(json);
        if (typeof title === 'string') return this.sanitizeFilename(title);
      } catch { /* yt-dlp did not return a JSON title. */ }
    }
    return fallback;
  }

  private async title(url: string) {
    try {
      await this.ready();
      const info = await this.youtube.getBasicInfo(this.extractVideoId(url));
      return this.sanitizeFilename(info.basic_info.title || 'video');
    } catch { return 'video'; }
  }

  private sendFile(file: string, filename: string, type: string, res: Response, directory: string) {
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', fs.statSync(file).size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    const stream = fs.createReadStream(file);
    const cleanup = () => { stream.destroy(); fs.rmSync(directory, { recursive: true, force: true }); };
    res.once('close', cleanup);
    stream.once('error', error => res.destroy(error));
    stream.pipe(res);
  }

  async streamAudio(url: string, res: Response) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-audio-'));
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    try {
      const { file, title, extension } = await this.prepareMedia(url, 'audio', directory, undefined, controller.signal);
      // Keep the original codec/container when AAC is unavailable; do not reduce audio quality.
      const types: Record<string, string> = { m4a: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg' };
      this.sendFile(file, `${title}.${extension}`, types[extension] || 'application/octet-stream', res, directory);
    } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  }

  async streamVideo(url: string, res: Response, quality = '1080p') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-video-'));
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    try {
      const { file, title } = await this.prepareMedia(url, 'video', directory, quality, controller.signal);
      this.sendFile(file, `${title}.mp4`, 'video/mp4', res, directory);
    } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  }

  async downloadAudioYoutubei(url: string, res: Response, format: 'mp3' | 'm4a' = 'mp3') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-youtubei-'));
    try {
      await this.ready();
      const id = this.extractVideoId(url);
      const title = await this.title(url);
      const webStream = await this.youtube.download(id, { type: 'audio', quality: 'best' });
      const raw = path.join(directory, 'raw');
      await pipeline(Readable.fromWeb(webStream as any), fs.createWriteStream(raw));
      const output = path.join(directory, `audio.${format}`);
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(raw).noVideo().audioCodec(format === 'mp3' ? 'libmp3lame' : 'aac')
          .save(output).on('end', () => resolve()).on('error', reject);
      });
      this.sendFile(output, `${title}.${format}`, format === 'mp3' ? 'audio/mpeg' : 'audio/mp4', res, directory);
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      if (!res.headersSent) return this.streamAudio(url, res);
      throw error;
    }
  }

  async audioToSrt(audioPath: string, signal = new AbortController().signal): Promise<string> {
    let result: Awaited<ReturnType<ReturnType<typeof createMediaProcessor>>> | undefined;
    try {
      result = await createMediaProcessor(getMediaJobs().runtime)(audioPath, {
        id: 'uploaded-audio', tool: 'srt', createdAt: new Date().toISOString(), directory: os.tmpdir(), paused: false, items: [],
        options: { model: 'base', language: 'auto', format: 'mp3', bitrate: '320' },
      }, { id: 'uploaded-audio', name: 'audio', bytes: 0, status: 'running' }, signal, () => {});
      return fs.readFileSync(result.path, 'utf8');
    } finally {
      result?.cleanup();
      fs.rmSync(audioPath, { force: true });
    }
  }

  srtToScript(content: string): string {
    return srtToScript(content);
  }

}

export const youtubeToolsService = new YouTubeToolsService();
