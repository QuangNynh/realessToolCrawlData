import path from 'path';
import { DATA_DIR } from './config';
import { YouTubeDownloadQueue } from './youtube-download-queue';
import { youtubeToolsService } from './youtube-tools.service';

export const youtubeDownloads = new YouTubeDownloadQueue(path.join(DATA_DIR, 'youtube-downloads'),
  (batch, item, workspace, signal, progress) => youtubeToolsService.prepareMedia(item.videoUrl, batch.kind, workspace, batch.quality, signal, progress));
