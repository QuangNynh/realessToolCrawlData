import fs from 'fs';
import path from 'path';
import type { Session } from 'electron';

export class DownloadSettings {
  private readonly file: string;
  private readonly reserved = new Set<string>();
  private directory: string | null = null;

  constructor(userData: string) {
    this.file = path.join(userData, 'download-settings.json');
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof saved.directory === 'string') this.directory = saved.directory;
    } catch { /* First launch or unreadable settings. */ }
  }

  getDirectory() {
    try {
      if (this.directory && fs.statSync(this.directory).isDirectory()) return this.directory;
    } catch { /* The selected folder was removed or is unavailable. */ }
    return null;
  }

  setDirectory(directory: string) {
    if (!fs.statSync(directory).isDirectory()) throw new Error('Đường dẫn đã chọn không phải thư mục');
    const previous = this.directory;
    this.directory = directory;
    try {
      fs.writeFileSync(this.file, JSON.stringify({ directory }), { mode: 0o600 });
    } catch (error) {
      this.directory = previous;
      throw error;
    }
  }

  reservePath(filename: string) {
    const directory = this.getDirectory();
    if (!directory) throw new Error('Chưa chọn thư mục tải xuống');
    const safeName = path.basename(filename).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'download';
    const extension = path.extname(safeName);
    const name = safeName.slice(0, safeName.length - extension.length);
    let candidate = path.join(directory, safeName);
    let number = 2;
    while (fs.existsSync(candidate) || this.reserved.has(candidate)) {
      candidate = path.join(directory, `${name} (${number++})${extension}`);
    }
    this.reserved.add(candidate);
    return candidate;
  }

  releasePath(filename: string) {
    this.reserved.delete(filename);
  }
}

export function registerDownloadHandler(downloadSession: Session, settings: DownloadSettings, chooseDirectory: () => Promise<string | null>) {
  downloadSession.on('will-download', (_event, item) => {
    item.pause();
    void (async () => {
      try {
        const directory = settings.getDirectory() || await chooseDirectory();
        if (!directory) { item.cancel(); return; }
        const savePath = settings.reservePath(item.getFilename());
        item.setSavePath(savePath);
        item.once('done', () => settings.releasePath(savePath));
        item.resume();
      } catch (error) {
        console.error('[Download] Could not select destination:', error);
        item.cancel();
      }
    })();
  });
}
