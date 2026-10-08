import { api } from './youtube.service';
import { TIMEOUT_DOWNLOAD, TIMEOUT_SCAN } from '@/config/axios';

export interface PinterestChannelUser {
  username: string;
  full_name: string;
  id: string;
  follower_count: number;
  pin_count: number;
}

export interface PinterestChannelItem {
  id: string;
  title: string | null;
  description: string | null;
  type: 'image' | 'video';
  is_video: boolean;
  pin_url: string;
  link: string | null;
  domain: string;
  created_at: string;
  takenAt: number;
  comment_count: number;
  like_count?: number;
  repin_count: number;
  save_count: number;
  image_url: string;
  video_url: string | null;
  pinner?: {
    username: string;
    full_name: string;
    id: string;
  };
  board?: {
    name: string;
    url: string;
  } | null;
}

export interface PinterestChannelResponse {
  success: boolean;
  user?: PinterestChannelUser;
  items?: PinterestChannelItem[];
  pagination?: {
    page: number;
    pageSize: number;
    totalCount: number;
    hasMore: boolean;
  };
  error?: string;
}

export interface PinterestAudioResponse {
  success: boolean;
  audioUrl?: string;
  title?: string;
  error?: string;
  blob?: Blob;
}

export interface PinterestVideoResponse {
  success: boolean;
  videoUrl?: string;
  title?: string;
  error?: string;
  blob?: Blob;
}

export interface PinterestImageResponse {
  success: boolean;
  imageUrl?: string;
  title?: string;
  error?: string;
  blob?: Blob;
}

export interface PinterestAccountItem {
  username: string;
  fullName: string;
  avatarUrl: string;
  connectedAt: number;
  expiresAt?: number;
  isExpired?: boolean;
}

export interface GetConnectedAccountsResponse {
  success: boolean;
  count: number;
  channels: PinterestAccountItem[];
  message?: string;
}

export interface AuthUrlResponse {
  success: boolean;
  url: string;
  state: string;
}

export interface AuthCallbackResponse {
  success: boolean;
  message: string;
  account?: {
    username: string;
    fullName: string;
    avatarUrl: string;
    connectedAt: number;
  };
  error?: string;
}

export interface CheckTokenResponse {
  success: boolean;
  username: string;
  isExpired: boolean;
  timeLeftSeconds: number;
  isWorking: boolean;
  errorMessage: string | null;
}

class PinterestService {
  async getChannel(url: string, type?: string, page?: number, pageSize?: number): Promise<PinterestChannelResponse> {
    const response = await api.post('/pinterest/channel', { url, type, page, pageSize }, { timeout: TIMEOUT_SCAN });
    return response.data;
  }

  async getAudio(url: string): Promise<PinterestAudioResponse> {
    try {
      const response = await api.post('/pinterest/audio', { url }, { responseType: 'blob', timeout: TIMEOUT_DOWNLOAD });

      const contentDisposition = response.headers['content-disposition'];
      let filename = 'pinterest_audio.mp3';
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

  async getVideo(url: string): Promise<PinterestVideoResponse> {
    try {
      const response = await api.post('/pinterest/video', { url }, { responseType: 'blob', timeout: TIMEOUT_DOWNLOAD });

      const contentDisposition = response.headers['content-disposition'];
      let filename = 'pinterest_video.mp4';
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

  async getImage(url: string): Promise<PinterestImageResponse> {
    try {
      const response = await api.post('/pinterest/image', { url }, { responseType: 'blob', timeout: TIMEOUT_DOWNLOAD });

      const contentDisposition = response.headers['content-disposition'];
      let filename = 'pinterest_image.jpg';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) filename = filenameMatch[1];
      }

      return {
        success: true,
        blob: response.data,
        title: filename.replace(/\.(jpg|png|jpeg|webp)/i, ''),
        imageUrl: URL.createObjectURL(response.data),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async exportChannelExcel(url: string, type?: string): Promise<{ blob: Blob; filename: string }> {
    const response = await api.post('/pinterest/channel/export', { url, type }, { responseType: 'blob', timeout: TIMEOUT_SCAN });

    const contentDisposition = response.headers['content-disposition'];
    let filename = `pinterest_export_${Date.now()}.xlsx`;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      if (filenameMatch) filename = filenameMatch[1];
    }

    return { blob: response.data, filename };
  }

  async exportChannelImagesZip(url: string, type?: string): Promise<{ blob: Blob; filename: string }> {
    const response = await api.post('/pinterest/channel/export-images', { url, type }, { responseType: 'blob', timeout: TIMEOUT_DOWNLOAD });

    const contentDisposition = response.headers['content-disposition'];
    let filename = `pinterest_images_${Date.now()}.zip`;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      if (filenameMatch) filename = filenameMatch[1];
    }

    return { blob: response.data, filename };
  }

  async clearCache(): Promise<{ success: boolean; message: string; deletedFilesCount: number }> {
    const response = await api.post('/pinterest/channel/clear-cache');
    return response.data;
  }

  async getAuthUrl(): Promise<AuthUrlResponse> {
    const response = await api.get('/pinterest/auth/url');
    return response.data;
  }

  async submitAuthCallback(code: string): Promise<AuthCallbackResponse> {
    const response = await api.post('/pinterest/auth/callback', { code });
    return response.data;
  }

  async getConnectedAccounts(): Promise<GetConnectedAccountsResponse> {
    const response = await api.get('/pinterest/accounts');
    return response.data;
  }

  async disconnectAccount(username: string): Promise<{ success: boolean; message: string }> {
    const response = await api.delete(`/pinterest/accounts/${username}`);
    return response.data;
  }

  async checkAccountToken(username: string): Promise<CheckTokenResponse> {
    const response = await api.get(`/pinterest/accounts/${username}/check-token`);
    return response.data;
  }
}

export const pinterestService = new PinterestService();
