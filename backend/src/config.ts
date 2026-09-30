import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();
const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '../../.env'),
  path.join(__dirname, '../.env'),
  (process as any).resourcesPath ? path.join((process as any).resourcesPath, '.env') : '',
  process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, '.env') : '',
].filter(Boolean);

// Lưu lại PORT truyền từ CLI (ví dụ cross-env PORT=8695 trong npm run dev:backend)
const cliPort = process.env.PORT;

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

// Khôi phục PORT từ CLI nếu có, để dev mode chạy đúng cổng backend nội bộ 8695
if (cliPort) {
  process.env.PORT = cliPort;
}

// Hỗ trợ thư mục userData từ Electron khi chạy đóng gói hoặc dev
export const DATA_DIR = process.env.USER_DATA_PATH
  ? path.join(process.env.USER_DATA_PATH, 'data')
  : path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const SETTINGS_FILE_PATH = path.join(DATA_DIR, 'settings.json');

// Tự động sao chép file cấu hình ban đầu nếu trong userData chưa có
if (!fs.existsSync(SETTINGS_FILE_PATH)) {
  const fallbackSettings = path.join(process.cwd(), 'data', 'settings.json');
  if (fs.existsSync(fallbackSettings)) {
    try {
      fs.copyFileSync(fallbackSettings, SETTINGS_FILE_PATH);
    } catch {}
  }
}
export interface AppSettings {
  port: number;
}

export function loadSettings(): AppSettings {
  let settings: Partial<AppSettings> = {};
  if (fs.existsSync(SETTINGS_FILE_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8'));
    } catch {
      // ignore
    }
  }

  return {
    port: Number(process.env.PORT || settings.port || 8696),
  };
}
