import { HashRouter, Routes, Route } from 'react-router-dom';
import { DefaultLayout } from './components/layout/DefaultLayout';
import { InstagramPage } from './pages/InstagramPage';
import { TikTokPage } from './pages/TikTokPage';
import { PinterestPage } from './pages/PinterestPage';
import { YouTubeToolsPage } from './pages/YouTubeToolsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AiPage } from './pages/AiPage';
import { ScriptConverterPage } from './pages/ScriptConverterPage';
import { AudioToolsPage } from './pages/AudioToolsPage';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<DefaultLayout />}>
          <Route path="/" element={<YouTubeToolsPage />} />
          <Route path="/youtube-tools" element={<YouTubeToolsPage />} />
          <Route path="/instagram" element={<InstagramPage />} />
          <Route path="/tiktok" element={<TikTokPage />} />
          <Route path="/pinterest" element={<PinterestPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/script-converter" element={<ScriptConverterPage />} />
          <Route path="/audio-to-srt" element={<AudioToolsPage key="srt" tool="srt" />} />
          <Route path="/audio-to-script" element={<AudioToolsPage key="script" tool="script" />} />
          <Route path="/extract-audio" element={<AudioToolsPage key="extract" tool="extract" />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
