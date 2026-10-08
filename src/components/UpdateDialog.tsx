import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import type { UpdateStatus } from '@/types/electron';

const initialStatus: UpdateStatus = { state: 'idle', currentVersion: '…', supported: false };
const formatBytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;

export function UpdateDialog() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>(initialStatus);

  useEffect(() => {
    const updater = window.electron?.updater;
    if (!updater) return;
    let active = true;
    const update = (next: UpdateStatus) => { if (active) setStatus(next); };
    const unsubscribe = [
      updater.onChecking(update),
      updater.onAvailable(update),
      updater.onNotAvailable(update),
      updater.onProgress(update),
      updater.onDownloaded(update),
      updater.onError(update),
    ];
    void updater.getStatus().then(update).catch(() => {
      if (active) setStatus({ ...initialStatus, state: 'error', message: 'Unable to read update status.' });
    });
    return () => {
      active = false;
      unsubscribe.forEach((remove) => remove());
    };
  }, []);

  const run = async (action: 'check' | 'download' | 'install') => {
    const updater = window.electron?.updater;
    if (!updater) return;
    try {
      if (action === 'check') setStatus((current) => ({ ...current, state: 'checking', message: undefined }));
      if (action === 'download') setStatus((current) => ({ ...current, state: 'downloading', progress: undefined }));
      const next = await updater[action]();
      if (next) setStatus(next);
    } catch {
      setStatus((current) => ({ ...current, state: 'error', message: 'Unable to update. Please try again.' }));
    }
  };

  const progress = status.progress;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Check for Updates</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>CrawlData Updates</DialogTitle>
          <DialogDescription>Current version: {status.currentVersion}</DialogDescription>
        </DialogHeader>

        {!status.supported ? (
          <p className="text-sm text-muted-foreground">Updates are available in the installed Windows or macOS app.</p>
        ) : status.state === 'checking' ? (
          <p className="text-sm">Checking for updates…</p>
        ) : status.state === 'not-available' ? (
          <div className="space-y-4"><p>You are using the latest version.</p><Button onClick={() => void run('check')}>Check Again</Button></div>
        ) : status.state === 'available' ? (
          <div className="space-y-4"><p>New version available: <strong>{status.newVersion}</strong></p><Button onClick={() => void run('download')}>Download Update</Button></div>
        ) : status.state === 'downloading' ? (
          <div className="space-y-3">
            <p>Downloading update… {Math.round(progress?.percent || 0)}%</p>
            <Progress value={progress?.percent || 0} />
            {progress && <p className="text-xs text-muted-foreground">{formatBytes(progress.downloaded)} / {formatBytes(progress.total)} · {formatBytes(progress.bytesPerSecond)}/s</p>}
          </div>
        ) : status.state === 'downloaded' ? (
          <div className="space-y-4"><p>Version {status.newVersion} is ready to install.</p><Button onClick={() => void run('install')}>Restart and Install</Button></div>
        ) : status.state === 'error' ? (
          <div className="space-y-4"><p className="text-sm text-destructive">{status.message || 'Unable to update.'}</p><Button onClick={() => void run('check')}>Try Again</Button></div>
        ) : (
          <Button onClick={() => void run('check')}>Check for Updates</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
