/**
 * Instagram Service - Adapted from toolBe for lenytdesktop
 * Handles: post info, video/audio download, channel feed, Excel export, ZIP export, cache
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import * as archiver from 'archiver';
import Ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { DATA_DIR } from './config';
import { executablePath } from './binary-paths';
import { playableMp4 } from './video-file';

const execFileAsync = promisify(execFile);
const ytDlpPath: string = executablePath(require('youtube-dl-exec').constants.YOUTUBE_DL_PATH);
const ffmpegPath: string = executablePath(require('@ffmpeg-installer/ffmpeg').path);

// Try to set ffmpeg path
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  Ffmpeg.setFfmpegPath(executablePath(ffmpegInstaller.path));
} catch {
  console.warn('[Instagram] @ffmpeg-installer/ffmpeg not found, using system ffmpeg');
}

export interface InstagramResponse {
  results_number: number;
  url_list: string[];
  post_info: {
    owner_username: string;
    owner_fullname: string;
    is_verified: boolean;
    is_private: boolean;
    likes: number;
    is_ad: boolean;
    caption: string;
  };
  media_details: {
    type: string;
    dimensions: { height: number; width: number };
    url: string;
    video_view_count?: number;
    thumbnail?: string;
  }[];
}

interface InstagramChannelCache {
  user: any;
  items: any[];
  overallTotalCount: number;
  nextMaxId?: string | null;
  hasMore?: boolean;
}

type InstagramChannelError = Error & {
  statusCode?: number;
  retryAfterSeconds?: number;
  stage?: 'profile' | 'feed';
};

class InstagramService {
  private sessionCookie: string | null = null;
  private sessionUserAgent: string | null = null;
  private channelCooldownUntil = 0;
  private channelCooldownStage: 'profile' | 'feed' = 'profile';
  private channelCooldownHasRetryAfter = false;

  setSessionCookie(cookie: string | null, userAgent: string | null = null) {
    if (cookie !== this.sessionCookie) this.channelCooldownUntil = 0;
    this.sessionCookie = cookie;
    this.sessionUserAgent = cookie ? userAgent : null;
  }

  hasSession() {
    return Boolean(this.sessionCookie?.match(/(?:^|;\s*)sessionid=[^;]+/));
  }

  private getShortcode(input: string): string {
    const trimmed = input.trim();
    if (trimmed.includes('/') || trimmed.includes('instagram.com')) {
      const match = trimmed.match(/(?:\/p\/|\/reel\/|\/tv\/|\/reels\/)([A-Za-z0-9_-]+)/);
      if (!match) throw new Error('Invalid Instagram URL. Only posts and reels are supported.');
      return match[1];
    }
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      throw new Error('Invalid Instagram shortcode or URL format.');
    }
    return trimmed;
  }

  private getUsername(input: string): string {
    const trimmed = input.trim();
    const username = trimmed.includes('/') || trimmed.includes('instagram.com')
      ? trimmed.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(?:\?.*)?$/i)?.[1]
      : trimmed;
    if (!username || !/^[A-Za-z0-9._]+$/.test(username)) {
      throw new Error('Invalid Instagram username or profile URL.');
    }
    return username;
  }

  private async getCSRFTokenAndCookies(): Promise<{ csrfToken: string; cookieHeader: string }> {
    const response = await axios.request({
      method: 'GET',
      url: 'https://www.instagram.com/',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const setCookies = response.headers['set-cookie'];
    if (!setCookies || setCookies.length === 0) {
      throw new Error('No set-cookie headers returned from Instagram.');
    }

    let csrfToken = '';
    const cookieParts: string[] = [];

    for (const cookie of setCookies) {
      const parts = cookie.split(';');
      cookieParts.push(parts[0]);
      if (parts[0].startsWith('csrftoken=')) {
        csrfToken = parts[0].replace('csrftoken=', '');
      }
    }

    if (!csrfToken) {
      for (const cookie of setCookies) {
        const match = cookie.match(/csrftoken=([^;]+)/);
        if (match) { csrfToken = match[1]; break; }
      }
    }

    if (!csrfToken) throw new Error('CSRF token not found in set-cookie headers.');

    return { csrfToken, cookieHeader: cookieParts.join('; ') };
  }

  private async queryInstagramGraphQL(shortcode: string, csrfToken: string, cookieHeader: string): Promise<any> {
    const BASE_URL = 'https://www.instagram.com/graphql/query';
    const INSTAGRAM_DOCUMENT_ID = '10015901848480474';

    const postData = new URLSearchParams({
      variables: JSON.stringify({
        shortcode,
        fetch_tagged_user_count: null,
        hoisted_comment_id: null,
        hoisted_reply_id: null,
      }),
      doc_id: INSTAGRAM_DOCUMENT_ID,
    });

    const response = await axios.request({
      method: 'POST',
      url: BASE_URL,
      headers: {
        'X-CSRFToken': csrfToken,
        'Cookie': cookieHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.sessionUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `https://www.instagram.com/reel/${shortcode}/`,
        'Origin': 'https://www.instagram.com',
      },
      data: postData.toString(),
    });

    const data = response.data;
    if (!data || !data.data || !data.data.xdt_shortcode_media) {
      throw new Error('Only posts/reels supported, or post is private/unavailable.');
    }
    return data.data.xdt_shortcode_media;
  }

  private formatInstagramResponse(requestData: any): InstagramResponse {
    const url_list: string[] = [];
    const media_details: any[] = [];

    const isSidecar = requestData['__typename'] === 'XDTGraphSidecar';
    if (isSidecar) {
      const edges = requestData.edge_sidecar_to_children?.edges || [];
      for (const edge of edges) {
        const node = edge.node;
        if (node) {
          media_details.push(this.formatMediaDetails(node));
          url_list.push(node.is_video ? node.video_url : node.display_url);
        }
      }
    } else {
      media_details.push(this.formatMediaDetails(requestData));
      url_list.push(requestData.is_video ? requestData.video_url : requestData.display_url);
    }

    const caption = requestData.edge_media_to_caption?.edges?.[0]?.node?.text || '';

    return {
      results_number: url_list.length,
      url_list,
      post_info: {
        owner_username: requestData.owner?.username || '',
        owner_fullname: requestData.owner?.full_name || '',
        is_verified: !!requestData.owner?.is_verified,
        is_private: !!requestData.owner?.is_private,
        likes: requestData.edge_media_preview_like?.count || 0,
        is_ad: !!requestData.is_ad,
        caption,
      },
      media_details,
    };
  }

  private formatMediaDetails(mediaData: any) {
    if (mediaData.is_video) {
      return {
        type: 'video',
        dimensions: mediaData.dimensions || { height: 0, width: 0 },
        video_view_count: mediaData.video_view_count || 0,
        url: mediaData.video_url,
        thumbnail: mediaData.display_url,
      };
    }
    return {
      type: 'image',
      dimensions: mediaData.dimensions || { height: 0, width: 0 },
      url: mediaData.display_url,
    };
  }

  private async getInstagramData(url: string, sessionCookie?: string): Promise<InstagramResponse> {
    const shortcode = this.getShortcode(url);
    console.log(`[Instagram] Fetching metadata for shortcode: ${shortcode}`);
    const { csrfToken, cookieHeader } = sessionCookie
      ? { csrfToken: sessionCookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || '', cookieHeader: sessionCookie }
      : await this.getCSRFTokenAndCookies();
    const mediaData = await this.queryInstagramGraphQL(shortcode, csrfToken, cookieHeader);
    return this.formatInstagramResponse(mediaData);
  }

  async getVideoInfo(url: string, sessionCookie = this.sessionCookie || undefined) {
    const data = await this.getInstagramData(url, sessionCookie);
    if (!data || !data.media_details || data.media_details.length === 0) {
      throw new Error('Cannot retrieve media details from this Instagram URL');
    }
    const videoMedia = data.media_details.find((m) => m.type === 'video');
    if (!videoMedia) throw new Error('No video found in this Instagram post');

    const username = data.post_info?.owner_username || 'instagram';
    return {
      success: true,
      title: data.post_info?.caption || 'Instagram Video',
      username,
      fullname: data.post_info?.owner_fullname,
      likes: data.post_info?.likes,
      isVerified: data.post_info?.is_verified,
      videoUrl: videoMedia.url,
      thumbnailUrl: videoMedia.thumbnail || '',
      width: videoMedia.dimensions?.width,
      height: videoMedia.dimensions?.height,
      views: videoMedia.video_view_count,
      resultsNumber: data.results_number,
    };
  }

  private async getWebProfileInfo(username: string, sessionCookie?: string, requestUserAgent?: string): Promise<any> {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
    let response;
    try {
      response = await axios.request({
        method: 'GET',
        url,
        headers: this.getUserFeedHeaders(username, sessionCookie, requestUserAgent),
      });
    } catch (error) {
      throw this.channelRequestError(error, Boolean(sessionCookie), 'profile');
    }
    const responseData = response.data;
    if (!responseData || !responseData.data || !responseData.data.user) {
      throw new Error('Failed to extract user profile data.');
    }
    return responseData.data.user;
  }

  async getChannelVideos(usernameOrUrl: string, typeFilter?: string, page: number = 1, pageSize: number = 10, sessionCookie = this.sessionCookie || undefined, requestUserAgent?: string) {
    const username = this.getUsername(usernameOrUrl);
    console.log(`[Instagram] Fetching channel for: ${username}, page: ${page}, pageSize: ${pageSize}, filter: ${typeFilter}`);

    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 10;
    if (pageSize > 200) pageSize = 200;

    const cacheDir = path.join(DATA_DIR, 'instagram');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const cacheFilePath = path.join(cacheDir, `${username}.json`);

    let cachedData: InstagramChannelCache | null = null;
    const cacheExists = await fs.promises.access(cacheFilePath).then(() => true).catch(() => false);
    if (cacheExists) {
      try {
        const fileContent = await fs.promises.readFile(cacheFilePath, 'utf-8');
        cachedData = JSON.parse(fileContent);
      } catch { /* Will fetch fresh data */ }
    }

    if (!cachedData || !cachedData.user || !Array.isArray(cachedData.items)) {
      if (Date.now() < this.channelCooldownUntil) throw this.channelCooldownError();
      const profileInfo = await this.getWebProfileInfo(username, sessionCookie, requestUserAgent);
      cachedData = { user: {
        username: profileInfo.username || username,
        fullname: profileInfo.full_name || '',
        profilePicUrl: profileInfo.profile_pic_url || '',
        id: profileInfo.pk || '',
        followersCount: profileInfo.edge_followed_by?.count || 0,
        followingCount: profileInfo.edge_follow?.count || 0,
      }, items: [], overallTotalCount: profileInfo.edge_owner_to_timeline_media?.count || 0, hasMore: true, nextMaxId: null };
      await fs.promises.writeFile(cacheFilePath, JSON.stringify(cachedData), 'utf-8');
    }

    const cache = cachedData;
    // Older cache files were only written after a complete scan.
    if (cache.hasMore === undefined) cache.hasMore = false;
    const targetTypes = typeFilter?.split(',').map((t) => t.toLowerCase().trim()).filter((t) => ['video', 'image', 'carousel'].includes(t)) || [];
    const matchingItems = () => targetTypes.length ? cache.items.filter((item) => targetTypes.includes(item.type)) : cache.items;
    const endIndex = page * pageSize;
    let pagesFetched = 0;
    // One API call must not crawl an entire account. Further calls resume the saved cursor.
    while (cache.hasMore && matchingItems().length < endIndex && pagesFetched < 4) {
      if (Date.now() < this.channelCooldownUntil) {
        if (matchingItems().length === 0) throw this.channelCooldownError();
        break;
      }
      const fetchUrl = `https://www.instagram.com/api/v1/feed/user/${username}/username/${cache.nextMaxId ? `?max_id=${encodeURIComponent(cache.nextMaxId)}` : ''}`;
      let response;
      try {
        response = await axios.request({ method: 'GET', url: fetchUrl, headers: this.getUserFeedHeaders(username, sessionCookie, requestUserAgent) });
      } catch (error) {
        const requestError = this.channelRequestError(error, Boolean(sessionCookie), 'feed');
        if (requestError.statusCode !== 429 || matchingItems().length === 0) throw requestError;
        break;
      }
      const responseData = response.data;
      if (!responseData || !Array.isArray(responseData.items)) {
        cache.hasMore = false;
        break;
      }
      const existingIds = new Set(cache.items.map((item) => item.id));
      for (const item of responseData.items) {
        if (existingIds.has(item.id)) continue;
        existingIds.add(item.id);
        let type = 'image';
        if (item.media_type === 2) type = 'video';
        else if (item.media_type === 8) type = 'carousel';
        cache.items.push({
          id: item.id,
          shortcode: item.code,
          type,
          title: item.caption?.text || '',
          videoUrl: item.video_versions?.[0]?.url || null,
          thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || null,
          likes: item.like_count || 0,
          comments: item.comment_count || 0,
          views: item.play_count || item.view_count || 0,
          takenAt: item.taken_at,
        });
      }
      cache.nextMaxId = responseData.next_max_id || null;
      cache.hasMore = responseData.more_available === true && Boolean(cache.nextMaxId);
      pagesFetched++;
      await fs.promises.writeFile(cacheFilePath, JSON.stringify(cache), 'utf-8');
      if (cache.hasMore && matchingItems().length < endIndex && pagesFetched < 4) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    let filteredItems = matchingItems();
    // The feed arrives newest first; sorting oldest first would require a full account crawl.
    filteredItems = [...filteredItems].sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0));

    const startIndex = (page - 1) * pageSize;
    const slicedItems = filteredItems.slice(startIndex, endIndex);

    return {
      success: true,
      user: cache.user,
      items: slicedItems,
      pagination: {
        page, pageSize,
        totalCount: cache.hasMore ? Math.max(cache.overallTotalCount, endIndex + 1) : filteredItems.length,
        hasMore: cache.hasMore || filteredItems.length > endIndex,
        loadedCount: filteredItems.length,
        incompletePage: cache.hasMore && filteredItems.length < endIndex,
        retryAfterSeconds: Date.now() < this.channelCooldownUntil ? Math.ceil((this.channelCooldownUntil - Date.now()) / 1000) : 0,
      },
    };
  }

  async exportChannelVideosToExcel(usernameOrUrl: string, res: Response, typeFilter?: string) {
    const username = this.getUsername(usernameOrUrl);
    const cacheDir = path.join(DATA_DIR, 'instagram');
    const cacheFilePath = path.join(cacheDir, `${username}.json`);

    if (!fs.existsSync(cacheFilePath)) {
      throw new Error(`No cached data found for channel ${username}. Please fetch the channel feed first.`);
    }

    let items: any[] = [];
    const fileContent = fs.readFileSync(cacheFilePath, 'utf-8');
    const cacheData = JSON.parse(fileContent);
    items = cacheData.items || [];

    if (typeFilter) {
      const targetTypes = typeFilter.split(',').map((t) => t.toLowerCase().trim()).filter((t) => ['video', 'image', 'carousel'].includes(t));
      if (targetTypes.length > 0) items = items.filter((item: any) => targetTypes.includes(item.type));
    }

    items.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Instagram Posts');
    worksheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'Link', key: 'link', width: 45 },
      { header: 'Like', key: 'likes', width: 12 },
      { header: 'Lượt xem', key: 'views', width: 15 },
      { header: 'Ngày tạo', key: 'takenAt', width: 18 },
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    items.forEach((item, index) => {
      let dateStr = '';
      if (item.takenAt) {
        const date = new Date(item.takenAt * 1000);
        dateStr = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      }
      worksheet.addRow({ stt: index + 1, link: `https://www.instagram.com/p/${item.shortcode}/`, likes: item.likes || 0, views: item.views || 0, takenAt: dateStr });
    });

    const filename = `instagram_export_${username}${cacheData.hasMore ? '_partial' : ''}_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async exportChannelImagesToZip(usernameOrUrl: string, res: Response, typeFilter?: string) {
    const username = this.getUsername(usernameOrUrl);
    const cacheDir = path.join(DATA_DIR, 'instagram');
    const cacheFilePath = path.join(cacheDir, `${username}.json`);

    if (!fs.existsSync(cacheFilePath)) {
      throw new Error(`No cached data found for channel ${username}. Please fetch the channel feed first.`);
    }

    let items: any[] = [];
    const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
    items = cacheData.items || [];

    if (typeFilter) {
      const targetTypes = typeFilter.split(',').map((t) => t.toLowerCase().trim()).filter((t) => ['video', 'image', 'carousel'].includes(t));
      if (targetTypes.length > 0) items = items.filter((item: any) => targetTypes.includes(item.type));
    }

    items.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));
    if (items.length === 0) throw new Error('No items found matching the filter.');

    const filename = `instagram_images_${username}${cacheData.hasMore ? '_partial' : ''}_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver.create('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => console.error(`Archiver error: ${err.message}`));
    archive.pipe(res);

    const CONCURRENCY = 10;
    let itemIdx = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (itemIdx < items.length) {
        const index = itemIdx++;
        const item = items[index];
        const stt = index + 1;
        const url = item.thumbnailUrl;
        if (!url) continue;
        try {
          let ext = '.jpg';
          if (url.includes('.webp')) ext = '.webp';
          else if (url.includes('.png')) ext = '.png';
          const response = await axios({ method: 'GET', url, responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
          archive.append(Buffer.from(response.data), { name: `${stt}${ext}` });
        } catch { /* skip failed image */ }
      }
    });

    await Promise.all(workers);
    await archive.finalize();
  }

  async clearAllChannelCache() {
    const cacheDir = path.join(DATA_DIR, 'instagram');
    if (!fs.existsSync(cacheDir)) {
      return { success: true, message: 'No cache directory found.', deletedFilesCount: 0 };
    }
    const files = fs.readdirSync(cacheDir);
    let deletedCount = 0;
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(cacheDir, file));
        deletedCount++;
      }
    }
    return { success: true, message: `Cleared ${deletedCount} Instagram cache files.`, deletedFilesCount: deletedCount };
  }

  async downloadVideo(url: string, res: Response, sessionCookie = this.sessionCookie || undefined) {
    const shortcode = this.getShortcode(url);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-ig-video-'));
    try {
      const data = await this.getInstagramData(url, sessionCookie);
      const videoMedia = data.media_details.find((m) => m.type === 'video');
      if (!videoMedia?.url) throw new Error('No video found in this Instagram post');
      const source = path.join(directory, 'source');
      const response = await axios({ url: videoMedia.url, method: 'GET', responseType: 'stream', timeout: 60_000, headers: this.getDownloadHeaders() });
      await pipeline(response.data, fs.createWriteStream(source));
      const video = await playableMp4(source, path.join(directory, 'video.mp4'), ffmpegPath);
      this.sendLocalDownload(video, res, `instagram_${shortcode}.mp4`, 'video/mp4', directory);
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      if (res.headersSent) throw error;
      await this.downloadWithYtDlp(url, 'video', res);
    }
  }

  async downloadAudio(url: string, res: Response, sessionCookie = this.sessionCookie || undefined) {
    const shortcode = this.getShortcode(url);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-ig-audio-'));
    try {
      const data = await this.getInstagramData(url, sessionCookie);
      const videoMedia = data.media_details.find((m) => m.type === 'video');
      if (!videoMedia?.url) throw new Error('No video found in this Instagram post');
      const videoPath = path.join(directory, 'source.mp4');
      const response = await axios({ url: videoMedia.url, method: 'GET', responseType: 'stream', headers: this.getDownloadHeaders() });
      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(videoPath);
        response.data.on('error', reject);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.pipe(writer);
      });
      const audioPath = path.join(directory, 'audio.mp3');
      await this.convertToMp3(videoPath, audioPath);
      this.sendLocalDownload(audioPath, res, `instagram_${shortcode}.mp3`, 'audio/mpeg', directory);
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      if (res.headersSent) throw error;
      await this.downloadWithYtDlp(url, 'audio', res);
    }
  }

  private convertToMp3(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      Ffmpeg(input).noVideo().audioCodec('libmp3lame').audioBitrate(192)
        .save(output).on('end', () => resolve()).on('error', reject);
    });
  }

  private pipeDownload(stream: NodeJS.ReadableStream, res: Response, filename: string, contentType: string) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.on('error', (error: Error) => res.destroy(error));
    stream.pipe(res);
  }

  private sendLocalDownload(file: string, res: Response, filename: string, contentType: string, directory: string) {
    res.setHeader('Content-Length', fs.statSync(file).size);
    const stream = fs.createReadStream(file);
    const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
    res.once('close', cleanup);
    stream.once('error', (error) => res.destroy(error));
    this.pipeDownload(stream, res, filename, contentType);
  }

  private async downloadWithYtDlp(input: string, kind: 'audio' | 'video', res: Response) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-ig-ytdlp-'));
    const shortcode = this.getShortcode(input);
    const mediaType = /instagram\.com\/p\//i.test(input) ? 'p' : /instagram\.com\/tv\//i.test(input) ? 'tv' : 'reel';
    const url = `https://www.instagram.com/${mediaType}/${shortcode}/`;
    const args = [
      '--ignore-config', '--no-playlist', '--no-warnings', '--no-progress',
      '--socket-timeout', '20', '--retries', '1', '--ffmpeg-location', ffmpegPath,
      '-o', path.join(directory, 'media.%(ext)s'),
      ...(kind === 'video' ? ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'] : ['-f', 'bestaudio/best']),
      '--', url,
    ];
    try {
      await execFileAsync(ytDlpPath, args, { timeout: 180_000, maxBuffer: 1024 * 1024 });
      const source = fs.readdirSync(directory).find((name) => name.startsWith('media.') && !name.endsWith('.part') && !name.endsWith('.ytdl'));
      if (!source) throw new Error('yt-dlp không tạo được file media');
      let file = path.join(directory, source);
      if (kind === 'video') {
        file = await playableMp4(file, path.join(directory, 'video.mp4'), ffmpegPath);
      } else {
        const output = path.join(directory, 'audio.mp3');
        await this.convertToMp3(file, output);
        file = output;
      }
      this.sendLocalDownload(file, res, `instagram_${shortcode}.${kind === 'audio' ? 'mp3' : 'mp4'}`, kind === 'audio' ? 'audio/mpeg' : 'video/mp4', directory);
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw new Error(`Không thể tải ${kind === 'audio' ? 'audio' : 'video'} Instagram bằng yt-dlp: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getUserFeedHeaders(username: string, sessionCookie?: string, requestUserAgent?: string) {
    return {
      'User-Agent': sessionCookie && (this.sessionUserAgent || requestUserAgent)
        ? this.sessionUserAgent || requestUserAgent
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-IG-App-ID': '936619743392459',
      'Referer': `https://www.instagram.com/${username}/`,
      'Origin': 'https://www.instagram.com',
      ...(sessionCookie ? { 'Cookie': sessionCookie } : {}),
      ...(sessionCookie?.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1]
        ? { 'X-CSRFToken': sessionCookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)![1] }
        : {}),
    };
  }

  private channelCooldownError(): InstagramChannelError {
    const seconds = Math.max(1, Math.ceil((this.channelCooldownUntil - Date.now()) / 1000));
    const sessionHint = this.hasSession()
      ? ''
      : ' Backend chưa nhận phiên đăng nhập Instagram; hãy mở ứng dụng và kết nối Instagram trước khi gọi API trực tiếp.';
    const waitMessage = this.channelCooldownHasRetryAfter
      ? `Instagram yêu cầu chờ khoảng ${seconds} giây.`
      : `Ứng dụng tạm dừng ${seconds} giây trước khi thử lại; Instagram có thể tiếp tục giới hạn lâu hơn.`;
    const result = new Error(`Instagram đang giới hạn truy cập khi ${this.channelCooldownStage === 'profile' ? 'lấy profile' : 'tải feed'}. ${waitMessage}${sessionHint}`) as InstagramChannelError;
    result.statusCode = 429;
    result.retryAfterSeconds = seconds;
    result.stage = this.channelCooldownStage;
    return result;
  }

  private channelRequestError(error: unknown, hasSession: boolean, stage: 'profile' | 'feed'): InstagramChannelError {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 429) {
        const retryAfter = Number(error.response?.headers?.['retry-after']);
        this.channelCooldownHasRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0;
        // Instagram often replies "Please wait a few minutes" without Retry-After.
        // A one-minute retry repeatedly triggers the same limit for this account.
        const waitSeconds = this.channelCooldownHasRetryAfter ? Math.min(retryAfter, 3600) : 300;
        this.channelCooldownUntil = Math.max(this.channelCooldownUntil, Date.now() + waitSeconds * 1000);
        this.channelCooldownStage = stage;
        const result = this.channelCooldownError();
        return result;
      }
      if (status === 401 || status === 403) {
        const result = new Error(
          hasSession
            ? `Instagram từ chối phiên đăng nhập (${status}). Hãy kết nối lại Instagram trong ứng dụng hoặc thử lại sau nếu tài khoản bị giới hạn lượt truy cập.`
            : `Instagram từ chối truy cập dữ liệu kênh (${status}). Không thể quét kênh này ẩn danh khi Instagram yêu cầu đăng nhập hoặc giới hạn lượt truy cập. Hãy thử lại sau hoặc dùng nút Kết nối Instagram trong ứng dụng.`
        ) as InstagramChannelError;
        result.statusCode = 502;
        return result;
      }
      const result = new Error(`Không thể lấy dữ liệu kênh từ Instagram: ${error.message}`) as InstagramChannelError;
      result.statusCode = 502;
      return result;
    }
    return error instanceof Error ? error : new Error('Không thể lấy dữ liệu kênh từ Instagram');
  }

  private getDownloadHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://www.instagram.com/',
      'Origin': 'https://www.instagram.com',
    };
  }
}

export const instagramService = new InstagramService();
