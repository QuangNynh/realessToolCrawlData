/**
 * TikTok Service - Adapted from toolBe for lenytdesktop
 * Handles: channel videos listing, video download, audio download
 * Uses: yt-dlp (youtube-dl-exec) + fluent-ffmpeg
 */

import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Ffmpeg from 'fluent-ffmpeg';
import youtubedl from 'youtube-dl-exec';
import { DATA_DIR } from './config';
import { executablePath } from './binary-paths';
import { playableMp4 } from './video-file';

const youtubeDlExec: any = (youtubedl as any)?.exec || youtubedl;

let ffmpegPath = 'ffmpeg';
// Try to set ffmpeg path
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  ffmpegPath = executablePath(ffmpegInstaller.path);
  Ffmpeg.setFfmpegPath(ffmpegPath);
} catch {
  console.warn('[TikTok] @ffmpeg-installer/ffmpeg not found, using system ffmpeg');
}

class TikTokService {
  private readonly channelIdFile = path.join(DATA_DIR, 'tiktok-channel-ids.json');

  private getCachedChannelId(username: string): string | undefined {
    try {
      const ids = JSON.parse(fs.readFileSync(this.channelIdFile, 'utf8'));
      const id = ids[username.toLowerCase()];
      return typeof id === 'string' && /^MS4wLjABAAAA[\w-]{64}$/.test(id) ? id : undefined;
    } catch { return undefined; }
  }

  private saveChannelId(username: string, id: unknown) {
    if (typeof id !== 'string' || !/^MS4wLjABAAAA[\w-]{64}$/.test(id)) return;
    try {
      const ids = fs.existsSync(this.channelIdFile) ? JSON.parse(fs.readFileSync(this.channelIdFile, 'utf8')) : {};
      ids[username.toLowerCase()] = id;
      fs.writeFileSync(this.channelIdFile, JSON.stringify(ids), 'utf8');
    } catch (error) { console.warn('[TikTok] Could not save channel ID:', error); }
  }

  async getChannelVideos(url: string, limitVal?: number) {
    try {
      const username = url.trim().match(/^(?:https?:\/\/(?:www\.)?tiktok\.com\/)?@?([\w.]+)\/?(?:\?.*)?$/i)?.[1];
      if (!username) throw new Error('URL kênh TikTok không hợp lệ. Ví dụ: https://www.tiktok.com/@movies.vibe03');
      const profileUrl = `https://www.tiktok.com/@${username}`;
      console.log(`[TikTok] Fetching videos from: ${profileUrl}${limitVal ? ` (limit: ${limitVal})` : ' (all)'}`);
      const options: any = {
        dumpSingleJson: true,
        flatPlaylist: true,
        ignoreConfig: true,
        noWarnings: true,
      };

      if (limitVal !== undefined && limitVal > 0) {
        options.playlistItems = `1-${limitVal}`;
      }

      const cachedId = this.getCachedChannelId(username);
      const targets = cachedId ? [`tiktokuser:${cachedId}`, profileUrl] : [profileUrl];
      let parsed: any;
      let lastError = '';
      for (const target of targets) {
        const attempts = target === profileUrl ? 3 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
          // Raw exec exposes stderr even on exit code 1; the wrapper otherwise hides the extractor error.
          const result = await youtubeDlExec(target, options, { reject: false });
          if (result?.exitCode === 0 && result.stdout) {
            parsed = JSON.parse(result.stdout);
            break;
          }
          lastError = String(result?.stderr || result?.error?.message || 'yt-dlp không trả dữ liệu').trim();
          if (!/Unable to extract secondary user ID|Please wait|challenge|HTTP Error 429/i.test(lastError)) break;
          if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
        }
        if (parsed) break;
      }
      if (!parsed) {
        const detail = lastError.split('\n').find(line => line.includes('ERROR:'))?.replace(/^.*ERROR:\s*/, '') || lastError.split('\n').at(-1) || 'TikTok không trả dữ liệu';
        if (/Unable to extract secondary user ID|Please wait|challenge/i.test(detail)) {
          throw new Error('TikTok đang yêu cầu xác minh truy cập trang kênh. Ứng dụng đã thử lại nhưng chưa lấy được danh sách video; hãy thử lại sau.');
        }
        throw new Error(detail);
      }
      this.saveChannelId(username, parsed.id || parsed.entries?.[0]?.channel_id);
      const rawEntries: any[] = parsed.entries ?? [parsed];

      const videos = rawEntries.filter((e) => e).map((entry) => {
        const timestamp = entry.timestamp;
        const createdAt = timestamp ? new Date(timestamp * 1000).toISOString() : null;
        return {
          id: entry.id ?? null,
          title: entry.title ?? null,
          description: entry.description ?? null,
          url: `https://www.tiktok.com/@${username}/video/${entry.id}`,
          duration: entry.duration ?? null,
          view_count: Number(entry.view_count ?? 0),
          like_count: Number(entry.like_count ?? 0),
          comment_count: Number(entry.comment_count ?? 0),
          repost_count: Number(entry.repost_count ?? 0),
          save_count: Number(entry.save_count ?? 0),
          created_at: createdAt,
          uploader: entry.uploader ?? username,
          uploader_id: entry.uploader_id ?? null,
          thumbnails: entry.thumbnails ?? [],
        };
      });

      return {
        channel: parsed.title ?? username,
        title: parsed.title ?? username,
        url: profileUrl,
        video_count: videos.length,
        videos,
      };
    } catch (error: any) {
      throw new Error(`Không thể quét kênh TikTok: ${error.message}`);
    }
  }

  async downloadVideo(url: string, res: Response) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-tiktok-video-'));
    try {
      const result = await youtubeDlExec(url, {
        format: 'best', output: path.join(directory, 'source.%(ext)s'),
        print: 'after_move:LENYT_TITLE=%(title)j',
        ignoreConfig: true, noCheckCertificates: true, noWarnings: true,
      } as any);
      const sourceName = fs.readdirSync(directory).find(name => name.startsWith('source.') && !name.endsWith('.part') && !name.endsWith('.ytdl'));
      if (!sourceName) throw new Error('yt-dlp không tạo được file video');
      const source = path.join(directory, sourceName);
      const video = await playableMp4(source, path.join(directory, 'video.mp4'), ffmpegPath);
      const titleJson = result?.stdout?.match(/^LENYT_TITLE=(.*)$/m)?.[1];
      let title = 'tiktok_video';
      if (titleJson) {
        try { title = JSON.parse(titleJson); } catch { /* use fallback title */ }
      }
      const filename = `${this.sanitizeFilename(String(title)).substring(0, 50) || 'tiktok_video'}.mp4`;
      const stat = fs.statSync(video);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', stat.size.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const stream = fs.createReadStream(video);
      stream.pipe(res);
      res.once('close', () => fs.rm(directory, { recursive: true, force: true }, () => {}));
      stream.once('error', error => res.destroy(error));
    } catch (error: any) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw new Error(`Failed to download TikTok video: ${error.message}`);
    }
  }

  async downloadAudio(url: string, res: Response) {
    let rawFile: string | null = null;
    let finalFile: string | null = null;
    const ts = Date.now();
    try {
      let title = 'tiktok_audio';
      try {
        const metaResult = await youtubeDlExec(url, { dumpSingleJson: true, ignoreConfig: true, noWarnings: true, noCheckCertificates: true });
        if (metaResult?.stdout) {
          const meta = JSON.parse(metaResult.stdout);
          title = meta.title || meta.description || title;
        }
      } catch { /* use default */ }

      const sanitizedTitle = this.sanitizeFilename(title).substring(0, 50) || 'tiktok_audio';
      const filename = `${sanitizedTitle}.mp3`;

      const tempDir = os.tmpdir();
      rawFile = path.join(tempDir, `tiktok-audio-${ts}-raw`);
      finalFile = path.join(tempDir, `tiktok-audio-${ts}-final.mp3`);

      await youtubeDlExec(url, { format: 'bestaudio/best', output: rawFile, ignoreConfig: true, noCheckCertificates: true, noWarnings: true });

      // Find actual downloaded file (yt-dlp appends extension)
      const baseTempName = `tiktok-audio-${ts}-raw`;
      const files = fs.readdirSync(tempDir);
      const downloadedFile = files.find(f => f.startsWith(baseTempName));
      if (!downloadedFile) throw new Error('Downloaded audio file does not exist');
      const downloadedFilePath = path.join(tempDir, downloadedFile);

      // Convert to MP3
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(downloadedFilePath)
          .audioCodec('libmp3lame').audioBitrate(192)
          .save(finalFile as string)
          .on('end', () => resolve()).on('error', (err: Error) => reject(err));
      });

      try { fs.unlinkSync(downloadedFilePath); } catch {}
      if (!fs.existsSync(finalFile)) throw new Error('Converted audio file does not exist');

      const stat = fs.statSync(finalFile);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', stat.size.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Accept-Ranges', 'bytes');

      const stream = fs.createReadStream(finalFile);
      stream.pipe(res);
      const targetFile = finalFile;
      res.on('finish', () => { fs.unlink(targetFile, () => {}); });
      stream.on('error', () => { fs.unlink(targetFile, () => {}); });
    } catch (error: any) {
      const baseTempName = `tiktok-audio-${ts}-raw`;
      try {
        const files = fs.readdirSync(os.tmpdir());
        const df = files.find(f => f.startsWith(baseTempName));
        if (df) fs.unlinkSync(path.join(os.tmpdir(), df));
      } catch {}
      if (finalFile && fs.existsSync(finalFile)) try { fs.unlinkSync(finalFile); } catch {}
      throw new Error(`Failed to download TikTok audio: ${error.message}`);
    }
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().replace(/\s+/g, '_');
  }
}

export const tiktokService = new TikTokService();
