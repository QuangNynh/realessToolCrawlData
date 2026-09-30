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
    if (/^[\w-]{11}$/.test(value.trim())) return value.trim();
    try {
      const url = new URL(value);
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').pop();
      if (id && /^[\w-]{11}$/.test(id)) return id;
    } catch {}
    throw new Error('Video ID hoặc URL YouTube không hợp lệ');
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

  async getChannelVideos(url: string, concurrency = 10) {
    try {
      // Bước 1: flatPlaylist:true → lấy danh sách video ID rất nhanh
      const ytDlOpts: any = {
        dumpSingleJson: true,
        flatPlaylist: true,
        ignoreConfig: true,
        noWarnings: true,
        noCheckCertificates: true,
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
      await this.ready();

      // Bước 2: batch-fetch full metadata song song qua youtubei.js
      const limit = pLimit(concurrency);

      const videos = await Promise.all(
        rawEntries.map((entry: any) =>
          limit(async () => {
            const id: string = entry.id ?? entry.url?.split('v=')[1]?.split('&')[0];
            if (!id) return null;

            try {
              const info = await this.youtube.getInfo(id);
              const b = info.basic_info;
              const createdAt = b.start_timestamp
                ? new Date(b.start_timestamp).toISOString()
                : ((info as any).primary_info?.published?.toString() ||
                   (info as any).primary_info?.published?.text ||
                   null);

              return {
                id,
                title: b.title ?? entry.title ?? null,
                url: `https://www.youtube.com/watch?v=${id}`,
                description: b.short_description ?? null,
                duration: b.duration ?? null,
                view_count: Number(b.view_count ?? 0),
                like_count: Number(b.like_count ?? 0),
                channel_id: b.channel_id ?? null,
                channel: b.author ?? null,
                thumbnails: b.thumbnail ?? null,
                keywords: b.keywords ?? [],
                is_live: b.is_live ?? false,
                category: b.category ?? null,
                created_at: createdAt,
              };
            } catch {
              // Nếu video bị ẩn/lỗi thì trả về thông tin cơ bản từ flatPlaylist
              return {
                id,
                title: entry.title ?? null,
                url: `https://www.youtube.com/watch?v=${id}`,
                description: null,
                duration: entry.duration ?? null,
                view_count: null,
                like_count: null,
                channel_id: null,
                channel: entry.uploader ?? null,
                thumbnails: null,
                keywords: [],
                is_live: false,
                category: null,
                created_at: null,
              };
            }
          }),
        ),
      );


      const validVideos = videos.filter(Boolean);

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


  private async download(url: string, output: string, format: string, video = false): Promise<string> {
    let lastError: unknown;
    for (const client of video ? ['', 'web,web_embedded', 'mweb'] : ['', 'ios', 'mweb', 'web,web_embedded']) {
      try {
        const options: any = {
          format, output, noPlaylist: true, noWarnings: true, ignoreConfig: true,
          ffmpegLocation: ffmpegPath,
          print: video ? [
            'after_move:LENYT_TITLE=%(title)j',
            'after_move:LENYT_CODECS=%(vcodec)s|%(acodec)s',
          ] : 'after_move:LENYT_TITLE=%(title)j',
          ...(video ? {
            mergeOutputFormat: 'mp4',
            concurrentFragments: Math.min(16, Math.max(4, os.availableParallelism())),
          } : {}),
          ...(client ? { extractorArgs: `youtube:player_client=${client}` } : {}),
        };
        const result = await youtubeDlExec(url, options);
        return result.stdout || '';
      } catch (error) { lastError = error; }
    }
    throw lastError;
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
    try {
      const downloadOutput = await this.download(url, path.join(directory, 'audio.%(ext)s'), 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio');
      const title = this.titleFromDownload(downloadOutput, 'audio');
      const name = fs.readdirSync(directory).find(name => !name.endsWith('.part') && !name.endsWith('.ytdl'));
      if (!name) throw new Error('Không tìm thấy file audio đã tải');
      const extension = path.extname(name).slice(1);
      // Keep the original codec/container when AAC is unavailable; do not reduce audio quality.
      const types: Record<string, string> = { m4a: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg' };
      this.sendFile(path.join(directory, name), `${title}.${extension}`, types[extension] || 'application/octet-stream', res, directory);
    } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  }

  async streamVideo(url: string, res: Response, quality = '1080p') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-video-'));
    try {
      const heights: Record<string, number> = { '2160p': 2160, '4k': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360, '240p': 240, '144p': 144 };
      const height = heights[quality];
      const format = height ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]` : 'bestvideo+bestaudio/best';
      const raw = path.join(directory, 'raw.mp4');
      const output = path.join(directory, 'video.mp4');
      const downloadOutput = await this.download(url, raw, format, true);
      const title = this.titleFromDownload(downloadOutput, 'video');
      if (/LENYT_CODECS=avc1[^|\r\n]*\|mp4a[^\r\n]*/.test(downloadOutput)) {
        this.sendFile(raw, `${title}.mp4`, 'video/mp4', res, directory);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(raw).videoCodec('libx264').audioCodec('aac')
          .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23', '-pix_fmt yuv420p', '-threads 0'])
          .save(output).on('end', () => resolve()).on('error', reject);
      });
      this.sendFile(output, `${title}.mp4`, 'video/mp4', res, directory);
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

  async audioToSrt(audioPath: string): Promise<string> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-subtitles-'));
    try {
      const wav = path.join(directory, 'audio.wav');
      await execFileAsync(ffmpegPath, ['-i', audioPath, '-ar', '16000', '-ac', '1', wav, '-y']);
      await execFileAsync('whisper', [wav, '--model', 'tiny', '--output_format', 'srt', '--output_dir', directory, '--fp16', 'False']);
      return fs.readFileSync(path.join(directory, 'audio.srt'), 'utf8');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(audioPath, { force: true });
    }
  }

  srtToScript(content: string): string {
    return content.replace(/\r/g, '').split(/\n\s*\n/)
      .map(block => block.split('\n').filter(line => !/^\d+$/.test(line.trim()) && !line.includes('-->')).join(' ').trim())
      .filter(Boolean).join('\n\n');
  }

}

export const youtubeToolsService = new YouTubeToolsService();
