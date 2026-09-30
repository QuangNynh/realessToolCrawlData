import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { Button } from '../ui/button';
import { FolderDown, Moon, Sun } from 'lucide-react';
import { Toaster } from 'sonner';

export function DefaultLayout() {
  const { pathname } = useLocation();
  const isYouTube = pathname === '/' || pathname === '/youtube-tools';
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const root = document.documentElement;
    return root.classList.contains('dark') ? 'dark' : 'dark'; // default dark
  });
  const [downloadDirectory, setDownloadDirectory] = useState<string | null>(null);
  const [choosingDirectory, setChoosingDirectory] = useState(false);

  useEffect(() => {
    void window.desktopDownloads?.getDirectory().then(setDownloadDirectory).catch(() => {});
    return window.desktopDownloads?.onDirectoryChanged(setDownloadDirectory);
  }, []);

  const chooseDownloadDirectory = async () => {
    if (!window.desktopDownloads) return;
    setChoosingDirectory(true);
    try {
      const directory = await window.desktopDownloads.chooseDirectory();
      if (directory) setDownloadDirectory(directory);
    } catch (error) {
      console.error('Không thể chọn thư mục tải xuống:', error);
    } finally {
      setChoosingDirectory(false);
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      const root = document.documentElement;
      if (next === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      return next;
    });
  };

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <AppSidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-end px-4 border-b border-border bg-background/95 backdrop-blur shrink-0">
          <div className="flex items-center gap-2">
            {window.desktopDownloads && (
              <Button variant="outline" size="sm" onClick={() => void chooseDownloadDirectory()} disabled={choosingDirectory} title={downloadDirectory || 'Chưa chọn thư mục tải xuống'} className="max-w-[min(55vw,320px)] gap-2">
                <FolderDown className="h-4 w-4 shrink-0" />
                <span className="truncate">{downloadDirectory ? `Lưu tại: ${downloadDirectory.split(/[\\/]/).filter(Boolean).at(-1)}` : 'Chọn thư mục tải xuống'}</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className={`flex-1 overflow-y-auto ${isYouTube ? 'youtube-page bg-background text-foreground' : 'p-4 md:p-6'}`}>
          <Outlet />
        </main>
      </div>

      {/* Toast */}
      <Toaster position="bottom-right" richColors theme={theme} />
    </div>
  );
}
