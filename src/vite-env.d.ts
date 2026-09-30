/// <reference types="vite/client" />

interface Window {
  desktopDownloads?: {
    getDirectory: () => Promise<string | null>
    chooseDirectory: () => Promise<string | null>
    onDirectoryChanged: (listener: (directory: string) => void) => () => void
  }
  instagramDesktop?: {
    status: () => Promise<{ connected: boolean }>
    connect: () => Promise<{ connected: boolean }>
    sync: () => Promise<{ connected: boolean }>
    disconnect: () => Promise<{ connected: boolean }>
  }
}
