import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { Server } from 'http';
import { DownloadSettings, registerDownloadHandler } from './download-settings';
import { registerUpdaterIpc } from './updater';

if (process.platform === 'darwin' && process.arch !== 'arm64') {
  dialog.showErrorBox('Cần bản Apple Silicon', 'CrawlData trên Mac cần Electron arm64 chạy native. Hãy dùng bản arm64 và tắt Open using Rosetta.');
  app.exit(1);
}

// Tắt các cảnh báo không ảnh hưởng từ Chrome DevTools Autofill protocol
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,AutofillAddress');

// Giữ phiên đăng nhập và cấu hình tải xuống của các bản Lenyt Desktop trước đây.
if (app.isPackaged) {
  const previousUserData = path.join(app.getPath('appData'), 'Lenyt Desktop');
  fs.mkdirSync(previousUserData, { recursive: true });
  app.setPath('userData', previousUserData);
}

// Thiết lập đường dẫn lưu trữ vào UserData của Electron
process.env.USER_DATA_PATH = app.getPath('userData');
if (app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')) {
  process.env.YOUTUBE_DL_DIR = path.join(process.resourcesPath, 'bin');
  process.env.YOUTUBE_DL_FILENAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
} else if (app.isPackaged) {
  process.env.YOUTUBE_DL_DIR = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin');
}

// Đảm bảo chỉ có một instance duy nhất chạy (Single Instance Lock)
const gotSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let backendServer: Server | null = null;
let instagramLoginWindow: BrowserWindow | null = null;
let instagramLoginPromise: Promise<boolean> | null = null;
let instagramSessionSyncTimer: ReturnType<typeof setInterval> | null = null;
const instagramPartition = 'persist:instagram';
const downloadSettings = new DownloadSettings(app.getPath('userData'));
let choosingDownloadDirectory: Promise<string | null> | null = null;

function chooseDownloadDirectory() {
  if (!choosingDownloadDirectory) {
    choosingDownloadDirectory = (async () => {
      const current = downloadSettings.getDirectory();
      const options: Electron.OpenDialogOptions = {
        title: 'Chọn thư mục tải xuống',
        defaultPath: current || app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      downloadSettings.setDirectory(result.filePaths[0]);
      mainWindow?.webContents.send('downloads:directory-changed', result.filePaths[0]);
      return result.filePaths[0];
    })().finally(() => { choosingDownloadDirectory = null; });
  }
  return choosingDownloadDirectory;
}

async function getInstagramCookies() {
  const cookies = await session.fromPartition(instagramPartition).cookies.get({ url: 'https://www.instagram.com/' });
  const needed = new Set(['sessionid', 'csrftoken', 'ds_user_id', 'mid', 'rur', 'ig_did']);
  return cookies.filter((cookie) =>
    needed.has(cookie.name) && (cookie.domain === 'instagram.com' || cookie.domain?.endsWith('.instagram.com'))
  );
}

async function hasInstagramSession() {
  return (await getInstagramCookies()).some((cookie) => cookie.name === 'sessionid' && Boolean(cookie.value));
}

async function syncInstagramSession() {
  const loginSession = session.fromPartition(instagramPartition);
  const cookies = await getInstagramCookies();
  const connected = cookies.some((cookie) => cookie.name === 'sessionid' && Boolean(cookie.value));
  const cookie = connected ? cookies.map((item) => `${item.name}=${item.value}`).join('; ') : null;
  const userAgent = connected ? loginSession.getUserAgent() : null;
  if (isDev) {
    const response = await fetch('http://127.0.0.1:8695/api/v1/internal/instagram-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie, userAgent }),
    });
    if (!response.ok) throw new Error('Không thể đồng bộ phiên Instagram với backend');
  } else {
    const { instagramService } = require('../dist-backend/instagram.service');
    instagramService.setSessionCookie(cookie, userAgent);
  }
  return { connected };
}

function isTrustedAppSender(sender: Electron.WebContents) {
  if (sender !== mainWindow?.webContents) return false;
  const url = sender.getURL();
  return isDev
    ? url.startsWith('http://localhost:8696/') || url === 'http://localhost:8696'
    : url.startsWith('file://');
}

function openInstagramLogin(): Promise<boolean> {
  if (instagramLoginPromise) {
    instagramLoginWindow?.focus();
    return instagramLoginPromise;
  }

  instagramLoginPromise = new Promise<boolean>((resolve) => {
    const loginSession = session.fromPartition(instagramPartition);
    const window = new BrowserWindow({
      width: 560,
      height: 760,
      minWidth: 460,
      minHeight: 600,
      parent: mainWindow || undefined,
      modal: false,
      title: 'Kết nối Instagram',
      webPreferences: {
        partition: instagramPartition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    instagramLoginWindow = window;
    let finished = false;
    const finish = (connected: boolean) => {
      if (finished) return;
      finished = true;
      loginSession.cookies.removeListener('changed', onCookieChanged);
      instagramLoginPromise = null;
      instagramLoginWindow = null;
      if (!window.isDestroyed()) window.close();
      resolve(connected);
    };
    const checkSession = async () => {
      if (await hasInstagramSession()) finish(true);
    };
    const onCookieChanged = (_event: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (cookie.name === 'sessionid' && !removed) void checkSession();
    };
    loginSession.cookies.on('changed', onCookieChanged);
    window.on('closed', () => finish(false));
    window.webContents.on('did-finish-load', () => void checkSession());
    window.webContents.on('will-navigate', (event, url) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' && (parsed.hostname.endsWith('.instagram.com') || parsed.hostname === 'instagram.com' || parsed.hostname.endsWith('.facebook.com') || parsed.hostname === 'facebook.com')) return;
      } catch { /* block invalid navigation */ }
      event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' && (parsed.hostname.endsWith('.instagram.com') || parsed.hostname === 'instagram.com' || parsed.hostname.endsWith('.facebook.com') || parsed.hostname === 'facebook.com')) {
          void window.loadURL(url);
        }
      } catch { /* block invalid popup */ }
      return { action: 'deny' };
    });
    void window.loadURL('https://www.instagram.com/accounts/login/').catch((error) => {
      console.error('[Instagram] Login window could not load:', error);
    });
  });
  return instagramLoginPromise;
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

async function startBackend() {
  // Ở dev mode, npm run dev:backend đã chạy backend riêng bằng tsx
  if (isDev) {
    console.log('[Electron] Dev mode: Using standalone dev backend on port 8695.');
    return;
  }

  const backendModule = require('../dist-backend/server');
  backendServer = await backendModule.startServer(8696);
  console.log('[Electron] Production backend server started successfully on 127.0.0.1:8696.');
}

function createWindow() {
  // Preload file: hỗ trợ cả chạy ts trực tiếp (dev) lẫn js biên dịch (build)
  const preloadPath = path.join(__dirname, 'preload.js');
  const fallbackPreload = path.join(__dirname, '../dist-electron/preload.js');
  const finalPreload = require('fs').existsSync(preloadPath) ? preloadPath : fallbackPreload;
  const appIconPath = path.join(__dirname, '../build/icon.png');
  const icon = require('fs').existsSync(appIconPath) ? appIconPath : undefined;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 480,
    minHeight: 480,
    title: 'CrawlData',
    icon,
    webPreferences: {
      preload: finalPreload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    backgroundColor: '#ffffff',
    titleBarStyle: 'default',
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (url !== current) event.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const isMacShortcut = process.platform === 'darwin' && input.meta && input.alt && input.key.toLowerCase() === 'i';
    const isOtherShortcut = process.platform !== 'darwin' && input.control && input.shift && input.key.toLowerCase() === 'i';
    if (input.key === 'F12' || isMacShortcut || isOtherShortcut) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:8696');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!gotSingleInstanceLock) {
  // Có một instance khác đang chạy. Thoát ngay lập tức để không khởi động lại backend server
  console.log('[Electron] Another instance is already running. Quitting duplicate instance immediately.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await Promise.all([
      session.defaultSession.setProxy({ mode: 'direct' }),
      session.fromPartition(instagramPartition).setProxy({ mode: 'direct' }),
    ]);
    await startBackend();
    createWindow();
    registerUpdaterIpc(ipcMain, () => mainWindow);

    registerDownloadHandler(session.defaultSession, downloadSettings, chooseDownloadDirectory);

    const selectedMedia = new Map<string, { path: string; name: string; bytes: number }>();
    const mediaCall = async (request: unknown) => {
      if (!isDev) return require('../dist-backend/media-instance').getMediaJobs().dispatch(request);
      const response = await fetch('http://127.0.0.1:8695/api/v1/internal/media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(120_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể truy cập công cụ audio');
      return result;
    };
    const registerMediaFiles = (paths: unknown, tool: unknown) => {
      if (!['srt', 'script', 'extract'].includes(tool as string) || !Array.isArray(paths) || paths.length > 1000) throw new Error('Mỗi đợt tối đa 1.000 file');
      return paths.map(file => {
        if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Chỉ chấp nhận file trên máy');
        const ext = path.extname(file).toLowerCase();
        const allowed = tool === 'extract' ? ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg', '.ts'] : ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.wma', '.flac', '.opus', '.webm', '.aiff', '.aif'];
        if (!allowed.includes(ext)) throw new Error(`Định dạng không được hỗ trợ: ${path.basename(file)}`);
        const info = fs.statSync(file);
        if (!info.isFile() || !info.size) throw new Error(`File rỗng hoặc không tồn tại: ${path.basename(file)}`);
        const id = randomUUID(), item = { path: file, name: path.basename(file), bytes: info.size };
        if (selectedMedia.size >= 5000) selectedMedia.delete(selectedMedia.keys().next().value!);
        selectedMedia.set(id, item);
        return { id, name: item.name, bytes: item.bytes };
      });
    };
    ipcMain.handle('media:select', async (event, tool) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (!['srt', 'script', 'extract'].includes(tool)) throw new Error('Chức năng không hợp lệ');
      const options: Electron.OpenDialogOptions = { title: tool === 'extract' ? 'Chọn video để tách audio' : 'Chọn audio để nhận dạng giọng nói', properties: ['openFile', 'multiSelections'], filters: [{ name: tool === 'extract' ? 'Video' : 'Audio', extensions: tool === 'extract' ? ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg', 'ts'] : ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'flac', 'opus', 'webm', 'aiff', 'aif'] }] };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : registerMediaFiles(result.filePaths, tool);
    });
    ipcMain.handle('media:files', (event, paths, tool) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      return registerMediaFiles(paths, tool);
    });
    ipcMain.handle('media:request', async (event, request) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (!request || typeof request !== 'object' || !['list', 'runtime', 'install-whisper', 'install-moonshine', 'create', 'pause', 'resume', 'retry', 'cancel', 'clear', 'reset', 'preview', 'reveal', 'export'].includes(request.action)) throw new Error('Thao tác media không hợp lệ');
      if (request.action === 'create') {
        if (!Array.isArray(request.fileIds) || !request.fileIds.length || request.fileIds.length > 1000) throw new Error('Mỗi đợt từ 1 đến 1.000 file');
        const paths = request.fileIds.map((id: string) => { const item = selectedMedia.get(id); if (!item) throw new Error('Hãy chọn lại file đầu vào'); return item.path; });
        const directory = downloadSettings.getDirectory() || await chooseDownloadDirectory();
        if (!directory) throw new Error('Hãy chọn thư mục tải xuống');
        const result = await mediaCall({ action: 'create', tool: request.tool, paths, directory, options: request.options });
        request.fileIds.forEach((id: string) => selectedMedia.delete(id));
        return result;
      }
      if (request.action === 'reveal') {
        const result = await mediaCall({ action: 'output', id: request.id, itemId: request.itemId });
        shell.showItemInFolder(result.output); return { success: true };
      }
      return mediaCall(request);
    });

    const ocrFolders = new Map<string, string>();
    const ocrCall = async (input: unknown) => {
      if (!isDev) return require('../dist-backend/image-ocr-instance').dispatchImageOcr(input);
      const response = await fetch('http://127.0.0.1:8695/api/v1/internal/image-ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(35_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể đọc ảnh');
      return data;
    };
    const registerOcrFolder = (folder: string) => {
      if (typeof folder !== 'string' || !path.isAbsolute(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Hãy kéo một folder ảnh vào đây');
      const files = fs.readdirSync(folder, { withFileTypes: true }).filter(item => item.isFile() && /\.(png|jpe?g|webp|tiff?|gif|avif)$/i.test(item.name)).map(item => item.name);
      if (!files.length || files.length > 5000) throw new Error('Chọn folder có từ 1 đến 5.000 ảnh');
      const imageOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
      files.sort((a, b) => imageOrder.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
      const id = randomUUID(); if (ocrFolders.size >= 5) ocrFolders.delete(ocrFolders.keys().next().value!);
      ocrFolders.set(id, folder); return { id, name: path.basename(folder), files };
    };
    ipcMain.handle('ocr:select-folder', async event => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      const options: Electron.OpenDialogOptions = { title: 'Chọn folder ảnh để lấy text', properties: ['openDirectory'] };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      return registerOcrFolder(result.filePaths[0]);
    });
    ipcMain.handle('ocr:drop-folder', (event, paths) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (!Array.isArray(paths) || paths.length !== 1) throw new Error('Hãy kéo một folder ảnh vào đây');
      return registerOcrFolder(paths[0]);
    });
    ipcMain.handle('ocr:request', async (event, input) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (!input || !['get', 'create', 'pause', 'resume', 'retry', 'reveal', 'text', 'reset', 'download'].includes(input.action)) throw new Error('Thao tác đọc ảnh không hợp lệ');
      if (input.action === 'create') {
        const folder = ocrFolders.get(input.folderId);
        if (!folder) throw new Error('Hãy chọn lại folder ảnh');
        const directory = downloadSettings.getDirectory() || await chooseDownloadDirectory();
        if (!directory) throw new Error('Hãy chọn thư mục kết quả');
        return ocrCall({ action: 'create', folder, directory, model: input.model, keyId: input.keyId });
      }
      if (input.action === 'download') {
        const state = await ocrCall({ action: 'get' });
        if (!state.job || state.working || state.job.status === 'running' || !state.job.items.some((item: { status: string }) => item.status === 'completed')) throw new Error('Hãy dừng đọc ảnh và chờ có kết quả trước khi tải TXT');
        const options: Electron.SaveDialogOptions = {
          title: 'Tải file TXT kết quả',
          defaultPath: path.join(downloadSettings.getDirectory() || app.getPath('downloads'), `image-text-${state.job.id.slice(0, 8)}${state.job.status === 'completed' ? '' : '-partial'}.txt`),
          filters: [{ name: 'Văn bản TXT', extensions: ['txt'] }],
        };
        const selected = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
        if (selected.canceled || !selected.filePath) return { cancelled: true };
        return ocrCall({ action: 'export', filename: selected.filePath, id: state.job.id });
      }
      if (input.action === 'reveal') {
        const result = await ocrCall({ action: 'output' }); shell.showItemInFolder(result.output); return { success: true };
      }
      const result = await ocrCall({ action: input.action, model: input.model, keyId: input.keyId });
      if (input.action === 'reset') ocrFolders.clear();
      return result;
    });

    ipcMain.handle('scripts:copy', (event, text) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 48 * 1024 * 1024) throw new Error('Nội dung sao chép vượt quá giới hạn');
      clipboard.writeText(text);
    });

    ipcMain.handle('scripts:request', async (event, request) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (!request || typeof request !== 'object' || !['list', 'parse', 'create', 'get', 'pause', 'resume', 'delete', 'export'].includes(request.action)) throw new Error('Thao tác Script Converter không hợp lệ');
      if (!isDev) return require('../dist-backend/script-converter-instance').getScriptConverter().dispatch(request);
      const response = await fetch('http://127.0.0.1:8695/api/v1/internal/script-converter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(35_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể truy cập Script Converter');
      return result;
    });

    ipcMain.handle('ai:request', async (event, request) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (!request || typeof request !== 'object' || !['status', 'connect', 'cancel-connect', 'disconnect', 'refresh-models', 'create-key', 'copy-key', 'revoke-key', 'chat', 'quota'].includes(request.action)) throw new Error('Thao tác AI không hợp lệ');
      const invoke = async (input: unknown) => {
        if (!isDev) return require('../dist-backend/ai-instance').getAiGateway().dispatch(input);
        const response = await fetch('http://127.0.0.1:8695/api/v1/internal/ai', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
          signal: AbortSignal.timeout(request.action === 'chat' ? 190_000 : request.action === 'quota' ? 60_000 : 35_000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Không thể truy cập API AI');
        return result;
      };
      const result = await invoke(request);
      if (request.action === 'connect') {
        const authUrl = new URL(result.authUrl);
        if (authUrl.origin !== 'https://accounts.google.com') { await invoke({ action: 'cancel-connect' }); throw new Error('Địa chỉ đăng nhập Google không hợp lệ'); }
        try { await shell.openExternal(authUrl.toString()); }
        catch { await invoke({ action: 'cancel-connect' }); throw new Error('Không thể mở trình duyệt để đăng nhập Google'); }
      }
      const { authUrl: _authUrl, ...safeResult } = result;
      return { ...safeResult, baseUrl: `http://127.0.0.1:${isDev ? 8695 : 8696}/v1` };
    });

    ipcMain.handle('downloads:get-directory', (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      return downloadSettings.getDirectory();
    });
    ipcMain.handle('downloads:choose-directory', async (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      return chooseDownloadDirectory();
    });
    ipcMain.handle('downloads:youtube', async (event, request) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      const action = request?.action;
      if (!['list', 'create', 'pause', 'resume', 'retry', 'clear-history'].includes(action)) throw new Error('Thao tác tải không hợp lệ');
      let input = { ...request };
      if (action === 'create') {
        const directory = downloadSettings.getDirectory() || await chooseDownloadDirectory();
        if (!directory) throw new Error('Hãy chọn thư mục tải xuống trước khi bắt đầu');
        input = { action, urls: request.urls, kind: request.kind, quality: request.quality, directory };
      }
      if (isDev) {
        const response = await fetch('http://127.0.0.1:8695/api/v1/internal/youtube-downloads', {
          method: action === 'list' ? 'GET' : 'POST',
          ...(action === 'list' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Không thể truy cập hàng đợi YouTube');
        return data;
      }
      const { youtubeDownloads } = require('../dist-backend/youtube-downloads');
      if (action === 'list') return youtubeDownloads.snapshot();
      if (action === 'create') return youtubeDownloads.add(input);
      if (action === 'clear-history') return youtubeDownloads.clearHistory(request.kind);
      return youtubeDownloads.control(request.id, action);
    });

    // The dev backend restarts on file changes and loses its in-memory session.
    // Refresh it from Electron's persistent cookie store even when the user calls the API directly.
    const refreshInstagramSession = () => {
      void syncInstagramSession().catch((error) => {
        console.warn('[Instagram] Session sync will retry:', error instanceof Error ? error.message : 'unknown error');
      });
    };
    refreshInstagramSession();
    instagramSessionSyncTimer = setInterval(refreshInstagramSession, 15_000);

    ipcMain.handle('instagram:status', async (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      return syncInstagramSession();
    });
    ipcMain.handle('instagram:connect', async (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      if (await hasInstagramSession()) {
        await session.fromPartition(instagramPartition).clearStorageData();
      }
      await openInstagramLogin();
      return syncInstagramSession();
    });
    ipcMain.handle('instagram:sync', async (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      return syncInstagramSession();
    });
    ipcMain.handle('instagram:disconnect', async (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      const loginSession = session.fromPartition(instagramPartition);
      await loginSession.clearStorageData();
      return syncInstagramSession();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Electron] Could not start desktop app:', error);
    dialog.showErrorBox('Không thể khởi động CrawlData', `API nội bộ không khởi động được: ${message}`);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (instagramSessionSyncTimer) clearInterval(instagramSessionSyncTimer);
    if (backendServer) {
      require('../dist-backend/youtube-downloads').youtubeDownloads.shutdown();
      require('../dist-backend/script-converter-instance').shutdownScriptConverter();
      require('../dist-backend/ai-instance').shutdownAiGateway();
      require('../dist-backend/media-instance').shutdownMediaJobs();
      require('../dist-backend/image-ocr-instance').shutdownImageOcr();
      console.log('[Electron] Shutting down backend server...');
      backendServer.close();
    }
  });
}
