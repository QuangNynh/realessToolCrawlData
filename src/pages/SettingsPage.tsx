import { UpdateDialog } from '@/components/UpdateDialog';

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings / About</h1>
        <p className="mt-1 text-sm text-muted-foreground">CrawlData for Windows and macOS</p>
      </div>
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
