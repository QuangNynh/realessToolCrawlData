import { DataTable } from '@/components/common/data-table'
import { Button } from '@/components/youtube-ui/button'
import { Card } from '@/components/youtube-ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/youtube-ui/dialog'
import { Progress } from '@/components/youtube-ui/progress'
import { Textarea } from '@/components/youtube-ui/textarea'
import { youtubeService, type AudioResponse } from '@/services/youtube.service'
import type { ColumnDef } from '@tanstack/react-table'
import { CheckCircle, Clock, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

type AudioStatus = 'pending' | 'loading' | 'success' | 'failed'

interface AudioDataItem {
  videoUrl: string
  status: AudioStatus
  progress: number
  audioUrl?: string
  title?: string
  duration?: number
  error?: string
}

export const AudioYoutube = () => {
  const [urlText, setUrlText] = useState('')
  const [isFormatted, setIsFormatted] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [audioData, setAudioData] = useState<AudioDataItem[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [videoToDelete, setVideoToDelete] = useState<string | null>(null)
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

  const updateItemStatus = (
    videoUrl: string,
    updates: Partial<Omit<AudioDataItem, 'videoUrl'>>
  ) => {
    setAudioData((prev) =>
      prev.map((item) => (item.videoUrl === videoUrl ? { ...item, ...updates } : item))
    )
  }

  const downloadAudio = (audioUrl: string, index: number, blob?: Blob, ext: string = 'm4a') => {
    try {
      const link = document.createElement('a')
      link.href = audioUrl
      link.download = `${index}.${ext}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Cleanup blob URL sau khi download
      setTimeout(() => {
        if (blob) {
          URL.revokeObjectURL(audioUrl)
        }
      }, 100)
    } catch (error) {
      console.error('Download failed:', error)
      toast.error('Failed to download audio')
    }
  }

  const handleGetAudio = async () => {
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
      toast.error('No valid YouTube URLs found')
      return
    }

    // Khởi tạo bảng với trạng thái pending
    const initialData: AudioDataItem[] = urls.map((url) => ({
      videoUrl: url,
      status: 'pending',
      progress: 0
    }))
    setAudioData(initialData)
    setIsProcessing(true)

    let successCount = 0
    let failedUrls = [...urls]

    for (let round = 1; round <= 3; round++) {
      if (failedUrls.length === 0) break

      toast.info(`Vòng ${round}: Bắt đầu tải ${failedUrls.length} audio...`)
      const currentRoundFailed: string[] = []

      for (let i = 0; i < failedUrls.length; i++) {
        const url = failedUrls[i]
        const index = urls.indexOf(url) + 1

        try {
          // Cập nhật trạng thái loading
          updateItemStatus(url, { status: 'loading', progress: 0, error: undefined })

          // Giả lập progress
          const progressInterval = setInterval(() => {
            setAudioData((prev) =>
              prev.map((item) => {
                if (item.videoUrl === url && item.status === 'loading') {
                  const newProgress = Math.min(item.progress + 10, 90)
                  return { ...item, progress: newProgress }
                }
                return item
              })
            )
          }, 300)

          // Gọi API
          const response: AudioResponse = await youtubeService.getAudio(url)

          // Dừng progress giả lập
          clearInterval(progressInterval)

          // Cập nhật kết quả
          if (response.success && response.audioUrl) {
            updateItemStatus(url, {
              status: 'success',
              progress: 100,
              audioUrl: response.audioUrl,
              title: response.title,
              duration: response.duration
            })

            // Tự động tải xuống với số thứ tự và extension phù hợp
            const ext = response.format || 'm4a'
            downloadAudio(response.audioUrl, index, response.blob, ext)
            successCount++
            toast.success(`Downloaded: ${index}.${ext} (Vòng ${round})`)
          } else {
            updateItemStatus(url, {
              status: 'failed',
              progress: 0,
              error: response.error || 'Unknown error'
            })
            currentRoundFailed.push(url)
          }
        } catch (error) {
          updateItemStatus(url, {
            status: 'failed',
            progress: 0,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
          currentRoundFailed.push(url)
        }
      }

      failedUrls = currentRoundFailed
      if (failedUrls.length > 0 && round < 3) {
        toast.warning(`Vòng ${round} hoàn tất. Còn ${failedUrls.length} audio bị lỗi. Chuẩn bị tải lại vòng ${round + 1}...`)
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }

    setIsProcessing(false)
    toast.success(`Completed: ${successCount}/${urls.length} audio files downloaded`)
  }

  const confirmDelete = () => {
    if (videoToDelete) {
      setAudioData((prev) => prev.filter((item) => item.videoUrl !== videoToDelete))
      toast.success('Audio deleted')
      setDeleteDialogOpen(false)
      setVideoToDelete(null)
    }
  }

  const cancelDelete = () => {
    setDeleteDialogOpen(false)
    setVideoToDelete(null)
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
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
          <div className='space-y-2 min-w-[200px]'>
            <div className='flex items-center gap-2 text-blue-600'>
              <Loader2 className='h-4 w-4 animate-spin' />
              <span>Loading... {item.progress}%</span>
            </div>
            <Progress value={item.progress} className='h-2' />
          </div>
        )
      case 'success':
        return (
          <div className='flex items-center gap-2 text-green-600'>
            <CheckCircle className='h-4 w-4' />
            <span>Success</span>
          </div>
        )
      case 'failed':
        return (
          <div className='flex items-center gap-2 text-red-600'>
            <XCircle className='h-4 w-4' />
            <span>Failed</span>
          </div>
        )
    }
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
      header: 'Video URL',
      cell: ({ row }) => (
        <a
          href={row.original.videoUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-blue-600 hover:underline flex items-center gap-1'
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
      header: 'Title',
      cell: ({ row }) => {
        if (!row.original.title) return '-'
        return (
          <div className='max-w-xs truncate' title={row.original.title}>
            {row.original.title}
          </div>
        )
      }
    },
    {
      accessorKey: 'duration',
      header: 'Duration',
      cell: ({ row }) => formatDuration(row.original.duration)
    },
    {
      accessorKey: 'error',
      header: 'Error',
      cell: ({ row }) => {
        if (row.original.status !== 'failed') return '-'
        return (
          <div className='max-w-xs truncate text-red-600' title={row.original.error}>
            {row.original.error}
          </div>
        )
      }
    }
  ]

  return (
    <div className='space-y-4'>
      <Card className='p-6'>
        <div className='space-y-4'>
          <div>
            <label className='text-sm font-medium mb-2 block'>
              Enter YouTube URLs (separated by comma, space, or newline)
            </label>
            <Textarea
              value={urlText}
              onChange={(e) => {
                setUrlText(e.target.value)
                setIsFormatted(false)
              }}
              placeholder='https://www.youtube.com/watch?v=YPi4S_kmTrc'
              className='min-h-[150px] max-h-[300px] resize-y'
              disabled={isProcessing}
            />
          </div>

          <div className='flex gap-2'>
            <Button onClick={formatUrls} disabled={isProcessing}>
              Format URLs
            </Button>
            <Button
              onClick={handleGetAudio}
              variant='outline'
              disabled={!isFormatted || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                  Processing...
                </>
              ) : (
                'Get Audio'
              )}
            </Button>
          </div>
        </div>
      </Card>

      {audioData.length > 0 && (
        <Card className='p-6'>
          <DataTable
            columns={columns}
            data={audioData}
            pageSizeOptions={[50, 100]}
            pagination={pagination}
            onPaginationChange={setPagination}
          />
        </Card>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Audio</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this audio entry? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={cancelDelete}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
