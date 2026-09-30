import axios from 'axios'
import { api } from './youtube.service'

export interface InstagramInfoResponse {
  success: boolean
  title: string
  username: string
  fullname: string
  likes: number
  isVerified: boolean
  videoUrl: string
  thumbnailUrl: string
  width: number
  height: number
  views: number
  resultsNumber: number
  error?: string
}

export interface InstagramAudioResponse {
  success: boolean
  audioUrl?: string
  title?: string
  error?: string
  blob?: Blob
}

export interface InstagramVideoResponse {
  success: boolean
  videoUrl?: string
  title?: string
  error?: string
  blob?: Blob
}

class InstagramService {
  private async syncSession(): Promise<void> {
    await window.instagramDesktop?.sync()
  }

  async getInfo(url: string): Promise<InstagramInfoResponse> {
    await this.syncSession()
    const response = await api.post(
      '/instagram/info',
      { url }
    )
    return response.data
  }

  async getAudio(url: string): Promise<InstagramAudioResponse> {
    try {
      await this.syncSession()
      const response = await api.post(
        '/instagram/audio',
        { url },
        {
          responseType: 'blob'
        }
      )

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers['content-disposition']
      let filename = 'audio.mp3'
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      return {
        success: true,
        blob: response.data,
        title: filename.replace('.mp3', ''),
        audioUrl: URL.createObjectURL(response.data)
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async getVideo(url: string): Promise<InstagramVideoResponse> {
    try {
      await this.syncSession()
      const response = await api.post(
        '/instagram/video',
        { url },
        {
          responseType: 'blob'
        }
      )

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers['content-disposition']
      let filename = 'video.mp4'
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      return {
        success: true,
        blob: response.data,
        title: filename.replace('.mp4', ''),
        videoUrl: URL.createObjectURL(response.data)
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async getChannel(username: string, type?: string, page?: number, pageSize?: number): Promise<InstagramChannelResponse> {
    try {
      await this.syncSession()
      const response = await api.post(
        '/instagram/channel',
        { username },
        { params: { type, page, pageSize } }
      )
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        const requestError = new Error(error.response.data.message) as Error & { statusCode?: number; retryAfterSeconds?: number; stage?: string; sessionConnected?: boolean }
        requestError.statusCode = error.response.status
        requestError.retryAfterSeconds = Number(error.response.data.retryAfterSeconds) || undefined
        requestError.stage = error.response.data.stage
        requestError.sessionConnected = error.response.data.sessionConnected
        throw requestError
      }
      throw error
    }
  }

  async exportChannelExcel(username: string, type?: string): Promise<{ blob: Blob; filename: string }> {
    const response = await api.post(
      '/instagram/channel/export',
      { username },
      {
        params: { type },
        responseType: 'blob'
      }
    )

    const contentDisposition = response.headers['content-disposition']
    let filename = `instagram_export_${username}_${Date.now()}.xlsx`
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+)"/)
      if (filenameMatch) {
        filename = filenameMatch[1]
      }
    }

    return {
      blob: response.data,
      filename
    }
  }

  async exportChannelImagesZip(username: string, type?: string): Promise<{ blob: Blob; filename: string }> {
    const response = await api.post(
      '/instagram/channel/export-images',
      { username },
      {
        params: { type },
        responseType: 'blob'
      }
    )

    const contentDisposition = response.headers['content-disposition']
    let filename = `instagram_images_${username}_${Date.now()}.zip`
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+)"/)
      if (filenameMatch) {
        filename = filenameMatch[1]
      }
    }

    return {
      blob: response.data,
      filename
    }
  }

  async clearCache(): Promise<{ success: boolean; message: string; deletedFilesCount: number }> {
    const response = await api.post(
      '/instagram/channel/clear-cache'
    )
    return response.data
  }
}

export interface InstagramChannelUser {
  username: string
  fullname: string
  profilePicUrl: string
  id: string
  followersCount?: number
  followingCount?: number
}

export interface InstagramChannelItem {
  id: string
  shortcode: string
  type: 'image' | 'video' | 'carousel'
  title: string
  videoUrl: string | null
  thumbnailUrl: string
  likes: number
  comments: number
  views: number
  takenAt: number
}

export interface InstagramChannelResponse {
  success: boolean
  user?: InstagramChannelUser
  items?: InstagramChannelItem[]
  pagination?: {
    page: number
    pageSize: number
    totalCount: number
    hasMore: boolean
    loadedCount?: number
    incompletePage?: boolean
    retryAfterSeconds?: number
  }
  error?: string
}

export const instagramService = new InstagramService()
