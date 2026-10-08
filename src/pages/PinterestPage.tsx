import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Progress } from '../components/ui/progress';
import {
  pinterestService,
  type PinterestChannelResponse,
  type PinterestChannelItem,
} from '../services/pinterest.service';
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
  Image,
  FileSpreadsheet,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';

const PinterestIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" {...props}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.4 7.63 11.16-.1-.95-.2-2.4.04-3.43.22-.93 1.4-5.93 1.4-5.93s-.36-.72-.36-1.77c0-1.66.96-2.9 2.16-2.9 1.02 0 1.51.77 1.51 1.68 0 1.03-.65 2.56-.99 3.98-.28 1.19.6 2.16 1.77 2.16 2.12 0 3.76-2.24 3.76-5.47 0-2.86-2.06-4.86-5-4.86-3.4 0-5.4 2.55-5.4 5.2 0 1.03.4 2.14.9 2.74.1.12.11.23.08.35-.1.39-.31 1.25-.35 1.42-.05.2-.18.24-.4.14-1.5-.7-2.43-2.9-2.43-4.66 0-3.8 2.76-7.28 7.95-7.28 4.17 0 7.42 2.97 7.42 6.95 0 4.14-2.61 7.48-6.24 7.48-1.22 0-2.37-.63-2.76-1.38l-.75 2.86c-.27 1.04-1 2.34-1.5 3.14C9.14 23.75 10.53 24 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z" />
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

const parseUrls = (value: string) => value.split(/[\s,]+/).map(url => url.trim()).filter(Boolean);

function Pagination({ count, page, pageSize, onPage, onPageSize, sizes = [50, 100] }: {
  count: number; page: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void; sizes?: number[];
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  return <div className="flex items-center justify-end flex-wrap gap-2 p-3 text-sm text-muted-foreground">
    <span>{count ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)} / ${count}` : '0 / 0'}</span>
    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Trước</Button>
    <span>{page + 1}/{pages}</span>
    <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Sau</Button>
    <select aria-label="Số dòng mỗi trang" className="h-8 rounded-md border bg-background px-2" value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>
      {sizes.map(size => <option key={size} value={size}>{size}</option>)}
    </select>
  </div>;
}

export function PinterestPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = ['channel', 'audio', 'video', 'image'].includes(searchParams.get('tab') || '') ? searchParams.get('tab')! : 'channel';

  // Channel state
  const [channelUrl, setChannelUrl] = useState('');
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelData, setChannelData] = useState<PinterestChannelResponse | null>(null);
  const [scannedUrl, setScannedUrl] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all');
  const [channelPage, setChannelPage] = useState(0);
  const [channelPageSize, setChannelPageSize] = useState(100);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isExportingImages, setIsExportingImages] = useState(false);
  const [rowLoading, setRowLoading] = useState<Record<string, { audio?: boolean; video?: boolean; image?: boolean }>>({});

  // Bulk states
  const [audioUrlText, setAudioUrlText] = useState('');
  const [isAudioFormatted, setIsAudioFormatted] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [audioData, setAudioData] = useState<BulkItem[]>([]);
  const [audioPage, setAudioPage] = useState(0);
  const [audioPageSize, setAudioPageSize] = useState(50);

  const [videoUrlText, setVideoUrlText] = useState('');
  const [isVideoFormatted, setIsVideoFormatted] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [videoData, setVideoData] = useState<BulkItem[]>([]);
  const [videoPage, setVideoPage] = useState(0);
  const [videoPageSize, setVideoPageSize] = useState(50);

  const [imageUrlText, setImageUrlText] = useState('');
  const [isImageFormatted, setIsImageFormatted] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [imageData, setImageData] = useState<BulkItem[]>([]);
  const [imagePage, setImagePage] = useState(0);
  const [imagePageSize, setImagePageSize] = useState(50);

  useEffect(() => { setAudioPage(page => Math.min(page, Math.max(0, Math.ceil(audioData.length / audioPageSize) - 1))); }, [audioData.length, audioPageSize]);
  useEffect(() => { setVideoPage(page => Math.min(page, Math.max(0, Math.ceil(videoData.length / videoPageSize) - 1))); }, [videoData.length, videoPageSize]);
  useEffect(() => { setImagePage(page => Math.min(page, Math.max(0, Math.ceil(imageData.length / imagePageSize) - 1))); }, [imageData.length, imagePageSize]);

  const downloadFile = (blobUrl: string, filename: string, blob?: Blob) => {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (blob) setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
  };

  const formatNumber = (n?: number) => (n == null ? '-' : new Intl.NumberFormat().format(n));

  // Channel
  const fetchChannel = async (url: string, page: number, pageSize: number, filter: 'all' | 'image' | 'video') => {
    if (!url.trim()) { toast.error('Nhập URL kênh Pinterest'); return; }
    setChannelLoading(true);
    try {
      const r = await pinterestService.getChannel(url, filter === 'all' ? undefined : filter, page + 1, pageSize);
      if (r.success) { setChannelData(r); setScannedUrl(url); setChannelPage(page); setChannelPageSize(pageSize); setTypeFilter(filter); }
      else toast.error(r.error || 'Lỗi');
    } catch (e: any) { toast.error(e.message); }
    finally { setChannelLoading(false); }
  };

  const handleGetChannel = () => { setChannelData(null); void fetchChannel(channelUrl.trim(), 0, channelPageSize, typeFilter); };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try { const r = await pinterestService.clearCache(); if (r.success) { setChannelData(null); setScannedUrl(''); toast.success(r.message); } }
    catch (e: any) { toast.error(e.message); }
    finally { setIsClearingCache(false); }
  };

  const handleExportExcel = async () => {
    if (!channelData) return;
    setChannelLoading(true);
    try {
      const r = await pinterestService.exportChannelExcel(scannedUrl, typeFilter === 'all' ? undefined : typeFilter);
      downloadFile(URL.createObjectURL(r.blob), r.filename, r.blob);
      toast.success('Xuất Excel thành công');
    } catch { toast.error('Lỗi xuất Excel'); }
    finally { setChannelLoading(false); }
  };

  const handleExportImages = async () => {
    if (!channelData) return;
    setIsExportingImages(true);
    try {
      const r = await pinterestService.exportChannelImagesZip(scannedUrl, typeFilter === 'all' ? undefined : typeFilter);
      downloadFile(URL.createObjectURL(r.blob), r.filename, r.blob);
      toast.success('Tải ảnh ZIP thành công');
    } catch { toast.error('Lỗi tải ảnh'); }
    finally { setIsExportingImages(false); }
  };

  const handleRowDownloadAudio = async (pinUrl: string, id: string, idx: number) => {
    setRowLoading(p => ({ ...p, [id]: { ...p[id], audio: true } }));
    try {
      const r = await pinterestService.getAudio(pinUrl);
      if (r.success && r.audioUrl) { downloadFile(r.audioUrl, `${idx}.mp3`, r.blob); toast.success(`Tải: ${idx}.mp3`); }
      else toast.error(r.error || 'Lỗi');
    } catch (e: any) { toast.error(e.message); }
    finally { setRowLoading(p => ({ ...p, [id]: { ...p[id], audio: false } })); }
  };

  const handleRowDownloadVideo = async (pinUrl: string, id: string, idx: number) => {
    setRowLoading(p => ({ ...p, [id]: { ...p[id], video: true } }));
    try {
      const r = await pinterestService.getVideo(pinUrl);
      if (r.success && r.videoUrl) { downloadFile(r.videoUrl, `${idx}.mp4`, r.blob); toast.success(`Tải: ${idx}.mp4`); }
      else toast.error(r.error || 'Lỗi');
    } catch (e: any) { toast.error(e.message); }
    finally { setRowLoading(p => ({ ...p, [id]: { ...p[id], video: false } })); }
  };

  const handleRowDownloadImage = async (pinUrl: string, id: string, idx: number) => {
    setRowLoading(p => ({ ...p, [id]: { ...p[id], image: true } }));
    try {
      const r = await pinterestService.getImage(pinUrl);
      if (r.success && r.imageUrl) { downloadFile(r.imageUrl, `${idx}.jpg`, r.blob); toast.success(`Tải: ${idx}.jpg`); }
      else toast.error(r.error || 'Lỗi');
    } catch (e: any) { toast.error(e.message); }
    finally { setRowLoading(p => ({ ...p, [id]: { ...p[id], image: false } })); }
  };

  // Bulk
  const processBulk = async (
    type: 'audio' | 'video' | 'image',
    urlText: string,
    setData: React.Dispatch<React.SetStateAction<BulkItem[]>>,
    setProcessing: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    const urls = parseUrls(urlText);
    if (!urls.length) return;
    setData(urls.map((videoUrl, index) => ({ id: index + 1, videoUrl, status: 'pending', progress: 0 })));
    setProcessing(true);
    let ok = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const id = i + 1;
      setData(p => p.map(it => it.id === id ? { ...it, status: 'loading', progress: 30, error: undefined } : it));
      try {
        let dlUrl: string | undefined;
        let blob: Blob | undefined;
        let title: string | undefined;
        if (type === 'audio') { const r = await pinterestService.getAudio(url); dlUrl = r.audioUrl; blob = r.blob; title = r.title; if (!r.success) throw new Error(r.error); }
        else if (type === 'video') { const r = await pinterestService.getVideo(url); dlUrl = r.videoUrl; blob = r.blob; title = r.title; if (!r.success) throw new Error(r.error); }
        else { const r = await pinterestService.getImage(url); dlUrl = r.imageUrl; blob = r.blob; title = r.title; if (!r.success) throw new Error(r.error); }
        if (dlUrl) {
          setData(p => p.map(it => it.id === id ? { ...it, status: 'success', progress: 100, title } : it));
          const ext = type === 'audio' ? 'mp3' : type === 'video' ? 'mp4' : 'jpg';
          downloadFile(dlUrl, `${i + 1}.${ext}`, blob);
          ok++;
        }
      } catch (e: any) {
        setData(p => p.map(it => it.id === id ? { ...it, status: 'failed', progress: 0, error: e.message } : it));
      }
    }
    setProcessing(false);
    toast.success(`Hoàn thành: ${ok}/${urls.length}`);
  };

  const StatusBadge = ({ status, progress, error }: { status: BulkStatus; progress: number; error?: string }) => {
    if (status === 'pending') return <div className="flex items-center gap-1 text-muted-foreground text-xs"><Clock className="h-3 w-3" /> Chờ</div>;
    if (status === 'loading') return <div className="space-y-1"><div className="flex items-center gap-1 text-xs text-red-500"><Loader2 className="h-3 w-3 animate-spin" /> {progress}%</div><Progress value={progress} className="h-1" /></div>;
    if (status === 'success') return <div className="flex items-center gap-1 text-green-500 text-xs"><CheckCircle className="h-3 w-3" /> OK</div>;
    return <div className="flex items-center gap-1 text-red-500 text-xs" title={error}><XCircle className="h-3 w-3" /> Lỗi</div>;
  };

  const BulkTable = ({ data, page, pageSize, onPage, onPageSize }: { data: BulkItem[]; page: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) => (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left w-12">#</th><th className="px-3 py-2 text-left">URL Pin</th><th className="px-3 py-2 text-left w-28">Trạng thái</th><th className="px-3 py-2 text-left">Tên file</th><th className="px-3 py-2 text-left">Chi tiết lỗi</th></tr></thead>
        <tbody>{data.slice(page * pageSize, (page + 1) * pageSize).map(item => (
          <tr key={item.id} className="border-b border-border/50"><td className="px-3 py-2">{item.id}</td><td className="px-3 py-2 font-mono text-xs truncate max-w-xs"><a href={item.videoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.videoUrl}</a></td><td className="px-3 py-2"><StatusBadge {...item} /></td><td className="px-3 py-2 text-xs truncate max-w-xs" title={item.title}>{item.title || '-'}</td><td className="px-3 py-2 text-xs text-red-500 truncate max-w-xs" title={item.error}>{item.error || '-'}</td></tr>
        ))}</tbody>
      </table>
      <Pagination count={data.length} page={page} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} />
    </Card>
  );

  return (
    <div className="space-y-6 min-w-0 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <div className="p-2 bg-red-600 rounded-lg text-white shadow-md"><PinterestIcon className="h-6 w-6" /></div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-red-600">Pinterest Downloader & Tools</h1>
          <p className="text-muted-foreground text-sm">Tải audio, video, ảnh và quét kênh từ Pinterest.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={tab => setSearchParams({ tab }, { replace: true })} className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1 max-w-[1000px] mb-4">
          <TabsTrigger value="channel" className="flex items-center gap-1.5 py-2"><User className="h-4 w-4" /> Lấy thông tin kênh</TabsTrigger>
          <TabsTrigger value="audio" className="flex items-center gap-1.5 py-2"><Music className="h-4 w-4" /> Tải audio hàng loạt</TabsTrigger>
          <TabsTrigger value="video" className="flex items-center gap-1.5 py-2"><Video className="h-4 w-4" /> Tải video hàng loạt</TabsTrigger>
          <TabsTrigger value="image" className="flex items-center gap-1.5 py-2"><Image className="h-4 w-4" /> Tải ảnh hàng loạt</TabsTrigger>
        </TabsList>

        {/* Channel Tab */}
        <TabsContent value="channel" className="space-y-4">
          <Card className="min-w-0 p-4 sm:p-6">
            <label className="text-sm font-semibold block mb-2">Nhập URL kênh Pinterest</label>
            <div className="flex flex-wrap gap-2">
              <Input value={channelUrl} onChange={e => setChannelUrl(e.target.value)} placeholder="https://www.pinterest.com/username/_created/" className="w-full min-w-0 sm:flex-1 sm:min-w-60 h-11" disabled={channelLoading} />
              <Button onClick={handleGetChannel} disabled={channelLoading} className="h-11 bg-red-600 hover:bg-red-700 text-white">
                {channelLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang quét...</> : 'Quét kênh'}
              </Button>
              <Button onClick={handleClearCache} disabled={isClearingCache} variant="outline" className="h-11 text-red-500">
                {isClearingCache ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Xóa cache'}
              </Button>
            </div>
          </Card>

          {channelData?.user && (
            <Card className="p-4 flex items-center gap-4">
              <div>
                <h2 className="font-bold text-lg">{channelData.user.full_name || channelData.user.username}</h2>
                <p className="text-sm text-red-600 font-mono">@{channelData.user.username}</p>
                {channelData.user.id && <p className="text-xs text-muted-foreground font-mono">ID: {channelData.user.id}</p>}
                <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                  <span><strong className="text-foreground">{formatNumber(channelData.user.follower_count)}</strong> followers</span>
                  <span><strong className="text-foreground">{formatNumber(channelData.user.pin_count)}</strong> pins</span>
                </div>
              </div>
            </Card>
          )}

          {channelData && (
            <div className="space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {channelData.pagination?.totalCount ?? channelData.items?.length ?? 0} pins
                </h3>
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Lọc ghim" className="h-8 rounded-md border bg-background px-2 text-xs" value={typeFilter} disabled={channelLoading} onChange={event => void fetchChannel(scannedUrl, 0, channelPageSize, event.target.value as 'all' | 'image' | 'video')}>
                    <option value="all">Tất cả</option><option value="image">Ảnh</option><option value="video">Video</option>
                  </select>
                  <Button onClick={handleExportExcel} disabled={!channelData.items?.length || channelLoading} className="bg-green-600 hover:bg-green-700 text-white text-xs h-8">
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> Xuất Excel
                  </Button>
                  <Button onClick={handleExportImages} disabled={!channelData.items?.length || isExportingImages} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8">
                    {isExportingImages ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />} Tải ảnh ZIP
                  </Button>
                </div>
              </div>
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left w-12">#</th>
                      <th className="px-3 py-2 text-left w-16">Ảnh</th>
                      <th className="px-3 py-2 text-left">Link pin</th>
                      <th className="px-3 py-2 text-left">Tiêu đề / Mô tả</th>
                      <th className="px-3 py-2 text-left w-16">Loại</th>
                      <th className="px-3 py-2 text-right w-16">Thích</th>
                      <th className="px-3 py-2 text-right w-16">Chia sẻ</th>
                      <th className="px-3 py-2 text-right w-16">Lưu</th>
                      <th className="px-3 py-2 text-right w-16">BL</th>
                      <th className="px-3 py-2 text-left w-24">Ngày</th>
                      <th className="px-3 py-2 text-left w-40">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(channelData.items || []).map((pin, i) => {
                      const loading = rowLoading[pin.id] || {};
                      const index = channelPage * channelPageSize + i + 1;
                      return (
                        <tr key={pin.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2">{index}</td>
                          <td className="px-3 py-2">
                            {pin.image_url && <img src={pin.image_url} alt="" className="w-10 h-10 object-cover rounded" />}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono"><a href={pin.pin_url} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline">{pin.id} <ExternalLink className="inline h-3 w-3" /></a></td>
                          <td className="px-3 py-2">
                            <div className="max-w-[200px] truncate text-xs group flex items-center gap-1">
                              <span title={pin.title || pin.description || ''}>{pin.title || pin.description || '-'}</span>
                              {(pin.title || pin.description) && (
                                <button onClick={() => { navigator.clipboard.writeText(pin.title || pin.description || ''); toast.success('Đã copy'); }} className="opacity-0 group-hover:opacity-100">
                                  <Copy className="h-3 w-3 text-muted-foreground" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs font-medium">{pin.is_video ? <span className="text-blue-500">Video</span> : <span className="text-zinc-500">Ảnh</span>}</td>
                          <td className="px-3 py-2 text-right text-xs">{formatNumber(pin.like_count)}</td>
                          <td className="px-3 py-2 text-right text-xs">{formatNumber(pin.repin_count)}</td>
                          <td className="px-3 py-2 text-right text-xs">{formatNumber(pin.save_count)}</td>
                          <td className="px-3 py-2 text-right text-xs">{formatNumber(pin.comment_count)}</td>
                          <td className="px-3 py-2 text-xs">{pin.created_at ? new Date(pin.created_at).toLocaleDateString('vi') : '-'}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {pin.is_video && (
                                <>
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={loading.audio} onClick={() => handleRowDownloadAudio(pin.pin_url, pin.id, index)}>
                                    {loading.audio ? <Loader2 className="h-3 w-3 animate-spin" /> : 'MP3'}
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={loading.video} onClick={() => handleRowDownloadVideo(pin.pin_url, pin.id, index)}>
                                    {loading.video ? <Loader2 className="h-3 w-3 animate-spin" /> : 'MP4'}
                                  </Button>
                                </>
                              )}
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={loading.image} onClick={() => handleRowDownloadImage(pin.pin_url, pin.id, index)}>
                                {loading.image ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Ảnh'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!channelData.items?.length && <p className="p-4 text-sm text-muted-foreground">Không có ghim phù hợp bộ lọc này.</p>}
              </Card>
              <Pagination count={channelData.pagination?.totalCount ?? channelData.items?.length ?? 0} page={channelPage} pageSize={channelPageSize} sizes={[100, 200]} onPage={page => void fetchChannel(scannedUrl, page, channelPageSize, typeFilter)} onPageSize={size => void fetchChannel(scannedUrl, 0, size, typeFilter)} />
            </div>
          )}
        </TabsContent>

        {/* Audio Tab */}
        <TabsContent value="audio" className="space-y-4">
          <Card className="min-w-0 p-4 sm:p-6">
            <label className="text-sm font-semibold block mb-2">Nhập URLs Pinterest để tải audio</label>
            <Textarea value={audioUrlText} onChange={e => { setAudioUrlText(e.target.value); setIsAudioFormatted(false); }} placeholder="URLs Pinterest..." className="min-h-[120px] font-mono text-sm mb-3" disabled={isProcessingAudio} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { const u = parseUrls(audioUrlText); if (!u.length) { toast.error('Vui lòng nhập link'); return; } setAudioUrlText(u.join(', ')); setIsAudioFormatted(true); toast.success('Đã định dạng'); }} variant="outline" disabled={isProcessingAudio}>Định dạng URL</Button>
              <Button onClick={() => processBulk('audio', audioUrlText, setAudioData, setIsProcessingAudio)} disabled={!isAudioFormatted || isProcessingAudio} className="bg-red-600 hover:bg-red-700 text-white">
                {isProcessingAudio ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang tải...</> : 'Tải Audio Hàng Loạt'}
              </Button>
            </div>
          </Card>
          {audioData.length > 0 && <BulkTable data={audioData} page={audioPage} pageSize={audioPageSize} onPage={setAudioPage} onPageSize={size => { setAudioPageSize(size); setAudioPage(0); }} />}
        </TabsContent>

        {/* Video Tab */}
        <TabsContent value="video" className="space-y-4">
          <Card className="min-w-0 p-4 sm:p-6">
            <label className="text-sm font-semibold block mb-2">Nhập URLs Pinterest để tải video</label>
            <Textarea value={videoUrlText} onChange={e => { setVideoUrlText(e.target.value); setIsVideoFormatted(false); }} placeholder="URLs Pinterest..." className="min-h-[120px] font-mono text-sm mb-3" disabled={isProcessingVideo} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { const u = parseUrls(videoUrlText); if (!u.length) { toast.error('Vui lòng nhập link'); return; } setVideoUrlText(u.join(', ')); setIsVideoFormatted(true); toast.success('Đã định dạng'); }} variant="outline" disabled={isProcessingVideo}>Định dạng URL</Button>
              <Button onClick={() => processBulk('video', videoUrlText, setVideoData, setIsProcessingVideo)} disabled={!isVideoFormatted || isProcessingVideo} className="bg-red-600 hover:bg-red-700 text-white">
                {isProcessingVideo ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang tải...</> : 'Tải Video Hàng Loạt'}
              </Button>
            </div>
          </Card>
          {videoData.length > 0 && <BulkTable data={videoData} page={videoPage} pageSize={videoPageSize} onPage={setVideoPage} onPageSize={size => { setVideoPageSize(size); setVideoPage(0); }} />}
        </TabsContent>

        {/* Image Tab */}
        <TabsContent value="image" className="space-y-4">
          <Card className="min-w-0 p-4 sm:p-6">
            <label className="text-sm font-semibold block mb-2">Nhập URLs Pinterest để tải ảnh</label>
            <Textarea value={imageUrlText} onChange={e => { setImageUrlText(e.target.value); setIsImageFormatted(false); }} placeholder="URLs Pinterest..." className="min-h-[120px] font-mono text-sm mb-3" disabled={isProcessingImage} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { const u = parseUrls(imageUrlText); if (!u.length) { toast.error('Vui lòng nhập link'); return; } setImageUrlText(u.join(', ')); setIsImageFormatted(true); toast.success('Đã định dạng'); }} variant="outline" disabled={isProcessingImage}>Định dạng URL</Button>
              <Button onClick={() => processBulk('image', imageUrlText, setImageData, setIsProcessingImage)} disabled={!isImageFormatted || isProcessingImage} className="bg-red-600 hover:bg-red-700 text-white">
                {isProcessingImage ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang tải...</> : 'Tải Ảnh Hàng Loạt'}
              </Button>
            </div>
          </Card>
          {imageData.length > 0 && <BulkTable data={imageData} page={imagePage} pageSize={imagePageSize} onPage={setImagePage} onPageSize={size => { setImagePageSize(size); setImagePage(0); }} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
