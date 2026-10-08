import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Youtube, Instagram, ChevronLeft, ChevronRight, Settings, X, Rocket, FileText, Subtitles, FileAudio, Scissors } from 'lucide-react';
import { Button } from '../ui/button';

const TikTokIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" {...props}>
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.63 4.14 1.02 1.11 2.45 1.8 3.97 1.93v3.86c-1.39-.08-2.77-.57-3.92-1.37a8.03 8.03 0 01-2.43-2.6v7.35c.03 1.54-.36 3.09-1.12 4.43-.8 1.42-2 2.58-3.46 3.3-1.52.76-3.25.99-4.9.68-1.63-.3-3.15-1.2-4.22-2.48a8.3 8.3 0 01-1.74-4.52c-.11-1.65.25-3.32 1.05-4.76.81-1.45 2.06-2.61 3.56-3.3 1.25-.57 2.63-.78 3.98-.62V8.2c-1.02-.15-2.07.03-3 .52a4.42 4.42 0 00-2.22 2.5 4.38 4.38 0 00.32 3.65c.67.99 1.76 1.64 2.94 1.77 1.2.14 2.44-.2 3.34-1 .85-.75 1.34-1.85 1.36-2.98V.02z" />
  </svg>
);

const PinterestIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" {...props}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.4 7.63 11.16-.1-.95-.2-2.4.04-3.43.22-.93 1.4-5.93 1.4-5.93s-.36-.72-.36-1.77c0-1.66.96-2.9 2.16-2.9 1.02 0 1.51.77 1.51 1.68 0 1.03-.65 2.56-.99 3.98-.28 1.19.6 2.16 1.77 2.16 2.12 0 3.76-2.24 3.76-5.47 0-2.86-2.06-4.86-5-4.86-3.4 0-5.4 2.55-5.4 5.2 0 1.03.4 2.14.9 2.74.1.12.11.23.08.35-.1.39-.31 1.25-.35 1.42-.05.2-.18.24-.4.14-1.5-.7-2.43-2.9-2.43-4.66 0-3.8 2.76-7.28 7.95-7.28 4.17 0 7.42 2.97 7.42 6.95 0 4.14-2.61 7.48-6.24 7.48-1.22 0-2.37-.63-2.76-1.38l-.75 2.86c-.27 1.04-1 2.34-1.5 3.14C9.14 23.75 10.53 24 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z" />
  </svg>
);

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  color: string;
}

const navItems: NavItem[] = [
  {
    label: 'YouTube',
    path: '/',
    icon: <Youtube className="h-5 w-5" />,
    color: 'text-red-500',
  },
  {
    label: 'Instagram',
    path: '/instagram',
    icon: <Instagram className="h-5 w-5" />,
    color: 'text-pink-500',
  },
  {
    label: 'TikTok',
    path: '/tiktok',
    icon: <TikTokIcon className="h-5 w-5" />,
    color: 'text-foreground',
  },
  {
    label: 'Pinterest',
    path: '/pinterest',
    icon: <PinterestIcon className="h-5 w-5" />,
    color: 'text-red-600',
  },
  {
    label: 'AI / Antigravity',
    path: '/ai',
    icon: <Rocket className="h-5 w-5" />,
    color: 'text-amber-500',
  },
  {
    label: 'AI Script Converter',
    path: '/script-converter',
    icon: <FileText className="h-5 w-5" />,
    color: 'text-violet-500',
  },
  {
    label: 'Convert Audio to SRT', path: '/audio-to-srt', icon: <Subtitles className="h-5 w-5" />, color: 'text-cyan-500',
  },
  {
    label: 'Audio to Script', path: '/audio-to-script', icon: <FileAudio className="h-5 w-5" />, color: 'text-blue-500',
  },
  {
    label: 'Extract Audio', path: '/extract-audio', icon: <Scissors className="h-5 w-5" />, color: 'text-emerald-500',
  },
  {
    label: 'Settings / About',
    path: '/settings',
    icon: <Settings className="h-5 w-5" />,
    color: 'text-primary',
  },
];

export function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside
      id="app-navigation"
      aria-label="Điều hướng ứng dụng"
      className={`fixed inset-y-0 left-0 z-50 w-56 ${open ? 'translate-x-0 visible' : '-translate-x-full invisible md:visible'} md:static md:translate-x-0 ${collapsed ? 'md:w-16' : 'md:w-16 lg:w-56'} flex flex-col min-h-0 border-r border-border bg-background transition-[width,transform] duration-200 ease-in-out shrink-0`}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-3 border-b border-border gap-2">
        <div className="p-1.5 bg-red-600 rounded-lg text-white shadow shrink-0">
          <Youtube className="h-5 w-5" />
        </div>
        <div className={`overflow-hidden ${collapsed ? 'md:hidden' : 'md:hidden lg:block'}`}>
          <h1 className="font-extrabold text-sm tracking-tight whitespace-nowrap">CrawlData</h1>
          <p className="text-[10px] text-muted-foreground whitespace-nowrap">Tools Manager</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="ml-auto h-8 w-8 shrink-0 md:hidden" aria-label="Đóng menu"><X className="h-4 w-4" /></Button>
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 py-2 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path === '/' && location.pathname === '/youtube-tools');
          return (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); onClose(); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className={`shrink-0 ${isActive ? item.color : ''}`}>{item.icon}</span>
              <span className={`truncate ${collapsed ? 'md:hidden' : 'md:hidden lg:inline'}`}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="hidden lg:block border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center h-8"
          aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}
