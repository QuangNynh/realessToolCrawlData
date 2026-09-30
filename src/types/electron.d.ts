import type { DownloadProgress, UpdateInfo, UpdateState, UpdateStatus } from '../../electron/updater-types';

export type { DownloadProgress, UpdateInfo, UpdateState, UpdateStatus };

type UpdateListener = (status: UpdateStatus) => void;

declare global {
  interface Window {
    electron?: {
      updater: {
        check: () => Promise<UpdateStatus>;
        download: () => Promise<UpdateStatus>;
        install: () => Promise<void>;
        getVersion: () => Promise<string>;
        getStatus: () => Promise<UpdateStatus>;
        onChecking: (listener: UpdateListener) => () => void;
        onAvailable: (listener: UpdateListener) => () => void;
        onNotAvailable: (listener: UpdateListener) => () => void;
        onProgress: (listener: UpdateListener) => () => void;
        onDownloaded: (listener: UpdateListener) => () => void;
        onError: (listener: UpdateListener) => () => void;
      };
    };
  }
}
