import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('desktopMedia', {
  select: (tool: string) => ipcRenderer.invoke('media:select', tool),
  files: (files: File[], tool: string) => ipcRenderer.invoke('media:files', files.map(file => webUtils.getPathForFile(file)), tool),
  request: (request: unknown) => ipcRenderer.invoke('media:request', request),
});

contextBridge.exposeInMainWorld('desktopAi', {
  request: (request: unknown) => ipcRenderer.invoke('ai:request', request),
});

contextBridge.exposeInMainWorld('desktopScripts', {
  request: (request: unknown) => ipcRenderer.invoke('scripts:request', request),
  copy: (text: string) => ipcRenderer.invoke('scripts:copy', text),
});

contextBridge.exposeInMainWorld('instagramDesktop', {
  status: () => ipcRenderer.invoke('instagram:status') as Promise<{ connected: boolean }>,
  connect: () => ipcRenderer.invoke('instagram:connect') as Promise<{ connected: boolean }>,
  sync: () => ipcRenderer.invoke('instagram:sync') as Promise<{ connected: boolean }>,
  disconnect: () => ipcRenderer.invoke('instagram:disconnect') as Promise<{ connected: boolean }>,
});

contextBridge.exposeInMainWorld('desktopDownloads', {
  getDirectory: () => ipcRenderer.invoke('downloads:get-directory') as Promise<string | null>,
  chooseDirectory: () => ipcRenderer.invoke('downloads:choose-directory') as Promise<string | null>,
  youtube: (request: unknown) => ipcRenderer.invoke('downloads:youtube', request),
  onDirectoryChanged: (listener: (directory: string) => void) => {
    const callback = (_event: Electron.IpcRendererEvent, directory: string) => listener(directory);
    ipcRenderer.on('downloads:directory-changed', callback);
    return () => ipcRenderer.removeListener('downloads:directory-changed', callback);
  },
});

type UpdateStatus = import('./updater-types').UpdateStatus;
const onUpdate = (channel: string, listener: (status: UpdateStatus) => void) => {
  const callback = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status);
  ipcRenderer.on(channel, callback);
  return () => ipcRenderer.removeListener(channel, callback);
};

contextBridge.exposeInMainWorld('electron', {
  updater: {
    check: () => ipcRenderer.invoke('update:check') as Promise<UpdateStatus>,
    download: () => ipcRenderer.invoke('update:download') as Promise<UpdateStatus>,
    install: () => ipcRenderer.invoke('update:install') as Promise<void>,
    getVersion: () => ipcRenderer.invoke('update:get-version') as Promise<string>,
    getStatus: () => ipcRenderer.invoke('update:get-status') as Promise<UpdateStatus>,
    onChecking: (listener: (status: UpdateStatus) => void) => onUpdate('update:checking', listener),
    onAvailable: (listener: (status: UpdateStatus) => void) => onUpdate('update:available', listener),
    onNotAvailable: (listener: (status: UpdateStatus) => void) => onUpdate('update:not-available', listener),
    onProgress: (listener: (status: UpdateStatus) => void) => onUpdate('update:progress', listener),
    onDownloaded: (listener: (status: UpdateStatus) => void) => onUpdate('update:downloaded', listener),
    onError: (listener: (status: UpdateStatus) => void) => onUpdate('update:error', listener),
  },
});
