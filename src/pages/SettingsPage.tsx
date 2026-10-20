import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { loadConnection, saveConnection, connectionUrl, type ApiConnection } from '@/config/api-connection';
import { UpdateDialog } from '@/components/UpdateDialog';

export function SettingsPage() {
  const [connection, setConnection] = useState(loadConnection);
  const [active, setActive] = useState(loadConnection);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const update = (patch: Partial<ApiConnection>) => { setConnection(previous => ({ ...previous, ...patch })); setError(''); setSaved(false); };
  const save = (config = connection) => {
    try { saveConnection(config); setConnection(config); setActive(config); setError(''); setSaved(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setSaved(false); }
  };
  const inputClass = 'w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm';
  return (
    <div className="mx-auto w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings / About</h1>
        <p className="mt-1 text-sm text-muted-foreground">CrawlData for Windows and macOS</p>
      </div>
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="font-medium">Kết nối API</h2>
        <label className="block min-w-0 space-y-2 text-sm font-medium">Domain public
          <input className={inputClass} placeholder="https://api.example.com" value={connection.domain} onChange={event => update({ domain: event.target.value })} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" role="switch" aria-checked={connection.usePublic} aria-label="Dùng domain public" onClick={() => save({ ...connection, usePublic: !connection.usePublic })} className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${connection.usePublic ? 'bg-primary' : 'bg-muted-foreground/40'}`}>
            <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${connection.usePublic ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-sm">Dùng domain public</span>
          <Button onClick={() => save()}>Lưu kết nối</Button>
          {saved && <span role="status" className="text-sm text-muted-foreground">Đã lưu</span>}
        </div>
        <p className="break-all text-sm text-muted-foreground">API đang dùng: {connectionUrl(active)}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-medium">Updates</h2>
          <p className="text-sm text-muted-foreground">Check and install a new release when you are ready.</p>
        </div>
        <UpdateDialog />
      </section>
    </div>
  );
}
