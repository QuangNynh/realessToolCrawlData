/// <reference types="vite/client" />

interface Window {
  desktopMedia?: {
    select: (tool: import('../backend/src/media-types').MediaTool) => Promise<import('../backend/src/media-types').SelectedMediaFile[]>
    files: (files: File[], tool: import('../backend/src/media-types').MediaTool) => Promise<import('../backend/src/media-types').SelectedMediaFile[]>
    request: (request: import('../backend/src/media-types').MediaRequest) => Promise<any>
  }
  desktopScripts?: {
    request: (request: import('../backend/src/script-converter-types').ScriptRequest) => Promise<any>
    copy: (text: string) => Promise<void>
  }
  desktopAi?: {
    request: (request: import('../backend/src/ai-types').AiRequest) => Promise<any>
  }
  desktopDownloads?: {
    getDirectory: () => Promise<string | null>
    chooseDirectory: () => Promise<string | null>
    youtube: (request: { action: 'list' | 'create' | 'pause' | 'resume' | 'retry' | 'clear-history'; id?: string; urls?: string[]; kind?: 'audio' | 'video'; quality?: string }) => Promise<any>
    onDirectoryChanged: (listener: (directory: string) => void) => () => void
  }
  instagramDesktop?: {
    status: () => Promise<{ connected: boolean }>
    connect: () => Promise<{ connected: boolean }>
    sync: () => Promise<{ connected: boolean }>
    disconnect: () => Promise<{ connected: boolean }>
  }
}
