/**
 * Pinterest Service - Adapted from toolBe for lenytdesktop
 * Handles: channel pins, video/image/audio download, Excel export, ZIP export, cache, OAuth
 * EXCLUDED: schedule features (schedulePin, getScheduledJobs, cancelScheduledJob)
 * Removed: SchedulerRegistry and NestJS decorators
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import * as archiver from 'archiver';
import Ffmpeg from 'fluent-ffmpeg';
import { DATA_DIR } from './config';
import { executablePath } from './binary-paths';

try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  Ffmpeg.setFfmpegPath(executablePath(ffmpegInstaller.path));
} catch {
  console.warn('[Pinterest] @ffmpeg-installer/ffmpeg not found, using system ffmpeg');
}

const PINTEREST_API_BASE = 'https://www.pinterest.com/resource';
const PINTEREST_V5_API = 'https://api.pinterest.com/v5';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://www.pinterest.com/',
};

export interface PinterestAccount {
  username: string;
  fullName?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  connectedAt: number;
}

class PinterestService {
  private readonly accountsFilePath = path.join(DATA_DIR, 'pinterest', 'accounts.json');

  constructor() {
    const dir = path.dirname(this.accountsFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.accountsFilePath)) fs.writeFileSync(this.accountsFilePath, JSON.stringify([]), 'utf-8');
  }

  private async callPinterestApi(resource: string, options: Record<string, any>, pwsHandler = 'www/[username].js'): Promise<any> {
    const data = JSON.stringify({ options });
    const url = `${PINTEREST_API_BASE}/${resource}/get/?data=${encodeURIComponent(data)}`;
    const response = await axios.get(url, { headers: { ...DEFAULT_HEADERS, 'X-Pinterest-PWS-Handler': pwsHandler } });
    const json = response.data;
    const resourceResponse = json?.resource_response;
    if (resourceResponse?.error) throw new Error(`Pinterest API error: ${resourceResponse.error.message || 'Unknown'}`);
    return resourceResponse;
  }

  private parseUrl(url: string) {
    const trimmed = url.trim().replace(/\/+$/, '');
    const pinMatch = trimmed.match(/pinterest\.com\/pin\/([0-9]+)/);
    if (pinMatch) return { type: 'pin' as const, username: '', pinId: pinMatch[1] };

    const twoSeg = trimmed.match(/pinterest\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
    if (twoSeg) {
      const username = twoSeg[1];
      const slug = twoSeg[2];
      if (['pin', 'search', 'resource', 'api'].includes(username)) throw new Error('Invalid Pinterest URL.');
      if (slug === '_created') return { type: 'created' as const, username };
      if (slug === '_saved') return { type: 'saved' as const, username };
      return { type: 'board' as const, username, slug };
    }

    const oneSeg = trimmed.match(/pinterest\.com\/([A-Za-z0-9_.-]+)\/?$/);
    if (oneSeg) {
      const username = oneSeg[1];
      if (['pin', 'search', 'resource', 'api'].includes(username)) throw new Error('Invalid Pinterest URL.');
      return { type: 'profile' as const, username };
    }

    throw new Error('Invalid Pinterest URL.');
  }

  private getCacheKey(parsed: ReturnType<typeof this.parseUrl>): string {
    switch (parsed.type) {
      case 'profile': case 'saved': return `${parsed.username}__saved`;
      case 'created': return `${parsed.username}__created`;
      case 'board': return `${parsed.username}__${(parsed as any).slug}`;
      default: return parsed.username;
    }
  }

  private mapPinData(pin: any) {
    const images = pin.images || {};
    let origImage = images.orig?.url || images['736x']?.url || images['474x']?.url || null;
    if (!origImage && pin.story_pin_data?.pages) {
      for (const page of pin.story_pin_data.pages) {
        const pi = page.image?.images || {};
        const pageImage = pi.originals?.url || pi['750x']?.url || pi['736x']?.url;
        if (pageImage) { origImage = pageImage; break; }
      }
    }

    let videoUrl: string | null = null;
    if (pin.videos?.video_list) {
      const vl = pin.videos.video_list;
      for (const key of ['V_720P', 'V_480P30', 'V_480P', 'V_360P']) {
        if (vl[key]?.url) { videoUrl = vl[key].url; break; }
      }
      if (!videoUrl) {
        const sorted = (Object.values(vl) as any[]).filter(v => v.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
        videoUrl = sorted[0]?.url ?? null;
      }
    }
    if (!videoUrl && pin.story_pin_data?.pages) {
      for (const page of pin.story_pin_data.pages) {
        if (page.blocks) {
          for (const block of page.blocks) {
            if (block.video?.video_list) {
              const vl = block.video.video_list;
              for (const key of ['V_EXP7', 'V_EXP6', 'V_EXP5', 'V_EXP4', 'V_EXP3']) {
                if (vl[key]?.url) { videoUrl = vl[key].url; break; }
              }
              if (!videoUrl) {
                const sorted = (Object.values(vl) as any[]).filter(v => v.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
                videoUrl = sorted[0]?.url ?? null;
              }
            }
            if (videoUrl) break;
          }
        }
        if (!videoUrl && page.video?.video_list) {
          const vl = page.video.video_list;
          for (const key of ['V_EXP7', 'V_EXP6', 'V_EXP5', 'V_EXP4']) {
            if (vl[key]?.url) { videoUrl = vl[key].url; break; }
          }
          if (!videoUrl) {
            const sorted = (Object.values(vl) as any[]).filter(v => v.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
            videoUrl = sorted[0]?.url ?? null;
          }
        }
        if (videoUrl) break;
      }
    }

    const isVideo = !!(pin.is_video || pin.videos || videoUrl);
    const saves = pin.aggregated_pin_data?.aggregated_stats?.saves ?? pin.repin_count ?? 0;
    let likeCount = 0;
    if (pin.reaction_counts) likeCount = (Object.values(pin.reaction_counts) as any[]).reduce((s: number, v: any): number => s + (Number(v) || 0), 0);

    let timestamp: number | null = null;
    if (pin.created_at) { const d = new Date(pin.created_at); if (!isNaN(d.getTime())) timestamp = Math.floor(d.getTime() / 1000); }

    return {
      id: pin.id ?? null, title: pin.title || pin.grid_title || null,
      description: pin.description || pin.raw_description || pin.seo_description || null,
      type: isVideo ? 'video' : 'image', is_video: isVideo,
      pin_url: `https://www.pinterest.com/pin/${pin.id}/`,
      link: pin.link || pin.link_url || pin.destination_url || pin.rich_metadata?.url || null,
      domain: pin.domain || null, created_at: pin.created_at || null, takenAt: timestamp,
      comment_count: pin.comment_count ?? 0, like_count: likeCount,
      repin_count: pin.repin_count ?? 0, save_count: saves,
      image_url: origImage, video_url: videoUrl,
      pinner: pin.pinner ? { username: pin.pinner.username, full_name: pin.pinner.full_name, id: pin.pinner.id } : null,
      board: pin.board ? { name: pin.board.name, url: pin.board.url } : null,
    };
  }

  async getChannelPins(urlOrUsername: string, typeFilter?: string, page = 1, pageSize = 10) {
    const parsed = this.parseUrl(urlOrUsername);
    if (parsed.type === 'pin') throw new Error('Use /pinterest/video or /pinterest/image for single pin.');

    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 10;
    if (pageSize > 200) pageSize = 200;

    const cacheDir = path.join(DATA_DIR, 'pinterest');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const cacheKey = this.getCacheKey(parsed);
    const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);

    let cachedData: any = null;
    if (await fs.promises.access(cacheFilePath).then(() => true).catch(() => false)) {
      try { cachedData = JSON.parse(await fs.promises.readFile(cacheFilePath, 'utf-8')); } catch {}
    }

    let formattedItems: any[] = [];
    let userProfile: any = null;
    let boardInfo: any = null;
    let overallTotalCount = 0;

    if (cachedData) {
      userProfile = cachedData.user;
      boardInfo = cachedData.boardInfo || null;
      formattedItems = cachedData.items;
      overallTotalCount = cachedData.overallTotalCount;
    } else {
      const userResponse = await this.callPinterestApi('UserResource', { username: parsed.username });
      const userData = userResponse?.data;
      if (!userData) throw new Error(`User "${parsed.username}" not found`);

      userProfile = { username: userData.username || parsed.username, full_name: userData.full_name || '', id: userData.id || '', follower_count: userData.follower_count || 0, pin_count: userData.pin_count || 0 };

      let resourceName: string, pwsHandler: string, baseOptions: any;
      switch (parsed.type) {
        case 'board': {
          const br = await this.callPinterestApi('BoardResource', { slug: (parsed as any).slug, username: parsed.username, field_set_key: 'detailed' }, 'www/[username]/[slug].js');
          const bd = br?.data;
          if (!bd) throw new Error(`Board not found`);
          boardInfo = { name: bd.name, id: bd.id, pin_count: bd.pin_count ?? 0, url: bd.url };
          overallTotalCount = bd.pin_count ?? 0;
          resourceName = 'BoardFeedResource'; pwsHandler = 'www/[username]/[slug].js';
          baseOptions = { board_id: bd.id }; break;
        }
        case 'created':
          overallTotalCount = 0; resourceName = 'UserActivityPinsResource'; pwsHandler = 'www/[username]/_created.js';
          baseOptions = { username: parsed.username, exclude_add_pin_rep: true }; break;
        default:
          overallTotalCount = userData.pin_count ?? 0; resourceName = 'UserPinsResource'; pwsHandler = 'www/[username]/_saved.js';
          baseOptions = { username: parsed.username }; break;
      }

      const allPins: any[] = [];
      let bookmark: string | null = null;
      let pagesFetched = 0, consecutiveErrors = 0;
      const MAX_ERRORS = 5, MAX_PAGES = 2000;

      while (pagesFetched < MAX_PAGES) {
        const opts: any = { ...baseOptions, page_size: 250 };
        if (bookmark) opts.bookmarks = [bookmark];

        let feedResponse: any;
        try { feedResponse = await this.callPinterestApi(resourceName, opts, pwsHandler); }
        catch (e: any) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_ERRORS) break;
          await new Promise(r => setTimeout(r, 3000)); continue;
        }

        const newBookmark = feedResponse?.bookmark ?? null;
        const pins = feedResponse?.data ?? [];
        if (pins.length > 0) { consecutiveErrors = 0; allPins.push(...pins); pagesFetched++; }
        if (!newBookmark || newBookmark === '-end-') break;
        if (pins.length === 0) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_ERRORS) break;
          bookmark = newBookmark;
          await new Promise(r => setTimeout(r, 2000)); continue;
        }
        bookmark = newBookmark;
        await new Promise(r => setTimeout(r, 200));
      }

      formattedItems = allPins.map(pin => this.mapPinData(pin));
      try {
        await fs.promises.writeFile(cacheFilePath, JSON.stringify({ user: userProfile, boardInfo, items: formattedItems, overallTotalCount }, null, 2), 'utf-8');
      } catch {}
    }

    let filteredItems = [...formattedItems];
    if (typeFilter) {
      const tt = typeFilter.split(',').map(t => t.toLowerCase().trim()).filter(t => ['video', 'image'].includes(t));
      if (tt.length > 0) filteredItems = filteredItems.filter(i => tt.includes(i.type));
    }
    filteredItems.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return {
      success: true, user: userProfile, board: boardInfo,
      items: filteredItems.slice(startIndex, endIndex),
      pagination: { page, pageSize, totalCount: filteredItems.length, hasMore: filteredItems.length > endIndex },
    };
  }

  async exportChannelToExcel(urlOrUsername: string, res: Response, typeFilter?: string) {
    const parsed = this.parseUrl(urlOrUsername);
    const cacheKey = this.getCacheKey(parsed);
    const cacheDir = path.join(DATA_DIR, 'pinterest');
    const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
    if (!fs.existsSync(cacheFilePath)) throw new Error(`No cached data. Fetch channel first.`);

    let items: any[] = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8')).items || [];
    if (typeFilter) {
      const tt = typeFilter.split(',').map(t => t.toLowerCase().trim()).filter(t => ['video', 'image'].includes(t));
      if (tt.length > 0) items = items.filter(i => tt.includes(i.type));
    }
    items.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Pinterest Pins');
    ws.columns = [
      { header: 'STT', key: 'stt', width: 8 }, { header: 'Link Pin', key: 'pin_url', width: 45 },
      { header: 'Link đính kèm', key: 'link', width: 50 }, { header: 'Type', key: 'type', width: 10 },
      { header: 'Tiêu đề', key: 'title', width: 30 }, { header: 'Mô tả', key: 'description', width: 40 },
      { header: 'Likes', key: 'likes', width: 12 }, { header: 'Saves', key: 'saves', width: 12 },
      { header: 'Repins', key: 'repins', width: 12 }, { header: 'Comments', key: 'comments', width: 12 },
      { header: 'Ngày tạo', key: 'created_at', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };

    items.forEach((item, i) => {
      let dateStr = '';
      if (item.takenAt) { const d = new Date(item.takenAt * 1000); dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
      ws.addRow({ stt: i + 1, pin_url: item.pin_url, link: item.link, type: item.type, title: item.title, description: item.description, likes: item.like_count, saves: item.save_count, repins: item.repin_count, comments: item.comment_count, created_at: dateStr });
    });

    const fn = `pinterest_export_${cacheKey}_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async exportImagesToZip(urlOrUsername: string, res: Response, typeFilter?: string) {
    const parsed = this.parseUrl(urlOrUsername);
    const cacheKey = this.getCacheKey(parsed);
    const cacheDir = path.join(DATA_DIR, 'pinterest');
    const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
    if (!fs.existsSync(cacheFilePath)) throw new Error(`No cached data. Fetch channel first.`);

    let items: any[] = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8')).items || [];
    if (typeFilter) {
      const tt = typeFilter.split(',').map(t => t.toLowerCase().trim()).filter(t => ['video', 'image'].includes(t));
      if (tt.length > 0) items = items.filter(i => tt.includes(i.type));
    }
    items.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));
    if (items.length === 0) throw new Error('No items found.');

    const fn = `pinterest_images_${cacheKey}_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);

    const archive = archiver.create('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => console.error(`Archiver error: ${err.message}`));
    archive.pipe(res);

    const CONCURRENCY = 10;
    let itemIdx = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (itemIdx < items.length) {
        const i = itemIdx++;
        const item = items[i];
        if (!item.image_url) continue;
        try {
          let ext = '.jpg';
          if (item.image_url.includes('.png')) ext = '.png';
          else if (item.image_url.includes('.webp')) ext = '.webp';
          const resp = await axios({ method: 'GET', url: item.image_url, responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Referer: 'https://www.pinterest.com/' } });
          archive.append(Buffer.from(resp.data), { name: `${i + 1}${ext}` });
        } catch {}
      }
    });
    await Promise.all(workers);
    await archive.finalize();
  }

  async clearAllCache() {
    const cacheDir = path.join(DATA_DIR, 'pinterest');
    if (!fs.existsSync(cacheDir)) return { success: true, message: 'Nothing to clear.', deletedFilesCount: 0 };
    const files = fs.readdirSync(cacheDir);
    let cnt = 0;
    for (const f of files) { if (f.endsWith('.json') && f !== 'accounts.json') { fs.unlinkSync(path.join(cacheDir, f)); cnt++; } }
    return { success: true, message: `Cleared ${cnt} files.`, deletedFilesCount: cnt };
  }

  // Single Pin operations
  private async getPinDetail(pinId: string) {
    const r = await this.callPinterestApi('PinResource', { id: pinId, field_set_key: 'unauth_react_main_pin' }, 'www/pin/[id].js');
    return r?.data;
  }

  async downloadVideo(url: string, res: Response) {
    const parsed = this.parseUrl(url);
    if (parsed.type !== 'pin' || !parsed.pinId) throw new Error('Provide a pin URL.');
    const pinData = await this.getPinDetail(parsed.pinId);
    if (!pinData) throw new Error('Pin not found');
    const mapped = this.mapPinData(pinData);
    if (!mapped.is_video || !mapped.video_url) throw new Error('No video in this pin.');

    const title = mapped.title || mapped.description || 'pinterest_video';
    const sanitized = this.sanitizeFilename(title).substring(0, 50) || 'pinterest_video';
    const filename = `${sanitized}.mp4`;

    const tempDir = os.tmpdir();
    const rawFile = path.join(tempDir, `pin-${Date.now()}-raw.mp4`);
    const finalFile = path.join(tempDir, `pin-${Date.now()}-final.mp4`);

    const resp = await axios.get(mapped.video_url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Referer: 'https://www.pinterest.com/' } });
    fs.writeFileSync(rawFile, Buffer.from(resp.data));

    const reencode = await this.shouldReencodeVideo(rawFile);
    if (reencode) {
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(rawFile).videoCodec('libx264').audioCodec('aac')
          .outputOptions(['-movflags +faststart', '-preset fast', '-crf 23', '-pix_fmt yuv420p'])
          .save(finalFile).on('end', () => resolve()).on('error', reject);
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(rawFile).outputOptions(['-c copy', '-movflags +faststart'])
          .save(finalFile).on('end', () => resolve()).on('error', reject);
      });
    }
    try { fs.unlinkSync(rawFile); } catch {}

    const stat = fs.statSync(finalFile);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size.toString());
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(finalFile);
    stream.pipe(res);
    res.on('finish', () => { fs.unlink(finalFile, () => {}); });
  }

  async downloadImage(url: string, res: Response) {
    const parsed = this.parseUrl(url);
    if (parsed.type !== 'pin' || !parsed.pinId) throw new Error('Provide a pin URL.');
    const pinData = await this.getPinDetail(parsed.pinId);
    if (!pinData) throw new Error('Pin not found');
    const mapped = this.mapPinData(pinData);
    if (!mapped.image_url) throw new Error('No image in this pin.');

    const title = mapped.title || mapped.description || 'pinterest_image';
    const sanitized = this.sanitizeFilename(title).substring(0, 50) || 'pinterest_image';

    const resp = await axios.get(mapped.image_url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Referer: 'https://www.pinterest.com/' } });
    const ct = String(resp.headers['content-type'] || 'image/jpeg');
    let ext = 'jpg';
    if (ct.includes('png')) ext = 'png';
    else if (ct.includes('webp')) ext = 'webp';
    else if (ct.includes('gif')) ext = 'gif';
    const filename = `${sanitized}.${ext}`;
    const buffer = Buffer.from(resp.data);

    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(buffer);
  }

  async downloadAudio(url: string, res: Response) {
    const parsed = this.parseUrl(url);
    if (parsed.type !== 'pin' || !parsed.pinId) throw new Error('Provide a pin URL.');
    const pinData = await this.getPinDetail(parsed.pinId);
    if (!pinData) throw new Error('Pin not found');
    const mapped = this.mapPinData(pinData);
    if (!mapped.is_video || !mapped.video_url) throw new Error('No video in this pin. Cannot extract audio.');

    const title = mapped.title || mapped.description || 'pinterest_audio';
    const sanitized = this.sanitizeFilename(title).substring(0, 50) || 'pinterest_audio';
    const filename = `${sanitized}.mp3`;

    const tempDir = os.tmpdir();
    const rawFile = path.join(tempDir, `pin-audio-${Date.now()}-raw.mp4`);
    const finalFile = path.join(tempDir, `pin-audio-${Date.now()}-final.mp3`);

    const resp = await axios.get(mapped.video_url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Referer: 'https://www.pinterest.com/' } });
    fs.writeFileSync(rawFile, Buffer.from(resp.data));

    await new Promise<void>((resolve, reject) => {
      Ffmpeg(rawFile).noVideo().audioCodec('libmp3lame').audioBitrate(192)
        .save(finalFile).on('end', () => resolve()).on('error', reject);
    });
    try { fs.unlinkSync(rawFile); } catch {}

    const stat = fs.statSync(finalFile);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size.toString());
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(finalFile);
    stream.pipe(res);
    res.on('finish', () => { fs.unlink(finalFile, () => {}); });
  }

  // OAuth
  getAuthUrl() {
    const clientId = process.env.PINTEREST_CLIENT_ID;
    const redirectUri = process.env.PINTEREST_REDIRECT_URI;
    if (!clientId || !redirectUri) throw new Error('Missing PINTEREST_CLIENT_ID or PINTEREST_REDIRECT_URI');
    const state = Math.random().toString(36).substring(2, 15);
    const scopes = ['pins:read', 'pins:write', 'boards:read', 'user_accounts:read'].join(',');
    const authUrl = `https://www.pinterest.com/oauth/?consumer_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}&state=${state}`;
    return { success: true, url: authUrl, state };
  }

  async handleAuthCallback(code: string) {
    const clientId = process.env.PINTEREST_CLIENT_ID;
    const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
    const redirectUri = process.env.PINTEREST_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) throw new Error('Missing Pinterest OAuth credentials.');

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    const tokenResp = await axios.post(`${PINTEREST_V5_API}/oauth/token`, params, {
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const tokenData = tokenResp.data;
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresAt = Date.now() + (tokenData.expires_in || 2592000) * 1000;

    const userResp = await axios.get(`${PINTEREST_V5_API}/user_account`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const userData = userResp.data;
    const username = userData.username;
    if (!username) throw new Error('Could not retrieve username.');

    const accounts = this.readAccounts();
    const idx = accounts.findIndex(a => a.username === username);
    const newAccount: PinterestAccount = {
      username, fullName: userData.business_name || userData.username,
      avatarUrl: userData.profile_image || null, accessToken, refreshToken, expiresAt, connectedAt: Date.now(),
    };
    if (idx > -1) accounts[idx] = newAccount; else accounts.push(newAccount);
    this.writeAccounts(accounts);

    return { success: true, message: 'Account connected.', account: { username, fullName: newAccount.fullName, avatarUrl: newAccount.avatarUrl, connectedAt: newAccount.connectedAt } };
  }

  getConnectedChannels() {
    const accounts = this.readAccounts();
    return {
      success: true, count: accounts.length,
      channels: accounts.map(a => ({ username: a.username, fullName: a.fullName, avatarUrl: a.avatarUrl, connectedAt: a.connectedAt, expiresAt: a.expiresAt, isExpired: Date.now() >= a.expiresAt })),
    };
  }

  disconnectChannel(username: string) {
    const accounts = this.readAccounts();
    const filtered = accounts.filter(a => a.username !== username);
    if (accounts.length === filtered.length) throw new Error(`Account "${username}" not found.`);
    this.writeAccounts(filtered);
    return { success: true, message: `Account "${username}" disconnected.` };
  }

  async checkTokenStatus(username: string) {
    const accounts = this.readAccounts();
    const account = accounts.find(a => a.username === username);
    if (!account) throw new Error(`Account "${username}" not found.`);
    const isExpired = Date.now() >= account.expiresAt;
    const timeLeftSeconds = Math.max(0, Math.floor((account.expiresAt - Date.now()) / 1000));

    let isWorking = false, errorMessage = '';
    try {
      await axios.get(`${PINTEREST_V5_API}/user_account`, { headers: { Authorization: `Bearer ${account.accessToken}` } });
      isWorking = true;
    } catch (e: any) { errorMessage = e.response?.data?.message || e.message; }

    return { success: true, username, isExpired, timeLeftSeconds, isWorking, errorMessage: isWorking ? null : errorMessage };
  }

  // Helpers
  private readAccounts(): PinterestAccount[] {
    try { if (!fs.existsSync(this.accountsFilePath)) return []; return JSON.parse(fs.readFileSync(this.accountsFilePath, 'utf-8')); } catch { return []; }
  }

  private writeAccounts(accounts: PinterestAccount[]) {
    fs.writeFileSync(this.accountsFilePath, JSON.stringify(accounts, null, 2), 'utf-8');
  }

  private shouldReencodeVideo(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      Ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return resolve(true);
        const vs = metadata?.streams?.find(s => s.codec_type === 'video');
        const as2 = metadata?.streams?.find(s => s.codec_type === 'audio');
        if (!vs) return resolve(true);
        resolve(!(vs.codec_name === 'h264' && (as2 ? as2.codec_name === 'aac' : true) && vs.pix_fmt === 'yuv420p'));
      });
    });
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9\s\-_À-ɏḀ-ỿ]/g, '').trim().replace(/\s+/g, '_');
  }
}

export const pinterestService = new PinterestService();
