import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { Server } from 'http';
import { DownloadSettings, registerDownloadHandler } from './download-settings';
import { registerUpdaterIpc } from './updater';

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
    minWidth: 1024,
    minHeight: 700,
    title: 'CrawlData',
    icon,
    webPreferences: {
      preload: finalPreload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    backgroundColor: '#0f172a',
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

    ipcMain.handle('downloads:get-directory', (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      return downloadSettings.getDirectory();
    });
    ipcMain.handle('downloads:choose-directory', async (event) => {
      if (!isTrustedAppSender(event.sender)) throw new Error('Unauthorized sender');
      return chooseDownloadDirectory();
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
      console.log('[Electron] Shutting down backend server...');
      backendServer.close();
    }
  });
}
