import api from '@/config/axios';

export { api };



interface TranscriptItem {
  text: string
  duration: number
  offset: number
  lang: string
}

interface Thumbnail {
  url: string
  width: number
  height: number
}

interface Metadata {
  videoId: string
  title: string
  description: string
  author: string
  channelId: string
  thumbnails: Thumbnail[]
  durationSeconds: number
  viewCount: number
  likeCount: number
  isLive: boolean
  category: string
}

interface TranscriptResponse {
  success: boolean
  videoId: string
  transcript: TranscriptItem[]
  transcriptLanguage: string
  metadata: Metadata
  error?: string
}

interface AudioResponse {
  success: boolean
  videoId: string
  audioUrl?: string
  title?: string
  duration?: number
  error?: string
  blob?: Blob
  format?: string
}

interface AudioToSrtResponse {
  success: boolean
  srtContent?: string
  error?: string
}

interface AudioToScriptResponse {
  success: boolean
  scriptContent?: string
  error?: string
}

interface VideoResponse {
  success: boolean
  videoId: string
  videoUrl?: string
  title?: string
  duration?: number
  quality?: string
  error?: string
  blob?: Blob
}

interface DataUrls {
  id: string
  url: string
  title: string
  view_count: number
  created_at?: string
}
class YouTubeService {
  async getTranscript(videoId: string): Promise<TranscriptResponse> {
    const response = await api.post(`youtube/transcript`, {
      videoId
    })
    return response.data
  }

  async getTranscripts(videoIds: string[]): Promise<TranscriptResponse[]> {
    const response = await api.post(`youtube/transcripts`, {
      videoIds
    })
    return response.data
  }

  async getUrlsAll(url: string): Promise<DataUrls[]> {
    const response = await api.post(`youtube/urls`, {
      url
    })
    return response.data.videos
  }

  async getAudio(url: string): Promise<AudioResponse> {
    try {
      const response = await api.post(
        `youtube/audio`,
        { url },
        {
          responseType: 'blob'
        }
      )

      // Lấy filename từ Content-Disposition header
      const contentDisposition = response.headers['content-disposition']
      let filename = 'audio.m4a'
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i) || contentDisposition.match(/filename="?([^";]+)"?/)
        if (filenameMatch) {
          try {
            filename = decodeURIComponent(filenameMatch[1])
          } catch {
            filename = filenameMatch[1]
          }
        }
      }

      const extMatch = filename.match(/\.(m4a|mp3|wav|ogg|aac|webm|opus)$/i)
      const format = extMatch ? extMatch[1].toLowerCase() : 'm4a'
      const title = filename.replace(/\.[^/.]+$/, '')

      // Trả về blob để download
      return {
        success: true,
        videoId: url,
        blob: response.data,
        title,
        format,
        audioUrl: URL.createObjectURL(response.data)
      }
    } catch (error) {
      return {
        success: false,
        videoId: url,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async downloadImage(imageUrl: string): Promise<Blob> {
    const response = await api.post(
      `youtube/download-image`,
      { imageUrl },
      {
        responseType: 'blob'
      }
    )
    return response.data
  }

  async audioToSrt(file: File): Promise<AudioToSrtResponse> {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await api.post(`youtube/srt`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      return {
        success: true,
        srtContent: response.data
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async audioToScript(file: File): Promise<AudioToScriptResponse> {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await api.post(`youtube/script`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      let scriptContent = ''
      if (typeof response.data === 'string') {
        scriptContent = response.data
      } else if (response.data && typeof response.data === 'object') {
        scriptContent = response.data.script || response.data.text || response.data.scriptContent || JSON.stringify(response.data)
      }

      return {
        success: true,
        scriptContent: scriptContent
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async getVideo(url: string, quality: string): Promise<VideoResponse> {
    try {
      const response = await api.post(
        `youtube/video`,
        { url, quality },
        {
          responseType: 'blob'
        }
      )

      // Lấy filename từ Content-Disposition header
      const contentDisposition = response.headers['content-disposition']
      let filename = 'video.mp4'
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      // Trả về blob để download
      return {
        success: true,
        videoId: url,
        blob: response.data,
        title: filename.replace('.mp4', ''),
        videoUrl: URL.createObjectURL(response.data),
        quality
      }
    } catch (error) {
      return {
        success: false,
        videoId: url,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

}

export const youtubeService = new YouTubeService()

export type {
  TranscriptResponse,
  TranscriptItem,
  Metadata,
  Thumbnail,
  AudioResponse,
  AudioToSrtResponse,
  AudioToScriptResponse,
  VideoResponse
}
