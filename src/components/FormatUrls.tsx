import { useCallback, useMemo, useState } from 'react'
import { Card } from '@/components/youtube-ui/card'
import { Textarea } from '@/components/youtube-ui/textarea'
import { Button } from '@/components/youtube-ui/button'
import { toast } from 'sonner'
import { youtubeService, type TranscriptResponse } from '@/services/youtube.service'
import { DataTable } from '@/components/common/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import { Copy, FileText, Trash2, Download, FileDown } from 'lucide-react'
import JSZip from 'jszip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/youtube-ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/youtube-ui/dialog'

const PAGE_SIZE_OPTIONS = [50, 100] as const

const extractVideoId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\s?]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

const decodeHtmlEntities = (text: string) => {
  return text
    .replace(/&amp;#39;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const formatSrtTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const milliseconds = Math.floor((seconds % 1) * 1000)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`
}

const buildSrtContent = (data: TranscriptResponse) => {
  if (!data.success || !data.transcript) return null
  return data.transcript
    .map((item, idx) => {
      const startTime = formatSrtTime(item.offset)
      const nextItem = data.transcript[idx + 1]
      const endTime = nextItem
        ? formatSrtTime(nextItem.offset - 0.001)
        : formatSrtTime(item.offset + item.duration)
      let text = decodeHtmlEntities(item.text)
      text = text.replace(/\[Music\]/gi, '')
      return `${idx + 1}\n${startTime} --> ${endTime}\n${text}\n`
    })
    .join('\n')
}

export const FormatUrls = () => {
  const [urlText, setUrlText] = useState('')
  const [isFormatted, setIsFormatted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [transcriptData, setTranscriptData] = useState<TranscriptResponse[]>([])
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

  const handleTranscript = async () => {
    setTranscriptData([])
    if (!urlText.trim()) {
      toast.error('Please enter URLs')
      return
    }
    if (!isFormatted) {
      toast.error('Please format URLs first')
      return
    }
    setIsLoading(true)
    try {
      const urls = urlText
        .split(/[\s,\n\t]+/)
        .map((url) => url.trim())
        .filter((url) => url.length > 0)
      const videoIds = urls
        .map((url) => extractVideoId(url))
        .filter((id): id is string => id !== null)
      if (videoIds.length === 0) {
        toast.error('No valid YouTube URLs found')
        setIsLoading(false)
        return
      }
      const response = await youtubeService.getTranscripts(videoIds)
      setTranscriptData(response)
      toast.success(`Fetched ${response.length} transcripts`)
    } catch (error) {
      toast.error('Failed to fetch transcripts')
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied!`)
    } catch (error) {
      console.log(error)
      toast.error('Failed to copy')
    }
  }, [])

  const copyTranscriptTimeline = useCallback((data: TranscriptResponse) => {
    if (!data.success || !data.transcript) {
      toast.error('No transcript available')
      return
    }
    const timelineText = data.transcript
      .map((item) => `${formatTime(item.offset)} - ${decodeHtmlEntities(item.text)}`)
      .join('\n')
    copyToClipboard(timelineText, 'Timeline transcript')
  }, [copyToClipboard])

  const copyTranscriptText = useCallback((data: TranscriptResponse) => {
    if (!data.success || !data.transcript) {
      toast.error('No transcript available')
      return
    }
    const plainText = data.transcript.map((item) => decodeHtmlEntities(item.text)).join(' ')
    copyToClipboard(plainText, 'Transcript text')
  }, [copyToClipboard])

  const handleDelete = (videoId: string) => {
    setVideoToDelete(videoId)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (videoToDelete) {
      setTranscriptData((prev) => prev.filter((item) => item.videoId !== videoToDelete))
      toast.success('Transcript deleted')
      setDeleteDialogOpen(false)
      setVideoToDelete(null)
    }
  }

  const cancelDelete = () => {
    setDeleteDialogOpen(false)
    setVideoToDelete(null)
  }

  const exportToSrt = useCallback((data: TranscriptResponse, index: number) => {
    const srtContent = buildSrtContent(data)
    if (!srtContent) {
      toast.error('No transcript available')
      return
    }
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${index}.srt`
    link.click()
    URL.revokeObjectURL(link.href)
    toast.success(`Exported ${index}.srt`)
  }, [])

  const exportToFile = useCallback((data: TranscriptResponse[], filename: string) => {
    const content = data
      .map((item, index) => {
        if (!item.success || !item.metadata) return null
        const url = `https://www.youtube.com/watch?v=${item.videoId}`
        const title = item.metadata.title
        const transcript = item.transcript?.map((t) => decodeHtmlEntities(t.text)).join(' ') ?? ''
        return `${index + 1}.\n${url}\n\n${title}\n\n${transcript}\n\n\n\n`
      })
      .filter(Boolean)
      .join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }, [])

  const handleExportAllSrt = async () => {
    if (transcriptData.length === 0) {
      toast.error('No data to export')
      return
    }
    const zip = new JSZip()
    let exportedCount = 0
    for (let i = 0; i < transcriptData.length; i++) {
      const data = transcriptData[i]
      if (data.success && data.transcript && data.transcript.length > 0) {
        const srtContent = buildSrtContent(data)
        if (srtContent) {
          zip.file(`${i + 1}.srt`, srtContent)
          exportedCount++
        }
      }
    }
    if (exportedCount > 0) {
      try {
        const blob = await zip.generateAsync({ type: 'blob' })
        const link = document.createElement('a')
        const href = URL.createObjectURL(blob)
        link.href = href
        link.download = `subtitles-${Date.now()}.zip`
        link.click()
        URL.revokeObjectURL(href)
        toast.success(`Exported ${exportedCount} SRT files in ZIP`)
      } catch (error) {
        console.error(error)
        toast.error('Failed to create ZIP file')
      }
    } else {
      toast.error('No transcripts available to export')
    }
  }

  const handleExportAllThumbnails = async () => {
    if (transcriptData.length === 0) {
      toast.error('No data to export')
      return
    }
    const zip = new JSZip()
    let exportedCount = 0
    let failedCount = 0
    const loadingToast = toast.loading('Downloading thumbnails...')
    try {
      for (let i = 0; i < transcriptData.length; i++) {
        const data = transcriptData[i]
        if (data.success && data.metadata && data.metadata.thumbnails && data.metadata.thumbnails.length > 0) {
          try {
            const thumbnailUrl = data.metadata.thumbnails[0].url
            const blob = await youtubeService.downloadImage(thumbnailUrl)
            const urlParts = thumbnailUrl.split('.')
            const extension = urlParts[urlParts.length - 1].split('?')[0] || 'webp'
            zip.file(`${i + 1}.${extension}`, blob)
            exportedCount++
            toast.loading(`Downloading thumbnails... (${exportedCount}/${transcriptData.length})`, { id: loadingToast })
          } catch (error) {
            console.error(`Failed to download thumbnail for video ${i + 1}:`, error)
            failedCount++
          }
        }
      }
      if (exportedCount > 0) {
        toast.loading('Creating ZIP file...', { id: loadingToast })
        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const link = document.createElement('a')
        const href = URL.createObjectURL(zipBlob)
        link.href = href
        link.download = `thumbnails-${Date.now()}.zip`
        link.click()
        URL.revokeObjectURL(href)
        toast.dismiss(loadingToast)
        if (failedCount > 0) {
          toast.success(`Exported ${exportedCount} thumbnails (${failedCount} failed)`)
        } else {
          toast.success(`Exported ${exportedCount} thumbnails in ZIP`)
        }
      } else {
        toast.dismiss(loadingToast)
        toast.error('No thumbnails available to export')
      }
    } catch (error) {
      toast.dismiss(loadingToast)
      console.error(error)
      toast.error('Failed to create ZIP file')
    }
  }

  const handleExportAll = () => {
    if (transcriptData.length === 0) {
      toast.error('No data to export')
      return
    }
    const successData = transcriptData.filter((item) => item.success)
    if (successData.length === 0) {
      toast.error('No successful transcripts to export')
      return
    }
    exportToFile(successData, `youtube-transcripts-all-${Date.now()}.txt`)
    toast.success(`Exported ${successData.length} transcripts`)
  }

  const handleExportPage = () => {
    const startIndex = pagination.pageIndex * pagination.pageSize
    const endIndex = startIndex + pagination.pageSize
    const pageData = transcriptData.slice(startIndex, endIndex)
    const successData = pageData.filter((item) => item.success)
    if (successData.length === 0) {
      toast.error('No successful transcripts on this page')
      return
    }
    exportToFile(successData, `youtube-transcripts-page-${pagination.pageIndex + 1}-${Date.now()}.txt`)
    toast.success(`Exported ${successData.length} transcripts from page ${pagination.pageIndex + 1}`)
  }

  const columns = useMemo<ColumnDef<TranscriptResponse>[]>(() => [
    {
      accessorKey: 'videoId',
      header: 'Video ID',
      cell: ({ row }) => (
        <a
          href={`https://youtube.com/watch?v=${row.original.videoId}`}
          target='_blank'
          rel='noopener noreferrer'
          className='text-blue-600 hover:underline'
        >
          {row.original.videoId}
        </a>
      )
    },
    {
      accessorKey: 'metadata.title',
      header: 'Title',
      cell: ({ row }) => {
        if (!row.original.success || !row.original.metadata) return '-'
        const title = row.original.metadata.title
        return (
          <div
            className='max-w-xs truncate cursor-pointer hover:text-blue-600 transition-colors'
            title={`${title}\n\nClick to copy`}
            onClick={() => copyToClipboard(title, 'Title')}
          >
            {title}
          </div>
        )
      }
    },
    {
      accessorKey: 'success',
      header: 'Status',
      cell: ({ row }) => (
        <span className={row.original.success ? 'text-green-600' : 'text-red-600'}>
          {row.original.success ? 'Success' : 'Failed'}
        </span>
      )
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const data = row.original

        if (!data.success) {
          return (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => handleDelete(data.videoId)}
              className='h-8 w-8 p-0'
            >
              <Trash2 className='h-4 w-4 text-red-600' />
            </Button>
          )
        }

        return (
          <div className='flex items-center gap-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' size='sm' className='h-8 px-2'>
                  <Copy className='h-4 w-4 mr-1' />
                  Copy
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => copyTranscriptTimeline(data)}>
                  <Copy className='h-4 w-4 mr-2' />
                  Copy Timeline
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyTranscriptText(data)}>
                  <FileText className='h-4 w-4 mr-2' />
                  Copy Text Only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => exportToSrt(data, row.index + 1)}
              className='h-8 px-2'
              title='Export SRT'
            >
              <FileDown className='h-4 w-4 mr-1' />
              SRT
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => handleDelete(data.videoId)}
              className='h-8 w-8 p-0'
            >
              <Trash2 className='h-4 w-4 text-red-600' />
            </Button>
          </div>
        )
      }
    }
  ], [copyToClipboard, copyTranscriptTimeline, copyTranscriptText, exportToSrt])

  return (
    <div className='space-y-4'>
      <Card className='min-w-0 p-4 sm:p-6'>
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
              placeholder='Enter YouTube URLs or video IDs here...'
              className='min-h-[150px] max-h-[300px] resize-y'
            />
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button onClick={formatUrls}>Format URLs</Button>
            <Button
              onClick={handleTranscript}
              variant='outline'
              disabled={!isFormatted || isLoading}
            >
              {isLoading ? 'Loading...' : 'Transcript'}
            </Button>
            <Button
              onClick={handleExportAll}
              variant='outline'
              disabled={transcriptData.length === 0}
            >
              <Download className='h-4 w-4 mr-2' />
              Export Script
            </Button>
            <Button
              onClick={handleExportAllThumbnails}
              variant='outline'
              disabled={transcriptData.length === 0}
            >
              <FileDown className='h-4 w-4 mr-2' />
              Export Thumb
            </Button>
            <Button
              onClick={handleExportAllSrt}
              variant='outline'
              disabled={transcriptData.length === 0}
            >
              <FileDown className='h-4 w-4 mr-2' />
              Export SRT
            </Button>

            <Button
              onClick={() => {
                setTranscriptData([])
                setUrlText('')
              }}
              className='bg-blue-500'
              disabled={transcriptData.length === 0}
            >
              <FileDown className='h-4 w-4 mr-2' />
              Clear data
            </Button>
          </div>
        </div>
      </Card>

      {transcriptData.length > 0 && (
        <Card className='min-w-0 p-4 sm:p-6'>
          <div className='space-y-4'>
            <div className='flex justify-end'>
              <Button onClick={handleExportPage} variant='outline' size='sm'>
                <Download className='h-4 w-4 mr-2' />
                Export Page
              </Button>
            </div>
            <DataTable
              columns={columns}
              data={transcriptData}
              pageSizeOptions={PAGE_SIZE_OPTIONS as unknown as number[]}
              pagination={pagination}
              onPaginationChange={setPagination}
            />
          </div>
        </Card>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Transcript</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the transcript for video{' '}
              <span className='font-semibold'>{videoToDelete}</span>? This action cannot be undone.
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
