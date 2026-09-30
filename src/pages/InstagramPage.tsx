import { useSearchParams } from 'react-router-dom'
import { DataTable } from '@/components/common/data-table'
import { Button } from '@/components/youtube-ui/button'
import { Card } from '@/components/youtube-ui/card'
import { Input } from '@/components/youtube-ui/input'
import { Progress } from '@/components/youtube-ui/progress'
import { Textarea } from '@/components/youtube-ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/youtube-ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/youtube-ui/select'
import {
  instagramService,
  type InstagramChannelItem,
  type InstagramChannelResponse
} from '@/services/instagram.service'
import type { ColumnDef } from '@tanstack/react-table'
import * as XLSX from 'xlsx'
import {
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  XCircle,
  Instagram,
  Download,
  BadgeCheck,
  Video,
  ListRestart,
  Copy,
  FileText,
  FileSpreadsheet
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'

type AudioStatus = 'pending' | 'loading' | 'success' | 'failed'

interface AudioDataItem {
  videoUrl: string
  status: AudioStatus
  progress: number
  audioUrl?: string
  title?: string
  error?: string
}

interface BulkInfoItem {
  videoUrl: string
  status: AudioStatus
  progress: number
  title?: string
  username?: string
  fullname?: string
  likes?: number
  isVerified?: boolean
  thumbnailUrl?: string
  views?: number
  error?: string
  downloading?: boolean
  downloadProgress?: number
}

export const InstagramPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'bulk' ? 'bulk' : 'bulk-video'
  const [hasInstagramSession, setHasInstagramSession] = useState(false)
  const [isConnectingInstagram, setIsConnectingInstagram] = useState(false)

  useEffect(() => {
    void window.instagramDesktop?.status().then((result) => setHasInstagramSession(result.connected)).catch(() => {})
  }, [])

  const handleInstagramConnection = async (disconnect = false) => {
    if (!window.instagramDesktop) return
    setIsConnectingInstagram(true)
    try {
      const result = disconnect
        ? await window.instagramDesktop.disconnect()
        : await window.instagramDesktop.connect()
      setHasInstagramSession(result.connected)
      if (result.connected) toast.success('Đã lưu phiên đăng nhập Instagram trong desktop')
      else if (disconnect) toast.success('Đã ngắt kết nối Instagram')
      else toast.info('Chưa kết nối Instagram')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể kết nối Instagram')
    } finally {
      setIsConnectingInstagram(false)
    }
  }

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val }, { replace: true })
  }
  // Tab 1: Channel Info state
  const [channelInputText, setChannelInputText] = useState('')
  const [channelLoading, setChannelLoading] = useState(false)
  const [channelData, setChannelData] = useState<InstagramChannelResponse | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video' | 'carousel'>('all')
  const [channelPagination, setChannelPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [channelRowLoading, setChannelRowLoading] = useState<Record<string, { audio?: boolean; video?: boolean; image?: boolean }>>({})
  const [scanTrigger, setScanTrigger] = useState(0)
  const [channelRetryUntil, setChannelRetryUntil] = useState<number | null>(null)
  const [channelRetryNow, setChannelRetryNow] = useState(Date.now())
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [isExportingImages, setIsExportingImages] = useState(false)

  // Tab 2: Bulk Info state
  const [bulkInfoUrlText, setBulkInfoUrlText] = useState('')
  const [isBulkInfoFormatted, setIsBulkInfoFormatted] = useState(false)
  const [isProcessingInfo, setIsProcessingInfo] = useState(false)
  const [bulkInfoData, setBulkInfoData] = useState<BulkInfoItem[]>([])
  const [infoPagination, setInfoPagination] = useState({ pageIndex: 0, pageSize: 50 })

  // Tab 3: Bulk Video Download state
  const [videoUrlText, setVideoUrlText] = useState('')
  const [isVideoFormatted, setIsVideoFormatted] = useState(false)
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)
  const [videoDownloadData, setVideoDownloadData] = useState<AudioDataItem[]>([])
  const [videoPagination, setVideoPagination] = useState({ pageIndex: 0, pageSize: 50 })

  // Tab 4: Bulk Download state
  const [urlText, setUrlText] = useState('')
  const [isFormatted, setIsFormatted] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [audioData, setAudioData] = useState<AudioDataItem[]>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 })

  const formatUrls = () => {
    if (!urlText.trim()) {
      toast.error('Please enter URLs')
      return
    }

    const urls = urlText
      .split(/[\s,\n\t]+/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    const formattedUrls = urls.join(', ')
    setUrlText(formattedUrls)
    setIsFormatted(true)
    toast.success('URLs formatted successfully')
  }

  const formatBulkInfoUrls = () => {
    if (!bulkInfoUrlText.trim()) {
      toast.error('Vui lòng nhập danh sách URLs')
      return
    }

    const urls = bulkInfoUrlText
      .split(/[\s,\n\t]+/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    const formattedUrls = urls.join(', ')
    setBulkInfoUrlText(formattedUrls)
    setIsBulkInfoFormatted(true)
    toast.success('Định dạng URL thành công')
  }

  const formatVideoUrls = () => {
    if (!videoUrlText.trim()) {
      toast.error('Please enter URLs')
      return
    }

    const urls = videoUrlText
      .split(/[\s,\n\t]+/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    const formattedUrls = urls.join(', ')
    setVideoUrlText(formattedUrls)
    setIsVideoFormatted(true)
    toast.success('URLs formatted successfully')
  }

  const updateItemStatus = (
    videoUrl: string,
    updates: Partial<Omit<AudioDataItem, 'videoUrl'>>
  ) => {
    setAudioData((prev) =>
      prev.map((item) => (item.videoUrl === videoUrl ? { ...item, ...updates } : item))
    )
  }

  const downloadAudioFile = (audioUrl: string, filename: string, blob?: Blob) => {
    try {
      const link = document.createElement('a')
      link.href = audioUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      setTimeout(() => {
        if (blob) {
          URL.revokeObjectURL(audioUrl)
        }
      }, 100)
    } catch (error) {
      console.error('Download failed:', error)
      toast.error('Failed to download audio file')
    }
  }

  const handleGetChannel = () => {
    if (!channelInputText.trim()) {
      toast.error('Vui lòng nhập link kênh hoặc username Instagram')
      return
    }

    setChannelData(null)
    setChannelRetryUntil(null)
    setTypeFilter('all')
    setChannelPagination({ pageIndex: 0, pageSize: 20 })
    setScanTrigger((prev) => prev + 1)
  }

  const handleTypeChange = (value: string) => {
    const newType = value as 'all' | 'image' | 'video' | 'carousel'
    setTypeFilter(newType)
    setChannelPagination({ pageIndex: 0, pageSize: 20 })
  }

  const handleClearCache = async () => {
    setIsClearingCache(true)
    try {
      const response = await instagramService.clearCache()
      if (response.success) {
        toast.success(response.message || `Đã xóa thành công ${response.deletedFilesCount} file cache.`)
      } else {
        toast.error('Không thể xóa bộ nhớ đệm.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lỗi khi xóa bộ nhớ đệm')
    } finally {
      setIsClearingCache(false)
    }
  }

  useEffect(() => {
    if (scanTrigger === 0) return
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retries = 0

    const scheduleRetry = (seconds: number) => {
      if (retries >= 1) return false
      retries++
      const delay = Math.max(1, seconds) * 1000 + 1000
      setChannelRetryNow(Date.now())
      setChannelRetryUntil(Date.now() + delay)
      retryTimer = setTimeout(() => {
        if (active) void fetchChannel()
      }, delay)
      return true
    }

    const fetchChannel = async () => {
      if (!active) return
      setChannelLoading(true)
      try {
        const data = await instagramService.getChannel(
          channelInputText,
          typeFilter === 'all' ? undefined : typeFilter,
          channelPagination.pageIndex + 1, // Convert 0-indexed page to 1-indexed for the API
          channelPagination.pageSize
        )
        if (!active) return
        if (data.success) {
          setChannelData(data)
          if (data.pagination?.incompletePage && data.pagination.retryAfterSeconds && !data.items?.length && scheduleRetry(data.pagination.retryAfterSeconds)) return
          setChannelRetryUntil(null)
        } else {
          toast.error(data.error || 'Không thể lấy thông tin kênh')
        }
      } catch (error) {
        if (!active) return
        const limitedError = error as Error & { statusCode?: number; retryAfterSeconds?: number; sessionConnected?: boolean }
        if (limitedError.statusCode === 429 && limitedError.sessionConnected !== false && limitedError.retryAfterSeconds && scheduleRetry(limitedError.retryAfterSeconds)) return
        setChannelRetryUntil(null)
        toast.error(error instanceof Error ? error.message : 'Lỗi khi tải dữ liệu kênh')
      } finally {
        if (active) setChannelLoading(false)
      }
    }

    void fetchChannel()
    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [scanTrigger, typeFilter, channelPagination.pageIndex, channelPagination.pageSize])

  useEffect(() => {
    if (!channelRetryUntil) return
    const interval = setInterval(() => setChannelRetryNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [channelRetryUntil])

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '-'
    const date = new Date(timestamp * 1000)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    return `${day}/${month}/${year}`
  }

  const handleExportChannelExcel = async () => {
    if (!channelInputText.trim() || !channelData) {
      toast.error('Không có dữ liệu kênh để xuất')
      return
    }

    setChannelLoading(true)
    try {
      const typeParam = typeFilter === 'all' ? undefined : typeFilter
      const response = await instagramService.exportChannelExcel(channelInputText, typeParam)

      const blobUrl = URL.createObjectURL(response.blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = response.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)

      toast.success('Đã xuất file Excel kênh thành công!')
    } catch (error) {
      console.error(error)
      toast.error('Không thể xuất file Excel kênh')
    } finally {
      setChannelLoading(false)
    }
  }

  const handleExportChannelImages = async () => {
    if (!channelInputText.trim() || !channelData) {
      toast.error('Không có dữ liệu kênh để tải ảnh')
      return
    }

    setIsExportingImages(true)
    try {
      const typeParam = typeFilter === 'all' ? undefined : typeFilter
      const response = await instagramService.exportChannelImagesZip(channelInputText, typeParam)

      const blobUrl = URL.createObjectURL(response.blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = response.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)

      toast.success('Đã tải bộ ảnh bài viết dạng file ZIP thành công!')
    } catch (error) {
      console.error(error)
      toast.error('Không thể tải bộ ảnh bài viết')
    } finally {
      setIsExportingImages(false)
    }
  }

  const handleDownloadChannelAudio = async (shortcode: string, index: number) => {
    setChannelRowLoading((prev) => ({ ...prev, [shortcode]: { ...prev[shortcode], audio: true } }))
    try {
      const response = await instagramService.getAudio(shortcode)
      if (response.success && response.audioUrl) {
        const filename = `${index}.mp3`
        downloadAudioFile(response.audioUrl, filename, response.blob)
        toast.success(`Đã tải audio: ${filename}`)
      } else {
        toast.error(response.error || 'Failed to download audio')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed')
    } finally {
      setChannelRowLoading((prev) => ({ ...prev, [shortcode]: { ...prev[shortcode], audio: false } }))
    }
  }

  const handleDownloadChannelVideo = async (shortcode: string, index: number) => {
    setChannelRowLoading((prev) => ({ ...prev, [shortcode]: { ...prev[shortcode], video: true } }))
    try {
      const response = await instagramService.getVideo(shortcode)
      if (response.success && response.videoUrl) {
        const filename = `${index}.mp4`
        downloadAudioFile(response.videoUrl, filename, response.blob)
        toast.success(`Đã tải video: ${filename}`)
      } else {
        toast.error(response.error || 'Failed to download video')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed')
    } finally {
      setChannelRowLoading((prev) => ({ ...prev, [shortcode]: { ...prev[shortcode], video: false } }))
    }
  }

  const handleDownloadChannelImage = async (url: string, shortcode: string, index: number) => {
    setChannelRowLoading((prev) => ({ ...prev, [shortcode]: { ...prev[shortcode], image: true } }))
    try {
      const filename = `${index}.jpg`
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
      toast.success(`Đã tải ảnh: ${filename}`)
    } catch {
      window.open(url, '_blank')
    } finally {
      setChannelRowLoading((prev) => ({ ...prev, [shortcode]: { ...prev[shortcode], image: false } }))
    }
  }

  const handleGetAudioBulk = async () => {
    if (!urlText.trim()) {
      toast.error('Please enter URLs')
      return
    }

    if (!isFormatted) {
      toast.error('Please format URLs first')
      return
    }

    const urls = urlText
      .split(/[\s,\n\t]+/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    if (urls.length === 0) {
      toast.error('No valid Instagram URLs/Shortcodes found')
      return
    }

    const initialData: AudioDataItem[] = urls.map((url) => ({
      videoUrl: url,
      status: 'pending',
      progress: 0
    }))
    setAudioData(initialData)
    setIsProcessing(true)

    let successCount = 0

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      const index = i + 1

      try {
        updateItemStatus(url, { status: 'loading', progress: 0 })

        const progressInterval = setInterval(() => {
          setAudioData((prev) =>
            prev.map((item) => {
              if (item.videoUrl === url && item.status === 'loading') {
                const newProgress = Math.min(item.progress + 15, 90)
                return { ...item, progress: newProgress }
              }
              return item
            })
          )
        }, 300)

        const response = await instagramService.getAudio(url)
        clearInterval(progressInterval)

        if (response.success && response.audioUrl) {
          updateItemStatus(url, {
            status: 'success',
            progress: 100,
            audioUrl: response.audioUrl,
            title: response.title || `Instagram Audio ${index}`
          })

          const filename = `${index}.mp3`
          downloadAudioFile(response.audioUrl, filename, response.blob)
          successCount++
          toast.success(`Downloaded: ${filename}`)
        } else {
          updateItemStatus(url, {
            status: 'failed',
            progress: 0,
            error: response.error || 'Unknown error'
          })
        }
      } catch (error) {
        updateItemStatus(url, {
          status: 'failed',
          progress: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    setIsProcessing(false)
    toast.success(`Completed: ${successCount}/${urls.length} audio files downloaded`)
  }

  const handleGetVideoBulk = async () => {
    if (!videoUrlText.trim()) {
      toast.error('Please enter URLs')
      return
    }

    if (!isVideoFormatted) {
      toast.error('Please format URLs first')
      return
    }

    const urls = videoUrlText
      .split(/[\s,\n\t]+/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    if (urls.length === 0) {
      toast.error('No valid Instagram URLs/Shortcodes found')
      return
    }

    const initialData: AudioDataItem[] = urls.map((url) => ({
      videoUrl: url,
      status: 'pending',
      progress: 0
    }))
    setVideoDownloadData(initialData)
    setIsProcessingVideo(true)

    let successCount = 0

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      const index = i + 1

      try {
        setVideoDownloadData((prev) =>
          prev.map((item) => (item.videoUrl === url ? { ...item, status: 'loading', progress: 0 } : item))
        )

        const progressInterval = setInterval(() => {
          setVideoDownloadData((prev) =>
            prev.map((item) => {
              if (item.videoUrl === url && item.status === 'loading') {
                const newProgress = Math.min(item.progress + 15, 90)
                return { ...item, progress: newProgress }
              }
              return item
            })
          )
        }, 300)

        const response = await instagramService.getVideo(url)
        clearInterval(progressInterval)

        if (response.success && response.videoUrl) {
          setVideoDownloadData((prev) =>
            prev.map((item) =>
              item.videoUrl === url
                ? {
                    ...item,
                    status: 'success',
                    progress: 100,
                    audioUrl: response.videoUrl,
                    title: response.title || `Instagram Video ${index}`
                  }
                : item
            )
          )

          const filename = `${index}.mp4`
          downloadAudioFile(response.videoUrl, filename, response.blob)
          successCount++
          toast.success(`Downloaded: ${filename}`)
        } else {
          setVideoDownloadData((prev) =>
            prev.map((item) =>
              item.videoUrl === url
                ? { ...item, status: 'failed', progress: 0, error: response.error || 'Unknown error' }
                : item
            )
          )
        }
      } catch (error) {
        setVideoDownloadData((prev) =>
          prev.map((item) =>
            item.videoUrl === url
              ? {
                  ...item,
                  status: 'failed',
                  progress: 0,
                  error: error instanceof Error ? error.message : 'Unknown error'
                }
              : item
          )
        )
      }
    }

    setIsProcessingVideo(false)
    toast.success(`Completed: ${successCount}/${urls.length} video files downloaded`)
  }

  const handleGetInfoBulk = async () => {
    if (!bulkInfoUrlText.trim()) {
      toast.error('Vui lòng nhập danh sách URLs')
      return
    }

    if (!isBulkInfoFormatted) {
      toast.error('Vui lòng định dạng URLs trước')
      return
    }

    const urls = bulkInfoUrlText
      .split(/[\s,\n\t]+/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    if (urls.length === 0) {
      toast.error('Không tìm thấy Instagram URLs/Shortcodes nào hợp lệ')
      return
    }

    const initialData: BulkInfoItem[] = urls.map((url) => ({
      videoUrl: url,
      status: 'pending',
      progress: 0
    }))
    setBulkInfoData(initialData)
    setIsProcessingInfo(true)

    let successCount = 0

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]

      try {
        setBulkInfoData((prev) =>
          prev.map((item) => (item.videoUrl === url ? { ...item, status: 'loading' } : item))
        )

        const data = await instagramService.getInfo(url)

        if (data.success) {
          setBulkInfoData((prev) =>
            prev.map((item) =>
              item.videoUrl === url
                ? {
                    ...item,
                    status: 'success',
                    title: data.title,
                    username: data.username,
                    fullname: data.fullname,
                    likes: data.likes,
                    isVerified: data.isVerified,
                    thumbnailUrl: data.thumbnailUrl,
                    views: data.views
                  }
                : item
            )
          )
          successCount++
        } else {
          setBulkInfoData((prev) =>
            prev.map((item) =>
              item.videoUrl === url
                ? { ...item, status: 'failed', error: item.error || 'Failed to fetch info' }
                : item
            )
          )
        }
      } catch (error) {
        setBulkInfoData((prev) =>
          prev.map((item) =>
            item.videoUrl === url
              ? {
                  ...item,
                  status: 'failed',
                  error: error instanceof Error ? error.message : 'Unknown error'
                }
              : item
          )
        )
      }
    }

    setIsProcessingInfo(false)
    toast.success(`Hoàn thành: Lấy thành công thông tin ${successCount}/${urls.length} links`)
  }

  const handleDownloadRow = async (url: string, _username: string, index: number) => {
    setBulkInfoData((prev) =>
      prev.map((item) =>
        item.videoUrl === url
          ? { ...item, downloading: true, downloadProgress: 10 }
          : item
      )
    )

    const progressInterval = setInterval(() => {
      setBulkInfoData((prev) =>
        prev.map((item) => {
          if (item.videoUrl === url && item.downloading) {
            const nextProgress = Math.min((item.downloadProgress || 0) + 15, 90)
            return { ...item, downloadProgress: nextProgress }
          }
          return item
        })
      )
    }, 300)

    try {
      const response = await instagramService.getAudio(url)
      clearInterval(progressInterval)

      if (response.success && response.audioUrl) {
        setBulkInfoData((prev) =>
          prev.map((item) =>
            item.videoUrl === url
              ? { ...item, downloading: false, downloadProgress: 100 }
              : item
          )
        )
        const filename = `${index}.mp3`
        downloadAudioFile(response.audioUrl, filename, response.blob)
        toast.success(`Đã tải audio: ${filename}`)
      } else {
        toast.error(response.error || 'Failed to download audio')
        setBulkInfoData((prev) =>
          prev.map((item) =>
            item.videoUrl === url
              ? { ...item, downloading: false, downloadProgress: 0 }
              : item
          )
        )
      }
    } catch (error) {
      clearInterval(progressInterval)
      toast.error(error instanceof Error ? error.message : 'Download failed')
      setBulkInfoData((prev) =>
        prev.map((item) =>
          item.videoUrl === url
            ? { ...item, downloading: false, downloadProgress: 0 }
            : item
        )
      )
    }
  }

  const handleExportTxt = () => {
    const successItems = bulkInfoData.filter((item) => item.status === 'success')
    if (successItems.length === 0) {
      toast.error('Không có thông tin thành công để xuất file')
      return
    }

    let txtContent = ''
    successItems.forEach((item, index) => {
      const url = item.videoUrl.startsWith('http')
        ? item.videoUrl
        : `https://www.instagram.com/p/${item.videoUrl}`
      const caption = item.title || ''
      txtContent += `${index + 1}.\n${url}\n\n${caption}\n\n\n\n`
    })

    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `instagram_metadata_${Date.now()}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success('Đã xuất file .txt thành công!')
  }

  const handleExportExcel = () => {
    const successItems = bulkInfoData.filter((item) => item.status === 'success')
    if (successItems.length === 0) {
      toast.error('Không có thông tin thành công để xuất file')
      return
    }

    try {
      const excelData = successItems.map((item, index) => {
        const url = item.videoUrl.startsWith('http')
          ? item.videoUrl
          : `https://www.instagram.com/p/${item.videoUrl}`
        return {
          STT: index + 1,
          'Link Video': url,
          'Lượt xem': item.views ?? 0
        }
      })

      const worksheet = XLSX.utils.json_to_sheet(excelData)
      worksheet['!cols'] = [
        { wch: 8 }, // STT
        { wch: 65 }, // Link Video
        { wch: 15 } // Lượt xem
      ]

      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Instagram Metadata')

      const fileName = `instagram_metadata_${Date.now()}.xlsx`
      XLSX.writeFile(workbook, fileName)

      toast.success('Đã xuất file Excel thành công!')
    } catch (error) {
      console.error(error)
      toast.error('Không thể xuất file Excel')
    }
  }

  const renderStatus = (item: AudioDataItem) => {
    switch (item.status) {
      case 'pending':
        return (
          <div className='flex items-center gap-2 text-gray-500'>
            <Clock className='h-4 w-4' />
            <span>Pending</span>
          </div>
        )
      case 'loading':
        return (
          <div className='space-y-2 min-w-[150px]'>
            <div className='flex items-center gap-2 text-pink-600'>
              <Loader2 className='h-4 w-4 animate-spin' />
              <span>Loading... {item.progress}%</span>
            </div>
            <Progress value={item.progress} className='h-1.5' />
          </div>
        )
      case 'success':
        return (
          <div className='flex items-center gap-2 text-green-600 font-medium'>
            <CheckCircle className='h-4 w-4' />
            <span>Success</span>
          </div>
        )
      case 'failed':
        return (
          <div className='flex items-center gap-2 text-red-600 font-medium'>
            <XCircle className='h-4 w-4' />
            <span>Failed</span>
          </div>
        )
    }
  }

  const formatNumber = (num?: number) => {
    if (num === undefined || num === null) return '-'
    return new Intl.NumberFormat().format(num)
  }

  const columns: ColumnDef<AudioDataItem>[] = [
    {
      id: 'index',
      header: 'No.',
      cell: ({ row }) => {
        const index = row.index + 1 + pagination.pageIndex * pagination.pageSize
        return <div className='font-medium'>{index}</div>
      },
      size: 60
    },
    {
      accessorKey: 'videoUrl',
      header: 'URL / Shortcode',
      cell: ({ row }) => (
        <a
          href={row.original.videoUrl.startsWith('http') ? row.original.videoUrl : `https://www.instagram.com/p/${row.original.videoUrl}`}
          target='_blank'
          rel='noopener noreferrer'
          className='text-pink-600 hover:underline flex items-center gap-1 font-mono text-xs'
        >
          <span className='max-w-xs truncate'>{row.original.videoUrl}</span>
          <ExternalLink className='h-3 w-3' />
        </a>
      )
    },
    {
      accessorKey: 'status',
      header: 'Processing Status',
      cell: ({ row }) => renderStatus(row.original)
    },
    {
      accessorKey: 'title',
      header: 'FileName',
      cell: ({ row }) => {
        if (!row.original.title) return '-'
        return (
          <div className='max-w-xs truncate font-medium' title={row.original.title}>
            {row.original.title}
          </div>
        )
      }
    },
    {
      accessorKey: 'error',
      header: 'Error Detail',
      cell: ({ row }) => {
        if (row.original.status !== 'failed') return '-'
        return (
          <div className='max-w-xs truncate text-red-600 text-xs' title={row.original.error}>
            {row.original.error}
          </div>
        )
      }
    }
  ]

  const videoColumns: ColumnDef<AudioDataItem>[] = [
    {
      id: 'index',
      header: 'No.',
      cell: ({ row }) => {
        const index = row.index + 1 + videoPagination.pageIndex * videoPagination.pageSize
        return <div className='font-medium'>{index}</div>
      },
      size: 60
    },
    {
      accessorKey: 'videoUrl',
      header: 'URL / Shortcode',
      cell: ({ row }) => (
        <a
          href={row.original.videoUrl.startsWith('http') ? row.original.videoUrl : `https://www.instagram.com/p/${row.original.videoUrl}`}
          target='_blank'
          rel='noopener noreferrer'
          className='text-pink-600 hover:underline flex items-center gap-1 font-mono text-xs'
        >
          <span className='max-w-xs truncate'>{row.original.videoUrl}</span>
          <ExternalLink className='h-3 w-3' />
        </a>
      )
    },
    {
      accessorKey: 'status',
      header: 'Processing Status',
      cell: ({ row }) => renderStatus(row.original)
    },
    {
      accessorKey: 'title',
      header: 'FileName',
      cell: ({ row }) => {
        if (!row.original.title) return '-'
        return (
          <div className='max-w-xs truncate font-medium' title={row.original.title}>
            {row.original.title}
          </div>
        )
      }
    },
    {
      accessorKey: 'error',
      header: 'Error Detail',
      cell: ({ row }) => {
        if (row.original.status !== 'failed') return '-'
        return (
          <div className='max-w-xs truncate text-red-600 text-xs' title={row.original.error}>
            {row.original.error}
          </div>
        )
      }
    }
  ]

  const infoColumns: ColumnDef<BulkInfoItem>[] = [
    {
      id: 'index',
      header: 'No.',
      cell: ({ row }) => {
        const index = row.index + 1 + infoPagination.pageIndex * infoPagination.pageSize
        return <div className='font-medium'>{index}</div>
      },
      size: 50
    },
    {
      accessorKey: 'videoUrl',
      header: 'URL / Shortcode',
      cell: ({ row }) => (
        <a
          href={row.original.videoUrl.startsWith('http') ? row.original.videoUrl : `https://www.instagram.com/p/${row.original.videoUrl}`}
          target='_blank'
          rel='noopener noreferrer'
          className='text-pink-600 hover:underline flex items-center gap-1 font-mono text-xs'
        >
          <span className='max-w-[150px] truncate'>{row.original.videoUrl}</span>
          <ExternalLink className='h-3 w-3' />
        </a>
      )
    },
    {
      accessorKey: 'username',
      header: 'Kênh',
      cell: ({ row }) => {
        if (!row.original.username) return '-'
        return (
          <div className='flex flex-col'>
            <div className='flex items-center gap-1 font-semibold text-xs text-foreground'>
              <span>{row.original.fullname || row.original.username}</span>
              {row.original.isVerified && (
                <BadgeCheck className='h-3.5 w-3.5 fill-sky-500 text-white dark:text-background' />
              )}
            </div>
            <span className='text-[10px] text-muted-foreground'>@{row.original.username}</span>
          </div>
        )
      }
    },
    {
      accessorKey: 'title',
      header: 'Tiêu đề / Caption',
      cell: ({ row }) => {
        const title = row.original.title
        if (!title) return '-'
        return (
          <div className='flex items-center gap-1.5 max-w-xs group/caption'>
            <span className='truncate text-xs font-normal' title={title}>
              {title}
            </span>
            <Button
              size='icon'
              variant='ghost'
              className='h-6 w-6 opacity-0 group-hover/caption:opacity-100 transition-opacity shrink-0'
              onClick={() => {
                navigator.clipboard.writeText(title)
                toast.success('Đã sao chép tiêu đề!')
              }}
              title='Sao chép tiêu đề'
            >
              <Copy className='h-3 w-3 text-muted-foreground hover:text-pink-600' />
            </Button>
          </div>
        )
      }
    },
    {
      accessorKey: 'likes',
      header: 'Thích',
      cell: ({ row }) => formatNumber(row.original.likes)
    },
    {
      accessorKey: 'views',
      header: 'Lượt xem',
      cell: ({ row }) => formatNumber(row.original.views)
    },
    {
      id: 'actions',
      header: 'Tải Audio',
      cell: ({ row }) => {
        const item = row.original
        if (item.status !== 'success') return '-'
        return (
          <div className='flex items-center gap-2'>
            {item.downloading ? (
              <div className='flex items-center gap-1 text-[11px] text-pink-600 font-medium'>
                <Loader2 className='h-3 w-3 animate-spin' />
                <span>{item.downloadProgress}%</span>
              </div>
            ) : (
              <Button
                size='sm'
                variant='outline'
                className='h-7 px-2 text-xs border-pink-500/20 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/20'
                onClick={() => handleDownloadRow(item.videoUrl, item.username || 'instagram', row.index + 1)}
              >
                <Download className='h-3.5 w-3.5 mr-1' />
                Tải MP3
              </Button>
            )}
          </div>
        )
      }
    }
  ]

  const channelColumns: ColumnDef<InstagramChannelItem>[] = [
    {
      id: 'index',
      header: 'No.',
      cell: ({ row }) => {
        const index = row.index + 1 + channelPagination.pageIndex * channelPagination.pageSize
        return <div className='font-medium'>{index}</div>
      },
      size: 50
    },
    {
      accessorKey: 'thumbnailUrl',
      header: 'Ảnh',
      cell: ({ row }) => {
        if (!row.original.thumbnailUrl) return '-'
        return (
          <img
            src={row.original.thumbnailUrl}
            alt='Thumbnail'
            className='w-10 h-14 object-cover rounded border bg-muted'
          />
        )
      },
      size: 60
    },
    {
      accessorKey: 'shortcode',
      header: 'Link bài viết',
      cell: ({ row }) => (
        <a
          href={`https://www.instagram.com/p/${row.original.shortcode}`}
          target='_blank'
          rel='noopener noreferrer'
          className='text-pink-600 hover:underline flex items-center gap-1 font-mono text-xs'
        >
          <span className='max-w-[100px] truncate'>{row.original.shortcode}</span>
          <ExternalLink className='h-3 w-3' />
        </a>
      ),
      size: 110
    },
    {
      accessorKey: 'type',
      header: 'Loại',
      cell: ({ row }) => {
        const type = row.original.type
        if (type === 'carousel') return <span className='text-xs font-medium text-purple-600 dark:text-purple-400'>Băng truyền</span>
        if (type === 'video') return <span className='text-xs font-medium text-blue-600 dark:text-blue-400'>Video</span>
        return <span className='text-xs font-medium text-zinc-600 dark:text-zinc-400'>Ảnh</span>
      },
      size: 100
    },
    {
      accessorKey: 'title',
      header: 'Mô tả / Caption',
      cell: ({ row }) => {
        const title = row.original.title
        if (!title) return '-'
        return (
          <div className='flex items-center gap-1.5 max-w-xs group/caption'>
            <span className='truncate text-xs font-normal' title={title}>
              {title}
            </span>
            <Button
              size='icon'
              variant='ghost'
              className='h-6 w-6 opacity-0 group-hover/caption:opacity-100 transition-opacity shrink-0'
              onClick={() => {
                navigator.clipboard.writeText(title)
                toast.success('Đã sao chép mô tả!')
              }}
              title='Sao chép mô tả'
            >
              <Copy className='h-3 w-3 text-muted-foreground hover:text-pink-600' />
            </Button>
          </div>
        )
      }
    },
    {
      accessorKey: 'likes',
      header: 'Lượt thích',
      cell: ({ row }) => formatNumber(row.original.likes)
    },
    {
      accessorKey: 'comments',
      header: 'Bình luận',
      cell: ({ row }) => formatNumber(row.original.comments)
    },
    {
      accessorKey: 'views',
      header: 'Lượt xem',
      cell: ({ row }) => formatNumber(row.original.views)
    },
    {
      accessorKey: 'takenAt',
      header: 'Ngày tạo',
      cell: ({ row }) => formatDate(row.original.takenAt),
      size: 110
    },
    {
      id: 'actions',
      header: 'Thao tác',
      cell: ({ row }) => {
        const item = row.original
        const shortcode = item.shortcode
        const loadingState = channelRowLoading[shortcode] || {}

        if (item.type === 'video') {
          return (
            <div className='flex items-center gap-2'>
              {loadingState.audio ? (
                <div className='flex items-center gap-1 text-[11px] text-pink-600 font-medium'>
                  <Loader2 className='h-3 w-3 animate-spin' />
                  <span>MP3...</span>
                </div>
              ) : (
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7 px-2 text-xs border-pink-500/20 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/20'
                  onClick={() => handleDownloadChannelAudio(shortcode, row.index + 1)}
                  disabled={loadingState.video}
                >
                  Tải MP3
                </Button>
              )}

              {loadingState.video ? (
                <div className='flex items-center gap-1 text-[11px] text-pink-600 font-medium'>
                  <Loader2 className='h-3 w-3 animate-spin' />
                  <span>MP4...</span>
                </div>
              ) : (
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7 px-2 text-xs border-pink-500/20 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/20'
                  onClick={() => handleDownloadChannelVideo(shortcode, row.index + 1)}
                  disabled={loadingState.audio}
                >
                  Tải Video
                </Button>
              )}
            </div>
          )
        }

        return (
          <div className='flex items-center gap-2'>
            {loadingState.image ? (
              <Loader2 className='h-3 w-3 animate-spin text-pink-600' />
            ) : (
              <Button
                size='sm'
                variant='outline'
                className='h-7 px-2 text-xs border-pink-500/20 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/20'
                onClick={() => handleDownloadChannelImage(item.thumbnailUrl, shortcode, row.index + 1)}
              >
                Tải Ảnh
              </Button>
            )}
          </div>
        )
      }
    }
  ]

  const filteredChannelItems = channelData?.items || []

  return (
    <div className='space-y-6 mx-auto'>
      <div className='flex flex-wrap items-center gap-3 border-b pb-4'>
        <div className='p-2 bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 rounded-lg text-white shadow-md'>
          <Instagram className='h-6 w-6' />
        </div>
        <div>
          <h1 className='text-2xl font-bold tracking-tight bg-gradient-to-tr from-pink-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent'>
            Instagram Downloader
          </h1>
          <p className='text-muted-foreground text-sm'>
            Tải audio và video hàng loạt từ Instagram Reels và Posts.
          </p>
        </div>
        {window.instagramDesktop && (
          <div className='ml-auto flex items-center gap-2'>
            <span className='text-xs text-muted-foreground'>
              {hasInstagramSession ? 'Đã lưu phiên Instagram' : 'Chưa kết nối Instagram'}
            </span>
            <Button variant='outline' onClick={() => void handleInstagramConnection()} disabled={isConnectingInstagram}>
              {isConnectingInstagram ? 'Đang kết nối...' : hasInstagramSession ? 'Đăng nhập lại' : 'Kết nối Instagram'}
            </Button>
            {hasInstagramSession && (
              <Button variant='ghost' onClick={() => void handleInstagramConnection(true)} disabled={isConnectingInstagram}>
                Ngắt kết nối
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className='w-full'>
        <TabsList className='grid w-full grid-cols-2 h-auto p-1 max-w-[1000px] mb-4'>
          <TabsTrigger value='bulk-video' className='flex items-center gap-1.5 py-2'>
            <Video className='h-4 w-4' />
            Tải video hàng loạt
          </TabsTrigger>
          <TabsTrigger value='bulk' className='flex items-center gap-1.5 py-2'>
            <ListRestart className='h-4 w-4' />
            Tải audio hàng loạt
          </TabsTrigger>
        </TabsList>

        {/* PROFILE/CHANNEL SCANNER TAB */}
        <TabsContent value='channel' className='space-y-4'>
          <Card className='p-6 shadow-md border-muted/50 bg-card/60 backdrop-blur-sm'>
            <div className='space-y-4'>
              <div>
                <label className='text-sm font-semibold mb-2 block text-foreground'>
                  Nhập URL kênh hoặc Username Instagram (ví dụ: https://www.instagram.com/pray hoặc pray)
                </label>
                <div className='flex gap-2'>
                  <div className='relative flex-1'>
                    <Instagram className='absolute left-3 top-3 h-4 w-4 text-muted-foreground' />
                    <Input
                      value={channelInputText}
                      onChange={(e) => setChannelInputText(e.target.value)}
                      placeholder='Username hoặc URL kênh Instagram'
                      className='pl-9 h-11'
                      disabled={channelLoading}
                    />
                  </div>
                  <Button
                    onClick={handleGetChannel}
                    disabled={channelLoading}
                    className='h-11 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-medium shadow'
                  >
                    {channelLoading ? (
                      <>
                        <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                        Đang quét kênh...
                      </>
                    ) : (
                      'Quét kênh'
                    )}
                  </Button>
                  <Button
                    onClick={handleClearCache}
                    disabled={channelLoading || isClearingCache}
                    variant='outline'
                    className='h-11 border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 font-medium'
                  >
                    {isClearingCache ? (
                      <>
                        <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                        Đang xóa...
                      </>
                    ) : (
                      'Xóa cache'
                    )}
                  </Button>
                </div>
                {channelRetryUntil && (
                  <p className='mt-2 text-xs text-amber-600 dark:text-amber-400' role='status'>
                    Instagram đang giới hạn truy cập. Ứng dụng sẽ tự thử lại sau {Math.max(0, Math.ceil((channelRetryUntil - channelRetryNow) / 1000))} giây.
                  </p>
                )}
              </div>
            </div>
          </Card>

          {channelData?.user && (
            <Card className='p-6 border-muted shadow-md bg-card/40 backdrop-blur-md flex items-center gap-4'>
              <img
                src={channelData.user.profilePicUrl}
                alt={channelData.user.username}
                className='h-16 w-16 rounded-full object-cover border-2 border-pink-500 shadow-md bg-muted'
                onError={(e) => {
                  e.currentTarget.src = 'https://www.instagram.com/static/images/web/logged_out_wordmark.png/117dae56b530.png'
                }}
              />
              <div className='space-y-1'>
                <div className='flex items-center gap-1.5'>
                  <h2 className='text-lg font-bold text-foreground'>{channelData.user.fullname || channelData.user.username}</h2>
                  <BadgeCheck className='h-4 w-4 fill-sky-500 text-white' />
                </div>
                <p className='text-sm text-pink-600 font-mono'>@{channelData.user.username}</p>
                 <p className='text-xs text-muted-foreground font-mono'>ID: {channelData.user.id}</p>
                {(channelData.user.followersCount !== undefined || channelData.user.followingCount !== undefined) && (
                  <div className='flex gap-4 mt-2 text-xs font-medium text-muted-foreground'>
                    <div>
                      <span className='font-bold text-foreground'>{formatNumber(channelData.user.followersCount)}</span> người theo dõi
                    </div>
                    <div>
                      <span className='font-bold text-foreground'>{formatNumber(channelData.user.followingCount)}</span> đang theo dõi
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {channelData && (
            <div className='space-y-3'>
              <div className='flex justify-between items-center border-b pb-2 pt-2'>
                <h3 className='text-sm font-semibold text-muted-foreground'>Danh sách bài viết của kênh</h3>
                <div className='flex gap-2 items-center'>
                  {/* Select Filter */}
                  <Select value={typeFilter} onValueChange={handleTypeChange}>
                    <SelectTrigger className='w-[150px] h-8 text-xs'>
                      <SelectValue placeholder='Lọc bài viết' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Tất cả</SelectItem>
                      <SelectItem value='image'>Ảnh</SelectItem>
                      <SelectItem value='video'>Video</SelectItem>
                      <SelectItem value='carousel'>Băng truyền</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Excel Export Button */}
                  <Button
                    onClick={handleExportChannelExcel}
                    disabled={!channelData || !channelData.items || channelData.items.length === 0}
                    className='bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs h-8 px-3 flex items-center gap-1.5 shadow'
                  >
                    <FileSpreadsheet className='h-4 w-4' />
                    Xuất Excel{channelData.pagination?.hasMore ? ' (đã tải)' : ''}
                  </Button>

                  {/* Zip Images Export Button */}
                  <Button
                    onClick={handleExportChannelImages}
                    disabled={!channelData || !channelData.items || channelData.items.length === 0 || isExportingImages}
                    className='bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs h-8 px-3 flex items-center gap-1.5 shadow'
                  >
                    {isExportingImages ? (
                      <>
                        <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                        Đang tải ZIP...
                      </>
                    ) : (
                      <>
                        <Download className='h-4 w-4' />
                        Tải ảnh ZIP{channelData.pagination?.hasMore ? ' (đã tải)' : ''}
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {channelData.pagination?.hasMore && (
                <div className='text-xs text-muted-foreground'>
                  Đã tải {channelData.pagination.loadedCount ?? channelData.items?.length ?? 0} bài viết. Có thể xuất dữ liệu đã tải; mở các trang tiếp theo để tải thêm.
                  {channelData.pagination.retryAfterSeconds ? ` Instagram đang giới hạn truy cập, thử lại sau ${channelData.pagination.retryAfterSeconds} giây.` : ''}
                  {channelData.pagination.incompletePage && !channelData.pagination.retryAfterSeconds && (
                    <Button variant='outline' size='sm' className='ml-2' onClick={() => setScanTrigger((prev) => prev + 1)}>Tải tiếp trang này</Button>
                  )}
                </div>
              )}

              <Card className='p-4 shadow-lg border-muted/60 overflow-x-auto bg-card/50'>
                 <DataTable
                  columns={channelColumns}
                  data={filteredChannelItems}
                  pageSizeOptions={[20, 50, 100]}
                  manualPagination={true}
                  pageCount={Math.ceil((channelData?.pagination?.totalCount || 0) / channelPagination.pageSize)}
                  pagination={channelPagination}
                  onPaginationChange={setChannelPagination}
                />
              </Card>
            </div>
          )}
        </TabsContent>

        {/* BULK METADATA INFO TAB */}
        <TabsContent value='bulk-info' className='space-y-4'>
          <Card className='p-6 shadow-md border-muted/50 bg-card/60 backdrop-blur-sm'>
            <div className='space-y-4'>
              <div>
                <label className='text-sm font-semibold mb-2 block text-foreground'>
                  Nhập danh sách link Instagram để lấy thông tin chi tiết (Mỗi dòng hoặc dấu cách là một link)
                </label>
                <Textarea
                  value={bulkInfoUrlText}
                  onChange={(e) => {
                    setBulkInfoUrlText(e.target.value)
                    setIsBulkInfoFormatted(false)
                  }}
                  placeholder='https://www.instagram.com/reel/DZw9jWVhz5U/&#10;DZuYteMhr4j'
                  className='min-h-[120px] max-h-[250px] font-mono text-sm'
                  disabled={isProcessingInfo}
                />
              </div>

              <div className='flex gap-2'>
                <Button
                  onClick={formatBulkInfoUrls}
                  disabled={isProcessingInfo}
                  variant='outline'
                  className='border-pink-500/30 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/20'
                >
                  Định dạng URL
                </Button>
                <Button
                  onClick={handleGetInfoBulk}
                  disabled={!isBulkInfoFormatted || isProcessingInfo}
                  className='bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white shadow font-medium'
                >
                  {isProcessingInfo ? (
                    <>
                      <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                      Đang lấy thông tin...
                    </>
                  ) : (
                    'Lấy thông tin hàng loạt'
                  )}
                </Button>
              </div>
            </div>
          </Card>

          {bulkInfoData.length > 0 && (
            <div className='space-y-3'>
              <div className='flex justify-between items-center'>
                <h3 className='text-sm font-semibold text-muted-foreground'>
                  Kết quả ({bulkInfoData.filter((i) => i.status === 'success').length}/{bulkInfoData.length})
                </h3>
                {bulkInfoData.some((i) => i.status === 'success') && (
                  <div className='flex gap-2'>
                    <Button
                      onClick={handleExportTxt}
                      className='bg-zinc-600 hover:bg-zinc-700 text-white text-xs h-9 px-3 flex items-center gap-1.5 shadow'
                    >
                      <FileText className='h-4 w-4' />
                      Xuất file .txt
                    </Button>
                    <Button
                      onClick={handleExportExcel}
                      className='bg-green-600 hover:bg-green-700 text-white text-xs h-9 px-3 flex items-center gap-1.5 shadow'
                    >
                      <FileSpreadsheet className='h-4 w-4' />
                      Xuất file Excel
                    </Button>
                  </div>
                )}
              </div>
              <Card className='p-4 shadow-lg border-muted/60 overflow-x-auto bg-card/50'>
                <DataTable
                  columns={infoColumns}
                  data={bulkInfoData}
                  pageSizeOptions={[50, 100]}
                  pagination={infoPagination}
                  onPaginationChange={setInfoPagination}
                />
              </Card>
            </div>
          )}
        </TabsContent>

        {/* BULK VIDEO DOWNLOADER TAB */}
        <TabsContent value='bulk-video' className='space-y-4'>
          <Card className='p-6 shadow-md border-muted/50 bg-card/60 backdrop-blur-sm'>
            <div className='space-y-4'>
              <div>
                <label className='text-sm font-semibold mb-2 block text-foreground'>
                  Nhập danh sách link Instagram để tải video (Mỗi dòng hoặc dấu cách là một link)
                </label>
                <Textarea
                  value={videoUrlText}
                  onChange={(e) => {
                    setVideoUrlText(e.target.value)
                    setIsVideoFormatted(false)
                  }}
                  placeholder='https://www.instagram.com/reel/DZw9jWVhz5U/&#10;DZuYteMhr4j'
                  className='min-h-[120px] max-h-[250px] font-mono text-sm'
                  disabled={isProcessingVideo}
                />
              </div>

              <div className='flex gap-2'>
                <Button
                  onClick={formatVideoUrls}
                  disabled={isProcessingVideo}
                  variant='outline'
                  className='border-pink-500/30 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/20'
                >
                  Định dạng URL
                </Button>
                <Button
                  onClick={handleGetVideoBulk}
                  disabled={!isVideoFormatted || isProcessingVideo}
                  className='bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white shadow font-medium'
                >
                  {isProcessingVideo ? (
                    <>
                      <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                      Đang xử lý...
                    </>
                  ) : (
                    'Tải Video Hàng Loạt'
                  )}
                </Button>
              </div>
            </div>
          </Card>

          {videoDownloadData.length > 0 && (
            <Card className='p-4 shadow-lg border-muted/60 overflow-x-auto bg-card/50'>
              <DataTable
                columns={videoColumns}
                data={videoDownloadData}
                pageSizeOptions={[50, 100]}
                pagination={videoPagination}
                onPaginationChange={setVideoPagination}
              />
            </Card>
          )}
        </TabsContent>

        {/* BULK DOWNLOADER TAB */}
        <TabsContent value='bulk' className='space-y-4'>
          <Card className='p-6 shadow-md border-muted/50 bg-card/60 backdrop-blur-sm'>
            <div className='space-y-4'>
              <div>
                <label className='text-sm font-semibold mb-2 block text-foreground'>
                  Nhập danh sách link Instagram (Mỗi dòng hoặc dấu cách là một link)
                </label>
                <Textarea
                  value={urlText}
                  onChange={(e) => {
                    setUrlText(e.target.value)
                    setIsFormatted(false)
                  }}
                  placeholder='https://www.instagram.com/reel/DZw9jWVhz5U/&#10;DZuYteMhr4j'
                  className='min-h-[120px] max-h-[250px] font-mono text-sm'
                  disabled={isProcessing}
                />
              </div>

              <div className='flex gap-2'>
                <Button
                  onClick={formatUrls}
                  disabled={isProcessing}
                  variant='outline'
                  className='border-pink-500/30 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/20'
                >
                  Định dạng URL
                </Button>
                <Button
                  onClick={handleGetAudioBulk}
                  disabled={!isFormatted || isProcessing}
                  className='bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white shadow font-medium'
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                      Đang xử lý...
                    </>
                  ) : (
                    'Tải Audio Hàng Loạt'
                  )}
                </Button>
              </div>
            </div>
          </Card>

          {audioData.length > 0 && (
            <Card className='p-4 shadow-lg border-muted/60 overflow-x-auto bg-card/50'>
              <DataTable
                columns={columns}
                data={audioData}
                pageSizeOptions={[50, 100]}
                pagination={pagination}
                onPaginationChange={setPagination}
              />
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
