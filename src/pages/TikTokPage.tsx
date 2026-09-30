import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Progress } from '../components/ui/progress';
import { tiktokService, type TikTokChannelVideo } from '../services/tiktok.service';
import {
  Loader2,
  Download,
  CheckCircle,
  Clock,
  XCircle,
  ExternalLink,
  User,
  Music,
  Video,
  Trash2,
  FileSpreadsheet,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';

const TikTokIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" {...props}>
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.63 4.14 1.02 1.11 2.45 1.8 3.97 1.93v3.86c-1.39-.08-2.77-.57-3.92-1.37a8.03 8.03 0 01-2.43-2.6v7.35c.03 1.54-.36 3.09-1.12 4.43-.8 1.42-2 2.58-3.46 3.3-1.52.76-3.25.99-4.9.68-1.63-.3-3.15-1.2-4.22-2.48a8.3 8.3 0 01-1.74-4.52c-.11-1.65.25-3.32 1.05-4.76.81-1.45 2.06-2.61 3.56-3.3 1.25-.57 2.63-.78 3.98-.62V8.2c-1.02-.15-2.07.03-3 .52a4.42 4.42 0 00-2.22 2.5 4.38 4.38 0 00.32 3.65c.67.99 1.76 1.64 2.94 1.77 1.2.14 2.44-.2 3.34-1 .85-.75 1.34-1.85 1.36-2.98V.02z" />
  </svg>
);

type BulkStatus = 'pending' | 'loading' | 'success' | 'failed';

interface BulkItem {
  id: number;
  videoUrl: string;
  status: BulkStatus;
  progress: number;
  title?: string;
  error?: string;
}

type ChannelStatus = 'idle' | 'loading_audio' | 'loading_video' | 'success_audio' | 'success_video' | 'failed';
type ChannelItem = TikTokChannelVideo & { status: ChannelStatus; error?: string };

const PAGE_SIZES = [50, 100];
const parseUrls = (value: string) => value.split(/[\s,]+/).map(url => url.trim()).filter(Boolean);

function Pagination({ count, page, pageSize, onPage, onPageSize }: {
  count: number; page: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  return <div className="flex items-center justify-end gap-2 p-3 text-sm text-muted-foreground">
    <span>{count ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)} / ${count}` : '0 / 0'}</span>
    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Trước</Button>
    <span>{page + 1}/{pages}</span>
    <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Sau</Button>
    <select aria-label="Số dòng mỗi trang" className="h-8 rounded-md border bg-background px-2" value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>
      {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
    </select>
  </div>;
}

export function TikTokPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = ['channel', 'audio', 'video'].includes(searchParams.get('tab') || '') ? searchParams.get('tab')! : 'channel';

  // Channel state
  const [channelUrl, setChannelUrl] = useState('');
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelVideos, setChannelVideos] = useState<ChannelItem[]>([]);
  const [channelName, setChannelName] = useState('');
  const [channelVideoLoading, setChannelVideoLoading] = useState<Record<string, { audio?: boolean; video?: boolean }>>({});
  const [channelProcessing, setChannelProcessing] = useState(false);
  const [channelPage, setChannelPage] = useState(0);
  const [channelPageSize, setChannelPageSize] = useState(50);

  // Audio bulk state
  const [audioUrlText, setAudioUrlText] = useState('');
  const [isAudioFormatted, setIsAudioFormatted] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [audioData, setAudioData] = useState<BulkItem[]>([]);
  const [audioPage, setAudioPage] = useState(0);
  const [audioPageSize, setAudioPageSize] = useState(50);

  // Video bulk state
  const [videoUrlText, setVideoUrlText] = useState('');
  const [isVideoFormatted, setIsVideoFormatted] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [videoData, setVideoData] = useState<BulkItem[]>([]);
  const [videoPage, setVideoPage] = useState(0);
  const [videoPageSize, setVideoPageSize] = useState(50);

  useEffect(() => { setChannelPage(page => Math.min(page, Math.max(0, Math.ceil(channelVideos.length / channelPageSize) - 1))); }, [channelVideos.length, channelPageSize]);
  useEffect(() => { setAudioPage(page => Math.min(page, Math.max(0, Math.ceil(audioData.length / audioPageSize) - 1))); }, [audioData.length, audioPageSize]);
  useEffect(() => { setVideoPage(page => Math.min(page, Math.max(0, Math.ceil(videoData.length / videoPageSize) - 1))); }, [videoData.length, videoPageSize]);

  const downloadFile = (blobUrl: string, filename: string, blob?: Blob) => {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (blob) setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  const formatNumber = (n?: number) => (n === undefined || n === null ? '-' : new Intl.NumberFormat().format(n));

  const copyText = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success('Đã sao chép'); }
    catch { toast.error('Không thể sao chép'); }
  };

  const exportExcel = (kind: 'channel' | 'audio' | 'video') => {
    const rows = kind === 'channel'
      ? channelVideos.map((item, index) => ({ STT: index + 1, 'Video ID': item.id, URL: item.url, 'Tiêu đề': item.title, 'Lượt xem': item.view_count, 'Lượt thích': item.like_count, 'Ngày đăng': item.created_at || '' }))
      : (kind === 'audio' ? audioData : videoData).map((item, index) => ({ STT: index + 1, URL: item.videoUrl, 'Tiêu đề': item.title || '', 'Trạng thái': item.status, 'Chi tiết lỗi': item.error || '' }));
    if (!rows.length) { toast.error('Không có dữ liệu để xuất'); return; }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'TikTok');
    XLSX.writeFile(workbook, `tiktok-${kind}-${Date.now()}.xlsx`);
    toast.success(`Đã xuất ${rows.length} dòng`);
  };

  // Channel
  const handleFetchChannel = async () => {
    if (!channelUrl.trim()) { toast.error('Nhập URL kênh TikTok'); return; }
    setChannelLoading(true);
    try {
      const r = await tiktokService.getChannelVideos(channelUrl);
      if (r.success && r.videos) {
        setChannelVideos([...r.videos].reverse().map(video => ({ ...video, status: 'idle' })));
        setChannelPage(0);
        setChannelName(r.channel || '');
        toast.success(`Tìm thấy ${r.videos.length} video`);
      } else toast.error(r.error || 'Lỗi');
    } catch (e: any) { toast.error(e.message); }
    finally { setChannelLoading(false); }
  };

  const handleChannelDownloadAudio = async (url: string, id: string, idx: number) => {
    setChannelVideoLoading(p => ({ ...p, [id]: { ...p[id], audio: true } }));
    setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'loading_audio', error: undefined } : item));
    try {
      const r = await tiktokService.getAudio(url);
      if (r.success && r.audioUrl) { downloadFile(r.audioUrl, `${idx}.mp3`, r.blob); setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'success_audio' } : item)); toast.success(`Tải: ${idx}.mp3`); return true; }
      setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'failed', error: r.error || 'Lỗi tải MP3' } : item)); toast.error(r.error || 'Lỗi');
    } catch (e: any) { setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'failed', error: e.message } : item)); toast.error(e.message); }
    finally { setChannelVideoLoading(p => ({ ...p, [id]: { ...p[id], audio: false } })); }
    return false;
  };

  const handleChannelDownloadVideo = async (url: string, id: string, idx: number) => {
    setChannelVideoLoading(p => ({ ...p, [id]: { ...p[id], video: true } }));
    setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'loading_video', error: undefined } : item));
    try {
      const r = await tiktokService.getVideo(url);
      if (r.success && r.videoUrl) { downloadFile(r.videoUrl, `${idx}.mp4`, r.blob); setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'success_video' } : item)); toast.success(`Tải: ${idx}.mp4`); }
      else { setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'failed', error: r.error || 'Lỗi tải MP4' } : item)); toast.error(r.error || 'Lỗi'); }
    } catch (e: any) { setChannelVideos(p => p.map(item => item.id === id ? { ...item, status: 'failed', error: e.message } : item)); toast.error(e.message); }
    finally { setChannelVideoLoading(p => ({ ...p, [id]: { ...p[id], video: false } })); }
  };

  const handleChannelDownloadAllAudio = async () => {
    const pending = channelVideos.map((item, index) => ({ item, index })).filter(({ item }) => item.status === 'idle' || item.status === 'failed');
    if (!pending.length) { toast.error('Không có video nào cần tải'); return; }
    setChannelProcessing(true);
    let done = 0;
    try {
      for (const { item, index } of pending) {
        if (await handleChannelDownloadAudio(item.url, item.id, index + 1)) done++;
      }
    } finally { setChannelProcessing(false); }
    toast.info(`Đã tải ${done}/${pending.length} MP3`);
  };

  // Bulk helpers
  const downloadBulkItem = async (
    type: 'audio' | 'video',
    item: BulkItem,
    setData: React.Dispatch<React.SetStateAction<BulkItem[]>>,
  ): Promise<boolean> => {
    setData(p => p.map(it => it.id === item.id ? { ...it, status: 'loading', progress: 30, error: undefined } : it));
    try {
      const r = type === 'audio' ? await tiktokService.getAudio(item.videoUrl) : await tiktokService.getVideo(item.videoUrl);
      const dlUrl = type === 'audio' ? r.audioUrl : r.videoUrl;
      if (r.success && dlUrl) {
        setData(p => p.map(it => it.id === item.id ? { ...it, status: 'success', progress: 100, title: r.title } : it));
        downloadFile(dlUrl, `${item.id}.${type === 'audio' ? 'mp3' : 'mp4'}`, r.blob);
        return true;
      }
      setData(p => p.map(it => it.id === item.id ? { ...it, status: 'failed', progress: 0, error: r.error || 'Tải thất bại' } : it));
    } catch (e) {
      setData(p => p.map(it => it.id === item.id ? { ...it, status: 'failed', progress: 0, error: e instanceof Error ? e.message : 'Lỗi không xác định' } : it));
    }
    return false;
  };

  const processBulk = async (
    type: 'audio' | 'video',
    urlText: string,
    setData: React.Dispatch<React.SetStateAction<BulkItem[]>>,
    setProcessing: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    const urls = parseUrls(urlText);
    if (!urls.length) { toast.error('Vui lòng nhập danh sách link TikTok'); return; }
    const items = urls.map((videoUrl, index) => ({ id: index + 1, videoUrl, status: 'pending' as const, progress: 0 }));
    setData(items);
    if (type === 'audio') setAudioPage(0); else setVideoPage(0);
    setProcessing(true);
    let ok = 0;
    try {
      for (const item of items) if (await downloadBulkItem(type, item, setData)) ok++;
    } finally { setProcessing(false); }
    toast.success(`Hoàn thành: ${ok}/${urls.length}`);
  };

  const retryBulkItem = async (type: 'audio' | 'video', item: BulkItem) => {
    const setData = type === 'audio' ? setAudioData : setVideoData;
    const setProcessing = type === 'audio' ? setIsProcessingAudio : setIsProcessingVideo;
    setProcessing(true);
    try { await downloadBulkItem(type, item, setData); }
    finally { setProcessing(false); }
  };

  const StatusBadge = ({ status, progress, error }: { status: BulkStatus; progress: number; error?: string }) => {
    if (status === 'pending') return <div className="flex items-center gap-1 text-muted-foreground text-xs"><Clock className="h-3 w-3" /> Chờ</div>;
    if (status === 'loading') return <div className="space-y-1"><div className="flex items-center gap-1 text-xs"><Loader2 className="h-3 w-3 animate-spin" /> {progress}%</div><Progress value={progress} className="h-1" /></div>;
    if (status === 'success') return <div className="flex items-center gap-1 text-green-500 text-xs"><CheckCircle className="h-3 w-3" /> OK</div>;
    return <div className="flex items-center gap-1 text-red-500 text-xs" title={error}><XCircle className="h-3 w-3" /> Lỗi</div>;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <div className="p-2 bg-gradient-to-tr from-zinc-800 to-black rounded-lg text-white shadow-md"><TikTokIcon className="h-6 w-6" /></div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TikTok Downloader & Tools</h1>
          <p className="text-muted-foreground text-sm">Tải audio, video và quét kênh từ TikTok.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={tab => setSearchParams({ tab }, { replace: true })} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-auto p-1 max-w-[600px] mb-4">
          <TabsTrigger value="channel" className="flex items-center gap-1.5 py-2"><User className="h-4 w-4" /> Lấy thông tin kênh</TabsTrigger>
          <TabsTrigger value="audio" className="flex items-center gap-1.5 py-2"><Music className="h-4 w-4" /> Tải audio TikTok</TabsTrigger>
          <TabsTrigger value="video" className="flex items-center gap-1.5 py-2"><Video className="h-4 w-4" /> Tải video TikTok</TabsTrigger>
        </TabsList>

        {/* Channel Tab */}
        <TabsContent value="channel" className="space-y-4">
          <Card className="p-6">
            <label className="text-sm font-semibold block mb-2">Nhập URL kênh TikTok</label>
            <div className="flex flex-wrap gap-2">
              <Input value={channelUrl} onChange={e => setChannelUrl(e.target.value)} placeholder="https://www.tiktok.com/@username" className="flex-1 min-w-60 h-11" disabled={channelLoading || channelProcessing} />
              <Button onClick={handleFetchChannel} disabled={channelLoading || channelProcessing} className="h-11">
                {channelLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang quét...</> : 'Quét kênh'}
              </Button>
              {channelVideos.length > 0 && <>
                <Button variant="outline" onClick={handleChannelDownloadAllAudio} disabled={channelLoading || channelProcessing}><Music className="h-4 w-4 mr-1" /> {channelProcessing ? 'Đang tải...' : 'Tải tất cả MP3 (Lần lượt)'}</Button>
                <Button variant="outline" onClick={() => exportExcel('channel')} disabled={channelLoading || channelProcessing}><FileSpreadsheet className="h-4 w-4 mr-1" /> Xuất Excel</Button>
                <Button variant="ghost" onClick={() => { setChannelVideos([]); setChannelUrl(''); setChannelPage(0); }} disabled={channelLoading || channelProcessing}>Xóa kết quả</Button>
              </>}
            </div>
          </Card>

          {channelVideos.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {channelName && `@${channelName} — `}{channelVideos.length} video
              </h3>
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left w-12">#</th>
                      <th className="px-3 py-2 text-left w-16">Ảnh bìa</th>
                      <th className="px-3 py-2 text-left w-28">Video ID</th>
                      <th className="px-3 py-2 text-left">Tiêu đề</th>
                      <th className="px-3 py-2 text-right w-20">Xem</th>
                      <th className="px-3 py-2 text-right w-20">Thích</th>
                      <th className="px-3 py-2 text-right w-20">BL</th>
                      <th className="px-3 py-2 text-left w-24">Ngày</th>
                      <th className="px-3 py-2 text-left w-28">Trạng thái</th>
                      <th className="px-3 py-2 text-left w-44">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channelVideos.slice(channelPage * channelPageSize, (channelPage + 1) * channelPageSize).map((v, i) => {
                      const loading = channelVideoLoading[v.id] || {};
                      const index = channelPage * channelPageSize + i + 1;
                      const thumbnail = v.thumbnails?.find((image: any) => image.id === 'cover' || image.id === 'originCover')?.url || v.thumbnails?.[0]?.url;
                      return (
                        <tr key={v.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2">{index}</td>
                          <td className="px-3 py-2">{thumbnail && <img src={thumbnail} alt="Ảnh bìa" className="h-16 w-12 rounded object-cover" />}</td>
                          <td className="px-3 py-2 font-mono text-xs">{v.id}</td>
                          <td className="px-3 py-2 max-w-xs truncate">
                            <button type="button" className="text-left hover:underline" title="Sao chép tiêu đề" onClick={() => void copyText(v.title || v.id)}>{v.title || v.id} <Copy className="inline h-3 w-3" /></button>
                          </td>
                          <td className="px-3 py-2 text-right text-xs">{formatNumber(v.view_count)}</td>
                          <td className="px-3 py-2 text-right text-xs">{formatNumber(v.like_count)}</td>
                          <td className="px-3 py-2 text-right text-xs">{formatNumber(v.comment_count)}</td>
                          <td className="px-3 py-2 text-xs">{v.created_at ? new Date(v.created_at).toLocaleDateString('vi') : '-'}</td>
                          <td className="px-3 py-2 text-xs" title={v.error}>{v.status === 'idle' ? 'Sẵn sàng' : v.status === 'loading_audio' ? 'Đang tải MP3' : v.status === 'loading_video' ? 'Đang tải MP4' : v.status === 'success_audio' ? 'Đã tải MP3' : v.status === 'success_video' ? 'Đã tải MP4' : `Lỗi: ${v.error || ''}`}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={channelProcessing || loading.audio || loading.video} onClick={() => handleChannelDownloadAudio(v.url, v.id, index)}>
                                {loading.audio ? <Loader2 className="h-3 w-3 animate-spin" /> : 'MP3'}
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={channelProcessing || loading.audio || loading.video} onClick={() => handleChannelDownloadVideo(v.url, v.id, index)}>
                                {loading.video ? <Loader2 className="h-3 w-3 animate-spin" /> : 'MP4'}
                              </Button>
                              <a href={v.url} target="_blank" rel="noopener noreferrer" title="Xem trên TikTok" className="h-6 w-6 inline-flex items-center justify-center rounded border"><ExternalLink className="h-3 w-3" /></a>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" disabled={channelProcessing} title="Xóa khỏi danh sách" onClick={() => { if (window.confirm('Xóa video này khỏi danh sách?')) setChannelVideos(p => p.filter(item => item.id !== v.id)); }}><Trash2 className="h-3 w-3" /></Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
              <Pagination count={channelVideos.length} page={channelPage} pageSize={channelPageSize} onPage={setChannelPage} onPageSize={size => { setChannelPageSize(size); setChannelPage(0); }} />
            </div>
          )}
        </TabsContent>

        {/* Audio Tab */}
        <TabsContent value="audio" className="space-y-4">
          <Card className="p-6">
            <label className="text-sm font-semibold block mb-2">Danh sách link TikTok để tải audio MP3</label>
            <Textarea value={audioUrlText} onChange={e => { setAudioUrlText(e.target.value); setIsAudioFormatted(false); }} placeholder="URLs TikTok..." className="min-h-[120px] font-mono text-sm mb-3" disabled={isProcessingAudio} />
            <div className="flex gap-2">
              <Button onClick={() => { const u = parseUrls(audioUrlText); if (!u.length) { toast.error('Vui lòng nhập link'); return; } setAudioUrlText(u.join(', ')); setIsAudioFormatted(true); toast.success('Đã định dạng'); }} variant="outline" disabled={isProcessingAudio}>Định dạng danh sách link</Button>
              <Button onClick={() => processBulk('audio', audioUrlText, setAudioData, setIsProcessingAudio)} disabled={!isAudioFormatted || isProcessingAudio}>
                {isProcessingAudio ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang tải...</> : 'Bắt đầu tải Audio'}
              </Button>
              {audioData.length > 0 && <>
                <Button variant="outline" disabled={isProcessingAudio} onClick={() => exportExcel('audio')}><FileSpreadsheet className="h-4 w-4 mr-1" /> Xuất Excel</Button>
                <Button variant="ghost" disabled={isProcessingAudio} onClick={() => { setAudioData([]); setAudioUrlText(''); setIsAudioFormatted(false); setAudioPage(0); }}>Xóa kết quả</Button>
              </>}
            </div>
          </Card>
          {audioData.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left w-12">#</th><th className="px-3 py-2 text-left">URL</th><th className="px-3 py-2 text-left w-28">Trạng thái</th><th className="px-3 py-2 text-left">Tiêu đề</th><th className="px-3 py-2 text-left">Lỗi</th><th className="px-3 py-2 text-left">Thao tác</th></tr></thead>
                <tbody>{audioData.slice(audioPage * audioPageSize, (audioPage + 1) * audioPageSize).map(item => (
                  <tr key={item.id} className="border-b border-border/50"><td className="px-3 py-2">{item.id}</td><td className="px-3 py-2 font-mono text-xs truncate max-w-xs"><a href={item.videoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.videoUrl}</a></td><td className="px-3 py-2"><StatusBadge {...item} /></td><td className="px-3 py-2 text-xs"><button type="button" title="Sao chép tiêu đề" onClick={() => void copyText(item.title || '')}>{item.title || '-'}{item.title && <Copy className="inline h-3 w-3 ml-1" />}</button></td><td className="px-3 py-2 text-xs text-red-500 truncate max-w-xs">{item.error || ''}</td><td className="px-3 py-2"><div className="flex gap-1"><Button size="sm" variant="outline" disabled={isProcessingAudio} onClick={() => void retryBulkItem('audio', item)}>Tải MP3</Button><Button size="sm" variant="ghost" disabled={isProcessingAudio} title="Xóa khỏi danh sách" onClick={() => { if (window.confirm('Xóa link này khỏi danh sách?')) setAudioData(p => p.filter(row => row.id !== item.id)); }}><Trash2 className="h-3 w-3" /></Button></div></td></tr>
                ))}</tbody>
              </table>
              <Pagination count={audioData.length} page={audioPage} pageSize={audioPageSize} onPage={setAudioPage} onPageSize={size => { setAudioPageSize(size); setAudioPage(0); }} />
            </Card>
          )}
        </TabsContent>

        {/* Video Tab */}
        <TabsContent value="video" className="space-y-4">
          <Card className="p-6">
            <label className="text-sm font-semibold block mb-2">Danh sách link TikTok để tải video MP4</label>
            <Textarea value={videoUrlText} onChange={e => { setVideoUrlText(e.target.value); setIsVideoFormatted(false); }} placeholder="URLs TikTok..." className="min-h-[120px] font-mono text-sm mb-3" disabled={isProcessingVideo} />
            <div className="flex gap-2">
              <Button onClick={() => { const u = parseUrls(videoUrlText); if (!u.length) { toast.error('Vui lòng nhập link'); return; } setVideoUrlText(u.join(', ')); setIsVideoFormatted(true); toast.success('Đã định dạng'); }} variant="outline" disabled={isProcessingVideo}>Định dạng danh sách link</Button>
              <Button onClick={() => processBulk('video', videoUrlText, setVideoData, setIsProcessingVideo)} disabled={!isVideoFormatted || isProcessingVideo}>
                {isProcessingVideo ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang tải...</> : 'Bắt đầu tải Video'}
              </Button>
              {videoData.length > 0 && <>
                <Button variant="outline" disabled={isProcessingVideo} onClick={() => exportExcel('video')}><FileSpreadsheet className="h-4 w-4 mr-1" /> Xuất Excel</Button>
                <Button variant="ghost" disabled={isProcessingVideo} onClick={() => { setVideoData([]); setVideoUrlText(''); setIsVideoFormatted(false); setVideoPage(0); }}>Xóa kết quả</Button>
              </>}
            </div>
          </Card>
          {videoData.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left w-12">#</th><th className="px-3 py-2 text-left">URL</th><th className="px-3 py-2 text-left w-28">Trạng thái</th><th className="px-3 py-2 text-left">Tiêu đề</th><th className="px-3 py-2 text-left">Lỗi</th><th className="px-3 py-2 text-left">Thao tác</th></tr></thead>
                <tbody>{videoData.slice(videoPage * videoPageSize, (videoPage + 1) * videoPageSize).map(item => (
                  <tr key={item.id} className="border-b border-border/50"><td className="px-3 py-2">{item.id}</td><td className="px-3 py-2 font-mono text-xs truncate max-w-xs"><a href={item.videoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.videoUrl}</a></td><td className="px-3 py-2"><StatusBadge {...item} /></td><td className="px-3 py-2 text-xs"><button type="button" title="Sao chép tiêu đề" onClick={() => void copyText(item.title || '')}>{item.title || '-'}{item.title && <Copy className="inline h-3 w-3 ml-1" />}</button></td><td className="px-3 py-2 text-xs text-red-500 truncate max-w-xs">{item.error || ''}</td><td className="px-3 py-2"><div className="flex gap-1"><Button size="sm" variant="outline" disabled={isProcessingVideo} onClick={() => void retryBulkItem('video', item)}>Tải MP4</Button><Button size="sm" variant="ghost" disabled={isProcessingVideo} title="Xóa khỏi danh sách" onClick={() => { if (window.confirm('Xóa link này khỏi danh sách?')) setVideoData(p => p.filter(row => row.id !== item.id)); }}><Trash2 className="h-3 w-3" /></Button></div></td></tr>
                ))}</tbody>
              </table>
              <Pagination count={videoData.length} page={videoPage} pageSize={videoPageSize} onPage={setVideoPage} onPageSize={size => { setVideoPageSize(size); setVideoPage(0); }} />
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
