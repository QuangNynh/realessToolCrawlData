import { api } from './youtube.service';
import axios from 'axios';

export interface TikTokResponse {
  success: boolean;
  videoUrl?: string;
  audioUrl?: string;
  title?: string;
  error?: string;
  blob?: Blob;
}

export interface TikTokChannelVideo {
  id: string;
  url: string;
  title: string;
  description?: string;
  duration?: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  repost_count: number;
  save_count: number;
  created_at: string | null;
  uploader: string | null;
  uploader_id: string | null;
  thumbnails: any[];
}

export interface TikTokChannelResponse {
  success: boolean;
  channel?: string;
  video_count?: number;
  videos?: TikTokChannelVideo[];
  error?: string;
}

class TikTokService {
  async getChannelVideos(url: string, limit?: number): Promise<TikTokChannelResponse> {
    try {
      const response = await api.post('/tiktok/channel-videos', { url, limit });
      const data = response.data;

      if (Array.isArray(data)) {
        return { success: true, videos: data };
      }

      return {
        success: data?.success ?? true,
        channel: data?.channel,
        video_count: data?.video_count,
        videos: data?.videos || data?.data || [],
        error: data?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: axios.isAxiosError(error) && typeof error.response?.data?.message === 'string'
          ? error.response.data.message
          : error instanceof Error ? error.message : 'Không thể lấy danh sách kênh TikTok',
      };
    }
  }

  async getAudio(url: string): Promise<TikTokResponse> {
    try {
      const response = await api.post('/tiktok/audio', { url }, { responseType: 'blob' });

      const contentDisposition = response.headers['content-disposition'];
      let filename = 'tiktok_audio.mp3';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) filename = filenameMatch[1];
      }

      return {
        success: true,
        blob: response.data,
        title: filename.replace('.mp3', ''),
        audioUrl: URL.createObjectURL(response.data),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getVideo(url: string): Promise<TikTokResponse> {
    try {
      const response = await api.post('/tiktok/video', { url }, { responseType: 'blob' });

      const contentDisposition = response.headers['content-disposition'];
      let filename = 'tiktok_video.mp4';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) filename = filenameMatch[1];
      }

      return {
        success: true,
        blob: response.data,
        title: filename.replace('.mp4', ''),
        videoUrl: URL.createObjectURL(response.data),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const tiktokService = new TikTokService();
