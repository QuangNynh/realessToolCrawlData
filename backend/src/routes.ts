import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { UPLOADS_DIR } from './config';
import { youtubeToolsService } from './youtube-tools.service';
import { instagramService } from './instagram.service';
import { tiktokService } from './tiktok.service';
import { pinterestService } from './pinterest.service';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getMediaJobs } from './media-instance';
import { createMediaProcessor, ProcessedMedia } from './media-processor';
import { mediaOptions } from './media-jobs';

export const apiRouter = Router();

// =================== YouTube Tools (Transcript, Audio, Video, URLs) ===================
apiRouter.post('/youtube/transcript', async (req: Request, res: Response) => {
  try {
    const videoId = req.body.videoId || req.body.url;
    if (typeof videoId !== 'string' || !videoId.trim()) return res.status(400).json({ success: false, message: 'Missing videoId' });
    const result = await youtubeToolsService.getTranscript(videoId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/youtube/transcripts', async (req: Request, res: Response) => {
  const { videoIds } = req.body;
  if (!Array.isArray(videoIds) || !videoIds.length || videoIds.some(id => typeof id !== 'string' || !id.trim())) {
    return res.status(400).json({ success: false, message: 'videoIds phải là danh sách Video ID' });
  }
  try { res.json(await youtubeToolsService.getTranscripts(videoIds)); }
  catch (error: any) { res.status(400).json({ success: false, message: error.message }); }
});

apiRouter.post('/youtube/download-image', async (req: Request, res: Response) => {
  if (typeof req.body.imageUrl !== 'string' || !req.body.imageUrl.trim()) return res.status(400).json({ success: false, message: 'Missing imageUrl' });
  try { await youtubeToolsService.downloadImage(req.body.imageUrl, res); }
  catch (error: any) { if (!res.headersSent) res.status(400).json({ success: false, message: error.message }); }
});

const audioUpload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 500 * 1024 * 1024 } });
const receiveMediaUpload = (req: Request, res: Response, next: NextFunction) => audioUpload.single('file')(req, res, error => {
  if (!error) return next();
  if (req.file) fs.rmSync(req.file.path, { force: true });
  return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? 'File upload tối đa 500 MB' : error.message });
});
for (const kind of ['srt', 'script']) {
  apiRouter.post(`/youtube/${kind}`, receiveMediaUpload, async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      const srt = await youtubeToolsService.audioToSrt(req.file.path, controller.signal);
      const content = kind === 'srt' ? srt : youtubeToolsService.srtToScript(srt);
      const extension = kind === 'srt' ? 'srt' : 'txt';
      const filename = req.file.originalname.replace(/\.[^.]+$/, '') + '.' + extension;
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.type('text/plain').send(content);
    } catch (error: any) { if (!res.headersSent && !res.destroyed) res.status(400).json({ success: false, message: error.message }); }
  });
}

apiRouter.post('/media/extract-audio', receiveMediaUpload, async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Chưa chọn video' });
  const controller = new AbortController();
  let result: ProcessedMedia | undefined;
  const cleanup = () => { result?.cleanup(); fs.rmSync(req.file!.path, { force: true }); };
  res.once('close', () => { if (!res.writableFinished) controller.abort(); cleanup(); });
  try {
    if (!/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpeg|mpg|ts)$/i.test(req.file.originalname)) throw new Error('Định dạng video không hợp lệ');
    const options = mediaOptions({ format: req.body.format, bitrate: req.body.bitrate });
    result = await createMediaProcessor(getMediaJobs().runtime)(req.file.path, { id: 'upload', tool: 'extract', createdAt: new Date().toISOString(), directory: os.tmpdir(), paused: false, items: [], options }, { id: 'upload', name: req.file.originalname, bytes: req.file.size, status: 'running' }, controller.signal, () => {});
    if (controller.signal.aborted) throw new Error('Đã hủy xử lý');
    const filename = path.basename(req.file.originalname, path.extname(req.file.originalname)) + '.' + options.format;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.type({ mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg' }[options.format]);
    res.sendFile(result.path, error => { cleanup(); if (error && !res.headersSent) res.status(400).json({ success: false, message: error.message }); });
  } catch (error) { cleanup(); if (!res.headersSent && !res.destroyed) res.status(400).json({ success: false, message: error instanceof Error ? error.message : String(error) }); }
});

apiRouter.post('/youtube/audio/youtubei', async (req: Request, res: Response) => {
  const { url, format = 'mp3' } = req.body;
  if (typeof url !== 'string' || !url.trim() || !['mp3', 'm4a'].includes(format)) return res.status(400).json({ success: false, message: 'URL hoặc định dạng audio không hợp lệ' });
  try { await youtubeToolsService.downloadAudioYoutubei(url, res, format); }
  catch (error: any) { if (!res.headersSent) res.status(400).json({ success: false, message: error.message }); }
});

apiRouter.post('/youtube/audio', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await youtubeToolsService.streamAudio(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/youtube/video', async (req: Request, res: Response) => {
  try {
    const { url, quality } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await youtubeToolsService.streamVideo(url, res, quality);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/youtube/urls', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    const result = await youtubeToolsService.getChannelVideos(url);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// =================== Instagram API ===================
apiRouter.post('/instagram/info', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    res.json(await instagramService.getVideoInfo(url));
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/instagram/channel', async (req: Request, res: Response) => {
  try {
    const username = req.body.username || req.body.url;
    if (!username) return res.status(400).json({ success: false, message: 'Missing username' });
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 10;
    if (!Number.isInteger(page) || !Number.isInteger(pageSize)) return res.status(400).json({ success: false, message: 'Invalid pagination' });
    const userAgent = req.get('User-Agent');
    res.json(await instagramService.getChannelVideos(
      username,
      req.query.type as string | undefined,
      page,
      pageSize,
      undefined,
      userAgent && userAgent.length <= 512 && !/[\r\n]/.test(userAgent) ? userAgent : undefined
    ));
  } catch (error: any) {
    if (error.statusCode === 429 && error.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
      ...(error.statusCode === 429 ? { retryAfterSeconds: error.retryAfterSeconds, stage: error.stage, sessionConnected: instagramService.hasSession() } : {}),
    });
  }
});

apiRouter.post('/instagram/channel/export', async (req: Request, res: Response) => {
  try {
    const username = req.body.username || req.body.url;
    if (!username) return res.status(400).json({ success: false, message: 'Missing username' });
    await instagramService.exportChannelVideosToExcel(username, res, req.query.type as string | undefined);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/instagram/channel/export-images', async (req: Request, res: Response) => {
  try {
    const username = req.body.username || req.body.url;
    if (!username) return res.status(400).json({ success: false, message: 'Missing username' });
    await instagramService.exportChannelImagesToZip(username, res, req.query.type as string | undefined);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/instagram/channel/clear-cache', async (_req: Request, res: Response) => {
  try {
    res.json(await instagramService.clearAllChannelCache());
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/instagram/video', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await instagramService.downloadVideo(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/instagram/audio', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await instagramService.downloadAudio(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

// =================== TikTok API ===================
apiRouter.post('/tiktok/channel-videos', async (req: Request, res: Response) => {
  try {
    const { url, limit } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    const result = await tiktokService.getChannelVideos(url, limit);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/tiktok/video', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await tiktokService.downloadVideo(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/tiktok/audio', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await tiktokService.downloadAudio(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

// =================== Pinterest API ===================
apiRouter.post('/pinterest/channel', async (req: Request, res: Response) => {
  try {
    const { url, type, page, pageSize } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    const result = await pinterestService.getChannelPins(url, type, page, pageSize);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/pinterest/channel/export', async (req: Request, res: Response) => {
  try {
    const { url, type } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await pinterestService.exportChannelToExcel(url, res, type);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/pinterest/channel/export-images', async (req: Request, res: Response) => {
  try {
    const { url, type } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await pinterestService.exportImagesToZip(url, res, type);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/pinterest/channel/clear-cache', async (req: Request, res: Response) => {
  try {
    const result = await pinterestService.clearAllCache();
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/pinterest/video', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await pinterestService.downloadVideo(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/pinterest/image', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await pinterestService.downloadImage(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/pinterest/audio', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url' });
    await pinterestService.downloadAudio(url, res);
  } catch (error: any) {
    if (!res.headersSent) res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.get('/pinterest/auth/url', (req: Request, res: Response) => {
  try {
    const result = pinterestService.getAuthUrl();
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.post('/pinterest/auth/callback', async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Missing code' });
    const result = await pinterestService.handleAuthCallback(code);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.get('/pinterest/accounts', (req: Request, res: Response) => {
  try {
    const result = pinterestService.getConnectedChannels();
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

apiRouter.delete('/pinterest/accounts/:username', (req: Request, res: Response) => {
  try {
    const result = pinterestService.disconnectChannel(req.params.username);
    res.json(result);
  } catch (error: any) {
    res.status(404).json({ success: false, message: error.message });
  }
});

apiRouter.get('/pinterest/accounts/:username/check-token', async (req: Request, res: Response) => {
  try {
    const result = await pinterestService.checkTokenStatus(req.params.username);
    res.json(result);
  } catch (error: any) {
    res.status(404).json({ success: false, message: error.message });
  }
});

// Keep upload validation errors in the same JSON contract as the API.
apiRouter.use((error: any, _req: Request, res: Response, next: import('express').NextFunction) => {
  if (res.headersSent) return next(error);
  res.status(400).json({ success: false, message: error.message });
});
