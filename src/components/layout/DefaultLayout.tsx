import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { Button } from '../ui/button';
import { FolderDown, Menu, Moon, Sun } from 'lucide-react';
import { Toaster } from 'sonner';

export function DefaultLayout() {
  const { pathname } = useLocation();
  const isYouTube = pathname === '/' || pathname === '/youtube-tools';
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') {
        const root = document.documentElement;
        if (saved === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        return saved;
      }
    } catch {
      // ignore
    }
    const root = document.documentElement;
    return root.classList.contains('dark') ? 'dark' : 'light';
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadDirectory, setDownloadDirectory] = useState<string | null>(null);
  const [choosingDirectory, setChoosingDirectory] = useState(false);

  useEffect(() => {
    void window.desktopDownloads?.getDirectory().then(setDownloadDirectory).catch(() => {});
    return window.desktopDownloads?.onDirectoryChanged(setDownloadDirectory);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
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
      try {
        localStorage.setItem('theme', next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div className="app-shell flex h-dvh w-full min-h-0 bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      {menuOpen && <button type="button" className="fixed inset-0 z-40 bg-black/50 md:hidden" aria-label="Đóng menu điều hướng" onClick={() => setMenuOpen(false)} />}
      <AppSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between md:justify-end gap-2 px-3 sm:px-4 border-b border-border bg-background/95 backdrop-blur shrink-0">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 md:hidden" aria-label="Mở menu điều hướng" aria-expanded={menuOpen} aria-controls="app-navigation" onClick={() => setMenuOpen(true)}><Menu className="h-5 w-5" /></Button>
          <div className="flex min-w-0 items-center gap-2">
            {window.desktopDownloads && (
              <Button variant="outline" size="sm" onClick={() => void chooseDownloadDirectory()} disabled={choosingDirectory} title={downloadDirectory || 'Chưa chọn thư mục tải xuống'} className="min-w-0 max-w-[calc(100vw-8rem)] sm:max-w-[320px] gap-2">
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
              aria-label={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className={`flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain ${isYouTube ? 'youtube-page bg-background text-foreground' : 'p-3 sm:p-4 md:p-6'}`}>
          <Outlet />
        </main>
      </div>

      {/* Toast */}
      <Toaster position="bottom-right" richColors theme={theme} />
    </div>
  );
}
