import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/youtube-ui/tabs'
import { Youtube, FileText, Music, List, Video } from 'lucide-react'
import { FormatUrls } from '@/components/FormatUrls'
import { AudioYoutube } from '@/components/AudioYoutube'
import VideoViewPages from '@/pages/video-view'
import { VideoYoutube } from '@/components/VideoYoutube'

export const YouTubeToolsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'video-view'

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val }, { replace: true })
  }

  return (
    <div className='youtube-page space-y-6 mx-auto w-full p-3 sm:p-6'>
      <div className='flex items-center gap-3 border-b pb-4'>
        <div className='p-2 bg-gradient-to-tr from-red-500 to-red-600 rounded-lg text-white shadow-md shrink-0 animate-pulse'>
          <Youtube className='h-6 w-6' />
        </div>
        <div>
          <h1 className='text-2xl font-bold tracking-tight bg-gradient-to-tr from-red-600 to-orange-600 bg-clip-text text-transparent'>
            YouTube Downloader & Tools
          </h1>
          <p className='text-muted-foreground text-sm'>
            Tải audio, video, quét kịch bản và lấy danh sách video YouTube.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className='w-full'>
        <TabsList className='grid w-full grid-cols-2 xl:grid-cols-4 h-auto p-1 max-w-[800px] mb-4'>
          <TabsTrigger value='video-view' className='flex items-center gap-1.5 py-2'>
            <List className='h-4 w-4' />
            Video view
          </TabsTrigger>
          <TabsTrigger value='format-urls' className='flex items-center gap-1.5 py-2'>
            <FileText className='h-4 w-4' />
            Lấy tiêu đề kịch bản
          </TabsTrigger>
          <TabsTrigger value='audio' className='flex items-center gap-1.5 py-2'>
            <Music className='h-4 w-4' />
            Lấy audio gốc
          </TabsTrigger>
          <TabsTrigger value='video-youtube' className='flex items-center gap-1.5 py-2'>
            <Video className='h-4 w-4' />
            Tải video YouTube
          </TabsTrigger>
        </TabsList>

        <TabsContent value='video-view' className='space-y-4'>
          <VideoViewPages />
        </TabsContent>
        <TabsContent value='format-urls' className='space-y-4'>
          <FormatUrls />
        </TabsContent>
        <TabsContent value='audio' className='space-y-4'>
          <AudioYoutube />
        </TabsContent>
        <TabsContent value='video-youtube' className='space-y-4'>
          <VideoYoutube />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default YouTubeToolsPage
