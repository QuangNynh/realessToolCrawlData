export type UpdateState = 'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'downloaded' | 'error';

export type DownloadProgress = {
  percent: number;
  downloaded: number;
  total: number;
  bytesPerSecond: number;
};

export type UpdateInfo = {
  currentVersion: string;
  newVersion?: string;
};

export type UpdateStatus = UpdateInfo & {
  state: UpdateState;
  progress?: DownloadProgress;
  message?: string;
  supported: boolean;
};
