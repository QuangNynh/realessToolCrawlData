import { app, BrowserWindow, IpcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from './updater-types';

function safeMessage(error: unknown): string {
  const details = error instanceof Error ? error.message : String(error);
  if (/ENOSPC|no space left/i.test(details)) return 'Not enough disk space to download the update.';
  if (/EACCES|EPERM|permission denied/i.test(details)) return 'The update cannot be saved. Check file permissions and try again.';
  if (/ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|net::ERR|network/i.test(details)) return 'Cannot reach GitHub. Check your internet connection and try again.';
  if (/403|401|forbidden|unauthorized/i.test(details)) return 'GitHub denied access. Check that the release repository is public.';
  if (/404|latest.*yml|not found|no published versions/i.test(details)) return 'No compatible GitHub Release was found. Check the update manifest and release assets.';
  return 'Unable to update. Please try again later.';
}

export function registerUpdaterIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  const supported = app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
  let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion(), supported };
  let checkPromise: Promise<UpdateStatus> | null = null;
  let downloadPromise: Promise<UpdateStatus> | null = null;

  const send = (channel: string, value?: unknown) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  };
  const fail = (error: unknown) => {
    console.error('[Updater]', error);
    status = { ...status, state: 'error', message: safeMessage(error), progress: undefined };
    send('update:error', status);
  };

  if (supported) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => {
      status = { ...status, state: 'checking', message: undefined, progress: undefined };
      send('update:checking', status);
    });
    autoUpdater.on('update-available', (info) => {
      status = { ...status, state: 'available', newVersion: info.version, message: undefined };
      send('update:available', status);
    });
    autoUpdater.on('update-not-available', () => {
      status = { state: 'not-available', currentVersion: app.getVersion(), supported };
      send('update:not-available', status);
    });
    autoUpdater.on('download-progress', (progress) => {
      status = {
        ...status,
        state: 'downloading',
        progress: {
          percent: progress.percent,
          downloaded: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
      };
      send('update:progress', status);
    });
    autoUpdater.on('update-downloaded', (info) => {
      status = { ...status, state: 'downloaded', newVersion: info.version, progress: undefined };
      send('update:downloaded', status);
    });
    autoUpdater.on('error', fail);
  }

  const requireSupported = () => {
    if (!supported) throw new Error('Updates are available only in a packaged Windows or macOS app.');
  };
  const trusted = (sender: Electron.WebContents) => {
    const window = getWindow();
    if (!window || sender !== window.webContents) throw new Error('Unauthorized updater request.');
  };

  ipcMain.handle('update:get-version', (event) => {
    trusted(event.sender);
    return app.getVersion();
  });
  ipcMain.handle('update:get-status', (event) => {
    trusted(event.sender);
    return status;
  });
  ipcMain.handle('update:check', async (event) => {
    trusted(event.sender);
    requireSupported();
    if (status.state === 'downloading' || status.state === 'downloaded') return status;
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
      try {
        status = { currentVersion: app.getVersion(), state: 'checking', supported };
        send('update:checking', status);
        const result = await autoUpdater.checkForUpdates();
        if (!result && status.state === 'checking') {
          status = { ...status, state: 'not-available' };
          send('update:not-available', status);
        }
      } catch (error) {
        fail(error);
      }
      return status;
    })().finally(() => { checkPromise = null; });
    return checkPromise;
  });
  ipcMain.handle('update:download', async (event) => {
    trusted(event.sender);
    requireSupported();
    if (status.state === 'downloaded') return status;
    if (downloadPromise) return downloadPromise;
    if (status.state !== 'available') throw new Error('Check for an update before downloading.');
    downloadPromise = (async () => {
      try {
        status = { ...status, state: 'downloading', progress: { percent: 0, downloaded: 0, total: 0, bytesPerSecond: 0 } };
        send('update:progress', status);
        await autoUpdater.downloadUpdate();
        if (status.state === 'downloading') {
          status = { ...status, state: 'downloaded', progress: undefined };
          send('update:downloaded', status);
        }
      } catch (error) {
        fail(error);
      }
      return status;
    })().finally(() => { downloadPromise = null; });
    return downloadPromise;
  });
  ipcMain.handle('update:install', (event) => {
    trusted(event.sender);
    requireSupported();
    if (status.state !== 'downloaded') throw new Error('Download the update before installing.');
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      fail(error);
    }
  });
}
