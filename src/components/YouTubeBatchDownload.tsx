import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { CheckCircle, Clock, ExternalLink, Loader2, Pause, Play, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/common/data-table'
import { Button } from '@/components/youtube-ui/button'
import { Card } from '@/components/youtube-ui/card'
import { Progress } from '@/components/youtube-ui/progress'
import { Textarea } from '@/components/youtube-ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/youtube-ui/select'
import type { DownloadBatch, DownloadItem, MediaKind } from '../../backend/src/youtube-download-queue'

interface QueueSnapshot { batches: DownloadBatch[]; cooldownUntil: number; active: string | null; error?: string | null }
interface ClearHistoryResult extends QueueSnapshot { clearedBatches: number; cleanupErrors: string[] }
const qualityOptions = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']
const splitUrls = (text: string) => [...new Set(text.split(/[\s,]+/).map(url => url.trim()).filter(Boolean))]
const errorMessage = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Không thể truy cập hàng đợi tải'
const statusNames: Record<string, string> = { pending: 'Đang chờ', loading: 'Đang tải', retrying: 'Chờ thử lại', success: 'Đã lưu file', failed: 'Cần xử lý' }
const PAGE_SIZE_OPTIONS = [50, 100] as const

export function YouTubeBatchDownload({ kind }: { kind: MediaKind }) {
  const [urlText, setUrlText] = useState('')
  const [quality, setQuality] = useState('1080p')
  const [queue, setQueue] = useState<QueueSnapshot>({ batches: [], cooldownUntil: 0, active: null })
  const [selectedId, setSelectedId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 })
  const mounted = useRef(true)
  const nowRef = useRef(Date.now())
  const [, forceRender] = useState(0)

  const batches = useMemo(() => queue.batches.filter(batch => batch.kind === kind).slice().reverse(), [queue.batches, kind])
  const historyCount = useMemo(() => batches.filter(batch => batch.items.every(item => ['success', 'failed'].includes(item.status)) && !batch.items.some(item => item.id === queue.active)).length, [batches, queue.active])
  const batch = batches.find(batch => batch.id === selectedId) || batches[0]
  const items = batch?.items || []
  const counts = useMemo(() => ({
    success: items.filter(item => item.status === 'success').length,
    failed: items.filter(item => item.status === 'failed').length,
    pending: items.filter(item => ['pending', 'retrying', 'loading'].includes(item.status)).length,
  }), [items])

  // Smart polling: only force re-render for countdown timers when items are actively waiting
  useEffect(() => {
    mounted.current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        if (!window.desktopDownloads?.youtube) throw new Error('Mở ứng dụng Desktop để tải hàng loạt và lưu file trực tiếp')
        const snapshot: QueueSnapshot = await window.desktopDownloads.youtube({ action: 'list' })
        if (!Array.isArray(snapshot.batches)) throw new Error('Không thể đọc hàng đợi tải')
        if (mounted.current) { setQueue(snapshot); setConnectionError(snapshot.error || '') }
      } catch (error) { if (mounted.current) setConnectionError(errorMessage(error)) }
      if (mounted.current) {
        nowRef.current = Date.now()
        forceRender(c => c + 1)
        timer = setTimeout(poll, 1500)
      }
    }
    void poll()
    return () => { mounted.current = false; clearTimeout(timer) }
  }, [])

  const createBatch = useCallback(async () => {
    const urls = splitUrls(urlText)
    if (!urls.length || urls.length > 1000) { toast.error('Nhập từ 1 đến 1.000 URL YouTube'); return }
    setBusy(true)
    try {
      if (!window.desktopDownloads?.youtube) throw new Error('Mở ứng dụng Desktop để tải hàng loạt')
      const created: DownloadBatch = await window.desktopDownloads.youtube({ action: 'create', urls, kind, quality })
      setSelectedId(created.id)
      setPagination({ pageIndex: 0, pageSize: 50 })
      setQueue(previous => ({ ...previous, batches: [...previous.batches, created] }))
      toast.success(`Đã xếp ${created.items.length} ${kind} vào hàng đợi`)
    } catch (error) { toast.error(errorMessage(error)) }
    finally { if (mounted.current) setBusy(false) }
  }, [urlText, kind, quality])

  const control = useCallback(async (action: 'pause' | 'resume' | 'retry') => {
    if (!batch || !window.desktopDownloads?.youtube) return
    setBusy(true)
    try { setQueue(await window.desktopDownloads.youtube({ action, id: batch.id })) }
    catch (error) { toast.error(errorMessage(error)) }
    finally { if (mounted.current) setBusy(false) }
  }, [batch])

  const clearHistory = useCallback(async () => {
    if (!window.desktopDownloads?.youtube || busy) return
    setBusy(true)
    try {
      const result: ClearHistoryResult = await window.desktopDownloads.youtube({ action: 'clear-history', kind })
      if (mounted.current) {
        setQueue(result)
        setSelectedId(undefined)
        setPagination(previous => ({ ...previous, pageIndex: 0 }))
      }
      if (result.cleanupErrors.length) toast.warning(`Đã xóa ${result.clearedBatches} lô. ${result.cleanupErrors[0]}`)
      else toast.success(`Đã xóa lịch sử ${result.clearedBatches} lô ${kind}`)
    } catch (error) { toast.error(errorMessage(error)) }
    finally { if (mounted.current) setBusy(false) }
  }, [busy, kind])

  const exportPending = useCallback(() => {
    if (!batch) return
    const pending = batch.items.filter(item => item.status !== 'success')
    const blob = new Blob([pending.map(item => item.videoUrl).join('\n')], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href; link.download = `youtube-${kind}-chua-tai.txt`; link.click()
    setTimeout(() => URL.revokeObjectURL(href), 5_000)
  }, [batch, kind])

  const now = nowRef.current

  const columns = useMemo<ColumnDef<DownloadItem>[]>(() => [
    { accessorKey: 'index', header: 'STT', size: 60 },
    { accessorKey: 'videoUrl', header: 'Video URL', cell: ({ row }) => <a href={row.original.videoUrl} target='_blank' rel='noopener noreferrer' className='text-blue-600 hover:underline flex items-center gap-1'><span className='max-w-[220px] truncate'>{row.original.videoUrl}</span><ExternalLink className='h-3 w-3 shrink-0' /></a> },
    { accessorKey: 'status', header: 'Trạng thái', cell: ({ row }) => {
      const item = row.original
      const Icon = item.status === 'success' ? CheckCircle : item.status === 'failed' ? XCircle : item.status === 'loading' ? Loader2 : Clock
      const remaining = Math.max(0, Math.ceil((Math.max(item.nextAttemptAt, queue.cooldownUntil) - now) / 1000))
      return <div className={`min-w-[160px] ${item.status === 'success' ? 'text-green-600' : item.status === 'failed' ? 'text-red-600' : 'text-blue-600'}`}>
        <div className='flex items-center gap-2'><Icon className={`h-4 w-4 ${item.status === 'loading' ? 'animate-spin' : ''}`} />{statusNames[item.status]}{item.status === 'loading' && item.progress > 0 ? ` ${Math.floor(item.progress)}%` : ''}</div>
        {item.status === 'loading' && item.progress >= 99 && <div className='text-xs text-muted-foreground'>Đang kiểm tra và lưu file</div>}
        {item.status === 'retrying' && <div className='text-xs mt-1'>{batch?.paused ? 'Lô tải đã tạm dừng' : `Thử lại sau ${remaining}s`}</div>}
      </div>
    } },
    { accessorKey: 'attempts', header: 'Lần thử', size: 70 },
    { accessorKey: 'title', header: 'Tiêu đề', cell: ({ row }) => <div className='max-w-[200px] truncate' title={row.original.title}>{row.original.title || '—'}</div> },
    { accessorKey: 'outputPath', header: 'File đã lưu', cell: ({ row }) => <div className='max-w-[200px] truncate' title={row.original.status === 'success' ? row.original.outputPath : undefined}>{row.original.status === 'success' ? row.original.outputPath?.split(/[\\/]/).pop() : '—'}</div> },
    { accessorKey: 'error', header: 'Thông báo', cell: ({ row }) => <div className='max-w-[250px] truncate text-red-600' title={row.original.error}>{row.original.error || '—'}</div> },
  ], [queue.cooldownUntil, now, batch?.paused])

  const cooling = queue.cooldownUntil > now && counts.pending > 0 && !batch?.paused

  return <div className='space-y-4'>
    <Card className='min-w-0 p-4 sm:p-6 space-y-4'>
      {kind === 'video' && <div><label className='text-sm font-medium mb-2 block'>Chất lượng video</label><Select value={quality} onValueChange={setQuality} disabled={busy}><SelectTrigger className='w-[200px]'><SelectValue /></SelectTrigger><SelectContent>{qualityOptions.map(value => <SelectItem key={value} value={value}>{value === '2160p' ? '2160p (4K)' : value}</SelectItem>)}</SelectContent></Select></div>}
      <div><label className='text-sm font-medium mb-2 block'>URL YouTube (tối đa 1.000 link, cách nhau bằng dấu phẩy, khoảng trắng hoặc xuống dòng)</label>
        <Textarea value={urlText} onChange={event => setUrlText(event.target.value)} placeholder='https://www.youtube.com/watch?v=YPi4S_kmTrc' className='min-h-[150px] max-h-[300px] resize-y' disabled={busy} />
      </div>
      <div className='flex gap-2 flex-wrap'>
        <Button onClick={() => setUrlText(splitUrls(urlText).join('\n'))} disabled={busy || !urlText.trim()}>Format URLs</Button>
        <Button onClick={() => void createBatch()} variant='outline' disabled={busy || !urlText.trim()}>{busy && <Loader2 className='h-4 w-4 mr-2 animate-spin' />}{kind === 'audio' ? 'Get Audio' : 'Get Video'}</Button>
      </div>
      <p className='text-sm text-muted-foreground'>File được lưu trực tiếp vào thư mục đã chọn. Lỗi mạng hoặc giới hạn YouTube sẽ tự chờ và thử lại. Hàng đợi tự tiếp tục sau khi mở lại ứng dụng.</p>
      {connectionError && <p role='alert' className='text-sm text-red-600'>{connectionError}</p>}
    </Card>
    {batch && <Card className='min-w-0 p-4 sm:p-6 space-y-4'>
      <p className='text-sm font-medium'>Lịch sử tải</p>
      <div className='flex gap-3 flex-wrap items-center'>
        <div role='group' aria-label='Lịch sử tải' className='flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto'>
          <Select value={batch.id} onValueChange={value => { setSelectedId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}><SelectTrigger aria-label='Chọn lịch sử tải' className='w-full sm:w-[330px]'><SelectValue /></SelectTrigger><SelectContent>{batches.map(batch => <SelectItem key={batch.id} value={batch.id}>{new Date(batch.createdAt).toLocaleString('vi-VN')} · {batch.items.length} {kind}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => void clearHistory()} variant='outline' className='text-destructive hover:text-destructive' disabled={busy || historyCount === 0} title={historyCount ? `Xóa ${historyCount} lô ${kind} đã kết thúc và dữ liệu tạm; giữ file đã lưu` : 'Chưa có lô đã kết thúc để xóa'}><Trash2 className='h-4 w-4 mr-2' />Xóa lịch sử tải</Button>
        </div>
        {counts.pending > 0 && <Button variant='outline' disabled={busy} onClick={() => void control(batch.paused ? 'resume' : 'pause')}>{batch.paused ? <Play className='h-4 w-4 mr-2' /> : <Pause className='h-4 w-4 mr-2' />}{batch.paused ? 'Tiếp tục' : 'Tạm dừng'}</Button>}
        {counts.failed > 0 && <Button variant='outline' disabled={busy} onClick={() => void control('retry')}><RotateCcw className='h-4 w-4 mr-2' />Thử lại mục lỗi</Button>}
        {counts.success < items.length && <Button variant='outline' onClick={exportPending}>Xuất link chưa tải</Button>}
      </div>
      <p className='text-xs text-muted-foreground'>Xóa lịch sử dọn các lô đã xong hoặc lỗi và dữ liệu tạm. Các lô đang chờ/tải và file đã lưu được giữ lại.</p>
      <div className='text-sm break-all'>Lưu tại: {batch.directory}</div>
      <div className='text-sm'>Đã lưu {counts.success}/{items.length} · Chờ/đang tải {counts.pending} · Cần xử lý {counts.failed}{batch.paused ? ' · Đã tạm dừng (file đang tải sẽ được lưu xong)' : ''}</div>
      <Progress value={items.length ? counts.success / items.length * 100 : 0} className='h-2' />
      {cooling && <p role='status' className='text-sm text-amber-700'>YouTube hoặc mạng đang giới hạn tải. Tự tiếp tục sau {Math.ceil((queue.cooldownUntil - now) / 1000)} giây; bạn có thể để ứng dụng mở.</p>}
      {counts.failed > 0 && <p className='text-sm text-red-600'>Có mục cần xử lý. Xem thông báo ở từng dòng, khắc phục quyền truy cập hoặc lỗi ổ đĩa rồi bấm thử lại.</p>}
      <DataTable columns={columns} data={items} getRowId={item => item.id} pageSizeOptions={PAGE_SIZE_OPTIONS as unknown as number[]} pagination={pagination} onPaginationChange={setPagination} />
    </Card>}
  </div>
}
