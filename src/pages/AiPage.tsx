import { useEffect, useRef, useState } from 'react';
import { Copy, KeyRound, Loader2, RefreshCw, Rocket, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AiSnapshot, AiRequest } from '../../backend/src/ai-types';

const initial: AiSnapshot = { connected: false, connecting: false, models: [], keys: [] };
const messageOf = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Không thể truy cập AI';

export function AiPage() {
  const [snapshot, setSnapshot] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [keyName, setKeyName] = useState('Key cá nhân');
  const [newKey, setNewKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [chatError, setChatError] = useState('');
  const mounted = useRef(true);
  const bridge = window.desktopAi;
  const request = async (input: AiRequest) => {
    if (!bridge) throw new Error('Mở ứng dụng Desktop để kết nối Antigravity');
    return bridge.request(input);
  };

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data: AiSnapshot = await request({ action: 'status' });
        if (mounted.current) {
          setSnapshot(data); setConnectionError('');
          setModel(previous => data.models.some(item => item.id === previous) ? previous : data.modelAliases?.[previous] || data.defaultModelId || data.models[0]?.id || '');
        }
      } catch (error) { if (mounted.current) setConnectionError(messageOf(error)); }
      if (mounted.current) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); };
  }, []);

  const act = async (input: AiRequest) => {
    setBusy(true);
    try {
      const data = await request(input);
      if (!mounted.current) return;
      setSnapshot(data); setConnectionError('');
      setModel(previous => data.models.some((item: { id: string }) => item.id === previous) ? previous : data.modelAliases?.[previous] || data.defaultModelId || data.models[0]?.id || '');
      if (input.action === 'create-key') {
        setNewKey(data.createdKey.key); setApiKey(data.createdKey.key);
        toast.success('Đã tạo API key cá nhân');
      }
      if (input.action === 'revoke-key') {
        if (data.keys.every((key: { preview: string }) => key.preview !== `${newKey.slice(0, 16)}…${newKey.slice(-4)}`)) { if (apiKey === newKey) setApiKey(''); setNewKey(''); }
        toast.success('Đã thu hồi key');
      }
      if (input.action === 'disconnect') { setAnswer(''); setImages([]); setChatError(''); }
    } catch (error) { toast.error(messageOf(error)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Đã sao chép'); }
    catch { toast.error('Không thể sao chép. Hãy chọn nội dung và sao chép thủ công'); }
  };
  const chat = async () => {
    setChatting(true); setChatError(''); setAnswer(''); setImages([]);
    try {
      const result = await request({ action: 'chat', apiKey, model, prompt });
      if (!mounted.current) return;
      const reply = result.choices?.[0]?.message?.content;
      if (typeof reply === 'string') setAnswer(reply);
      else if (Array.isArray(reply)) {
        setAnswer(reply.filter(item => item.type === 'text').map(item => item.text).join('\n'));
        setImages(reply.filter(item => item.type === 'image_url').map(item => item.image_url.url));
      } else setAnswer('Model đã hoàn tất và không trả về văn bản.');
    } catch (error) { if (mounted.current) setChatError(messageOf(error)); }
    finally { if (mounted.current) setChatting(false); }
  };
  const baseUrl = snapshot.baseUrl || (import.meta.env.DEV ? 'http://127.0.0.1:8695/v1' : 'http://127.0.0.1:8696/v1');
  const models = snapshot.models.filter(item => `${item.id} ${item.name}`.toLowerCase().includes(search.toLowerCase()));
  const example = `curl '${baseUrl}/chat/completions' -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' -d '${JSON.stringify({ model: model || 'ag/TEN_MODEL', messages: [{ role: 'user', content: 'Xin chào' }] })}'`;

  return <div className='mx-auto max-w-5xl space-y-5'>
    <header><h1 className='flex items-center gap-2 text-2xl font-semibold'><Rocket className='h-6 w-6 text-primary' />AI / Antigravity</h1>
      <p className='mt-2 text-sm text-muted-foreground'>Kết nối tài khoản Google, tạo API key cá nhân và sử dụng các model Antigravity bằng cùng một key.</p></header>
    <section className='rounded-lg border bg-card p-4 sm:p-6 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div><h2 className='font-semibold'>Tài khoản Antigravity</h2>
          <p role='status' className='mt-1 text-sm text-muted-foreground'>{snapshot.connecting ? 'Đang chờ đăng nhập Google trong trình duyệt…' : snapshot.connected ? `Đã kết nối: ${snapshot.email || 'Tài khoản Google'}` : 'Chưa kết nối'}</p></div>
        <div className='flex flex-wrap gap-2'>
          {snapshot.connecting ? <Button variant='outline' disabled={busy} onClick={() => void act({ action: 'cancel-connect' })}>Hủy đăng nhập</Button>
            : <Button disabled={busy || chatting || !bridge} onClick={() => void act({ action: 'connect' })}>{busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{snapshot.connected ? 'Kết nối lại Google' : 'Kết nối Antigravity'}</Button>}
          {snapshot.connected && <Button variant='outline' disabled={busy || chatting || snapshot.connecting} onClick={() => void act({ action: 'disconnect' })}>Ngắt kết nối</Button>}
        </div>
      </div>
      {snapshot.connecting && <p className='text-sm'>Hoàn tất đăng nhập và cấp quyền trong trình duyệt, sau đó quay lại ứng dụng. Phiên đăng nhập chờ tối đa 5 phút.</p>}
      {(connectionError || snapshot.error) && <p role='alert' className='break-words text-sm text-destructive'>{connectionError || snapshot.error}</p>}
      <div className='space-y-1'><p className='text-sm font-medium'>Base URL cho ứng dụng của bạn</p>
        <div className='flex min-w-0 items-center gap-2'><code className='min-w-0 flex-1 break-all rounded bg-muted p-2 text-sm'>{baseUrl}</code><Button variant='outline' size='icon' aria-label='Sao chép Base URL' onClick={() => void copy(baseUrl)}><Copy className='h-4 w-4' /></Button></div>
      <p className='text-xs text-muted-foreground'>API hoạt động khi CrawlData đang chạy trên máy này. Key sử dụng quyền truy cập và quota của tài khoản đã kết nối.</p></div>
      <p className='text-xs text-muted-foreground'>Gọi model được xử lý ở backend của Desktop. Terminal backend hiển thị model, mã HTTP và thời gian gọi.</p>
    </section>

    <section className='rounded-lg border bg-card p-4 sm:p-6 space-y-4'>
      <h2 className='flex items-center gap-2 font-semibold'><KeyRound className='h-4 w-4' />API key cá nhân</h2>
      <form className='flex flex-wrap gap-2' onSubmit={event => { event.preventDefault(); void act({ action: 'create-key', name: keyName }); }}>
        <Input aria-label='Tên API key' value={keyName} maxLength={80} onChange={event => setKeyName(event.target.value)} placeholder='Tên key' className='min-w-0 flex-1 basis-48' disabled={busy} />
        <Button type='submit' disabled={busy || !keyName.trim() || !bridge}>Tạo API key</Button>
      </form>
      {newKey && <div className='rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2'>
        <p className='text-sm font-medium'>Key mới — sao chép và lưu lại, ứng dụng chỉ hiển thị đầy đủ lần này.</p>
        <div className='flex min-w-0 items-center gap-2'><code className='min-w-0 flex-1 select-all break-all text-sm'>{newKey}</code><Button variant='outline' size='icon' aria-label='Sao chép API key mới' onClick={() => void copy(newKey)}><Copy className='h-4 w-4' /></Button></div>
        <Button variant='ghost' size='sm' onClick={() => setNewKey('')}>Ẩn key</Button>
      </div>}
      <div className='space-y-2'>{snapshot.keys.map(key => <div key={key.id} className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-3'>
        <div className='min-w-0'><p className='break-words text-sm font-medium'>{key.name}</p><code className='break-all text-xs text-muted-foreground'>{key.preview}</code>
          <p className='text-xs text-muted-foreground'>{key.lastUsedAt ? `Dùng lần cuối: ${new Date(key.lastUsedAt).toLocaleString('vi-VN')}` : 'Chưa sử dụng'}</p></div>
        <Button variant='outline' size='sm' className='text-destructive' disabled={busy || chatting} onClick={() => void act({ action: 'revoke-key', id: key.id })}><Trash2 className='mr-2 h-4 w-4' />Thu hồi</Button>
      </div>)}</div>
      {!snapshot.keys.length && <p className='text-sm text-muted-foreground'>Chưa có key. Mỗi key được tạo sẽ dùng được cho toàn bộ model khả dụng của tài khoản.</p>}
    </section>

    <section className='rounded-lg border bg-card p-4 sm:p-6 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'><h2 className='font-semibold'>Models ({snapshot.models.length})</h2>
        <Button variant='outline' disabled={busy || !snapshot.connected || snapshot.connecting} onClick={() => void act({ action: 'refresh-models' })}><RefreshCw className='mr-2 h-4 w-4' />Làm mới models</Button></div>
      <Input aria-label='Tìm model' placeholder='Tìm theo tên hoặc ID model…' value={search} onChange={event => setSearch(event.target.value)} />
      <div className='grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2'>{models.map(item => <button key={item.id} onClick={() => setModel(item.id)} className={`min-w-0 rounded-md border p-3 text-left ${item.id === model ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
        <p className='break-words text-sm font-medium'>{item.name}</p><code className='break-all text-xs text-muted-foreground'>{item.id}</code><p className='text-xs text-muted-foreground'>{item.kind === 'image' ? 'Tạo ảnh' : 'Chat'}</p>
      </button>)}</div>
      {!models.length && <p className='text-sm text-muted-foreground'>{snapshot.connected ? 'Chưa có model phù hợp. Thử làm mới danh sách hoặc đổi từ khóa.' : 'Kết nối Antigravity để lấy danh sách model từ tài khoản của bạn.'}</p>}
    </section>

    <section className='rounded-lg border bg-card p-4 sm:p-6 space-y-4'>
      <h2 className='font-semibold'>Gọi thử bằng API key</h2>
      <div className='space-y-2'><label htmlFor='ai-test-key' className='text-sm'>API key</label><Input id='ai-test-key' type='password' autoComplete='off' value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder='Dán key cá nhân của bạn' disabled={chatting} /></div>
      <div className='space-y-2'><label htmlFor='ai-test-model' className='text-sm'>Model</label>
        <select id='ai-test-model' value={model} onChange={event => setModel(event.target.value)} disabled={chatting || !snapshot.models.length} className='h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm'>
          {!snapshot.models.length && <option value=''>Chưa có model</option>}{snapshot.models.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select></div>
      <Textarea aria-label='Nội dung gọi model' value={prompt} onChange={event => setPrompt(event.target.value)} placeholder='Nhập nội dung gửi cho model…' maxLength={100000} className='min-h-28' disabled={chatting} />
      <Button disabled={busy || chatting || !snapshot.connected || snapshot.connecting || !apiKey.trim() || !model || !prompt.trim()} onClick={() => void chat()}>{chatting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Send className='mr-2 h-4 w-4' />}{chatting ? 'Đang gọi model…' : 'Gọi model'}</Button>
      {chatError && <p role='alert' className='break-words text-sm text-destructive'>{chatError}</p>}
      {answer && <pre className='whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm font-sans'>{answer}</pre>}
      {images.map((url, index) => <img key={index} src={url} alt={`Ảnh model tạo ${index + 1}`} className='max-w-full rounded-md' />)}
      <details><summary className='cursor-pointer text-sm font-medium'>Ví dụ gọi API từ ứng dụng khác</summary><pre className='mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs'>{example}</pre></details>
    </section>
  </div>;
}
