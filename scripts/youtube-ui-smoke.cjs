const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-youtube-ui-'));
app.setPath('userData', path.join(artifactDir, 'profile'));
const requests = [];
const fixtures = {
  '/youtube/urls': { videos: [{ id: 'abcdefghijk', title: 'Video mẫu', url: 'https://youtube.com/watch?v=abcdefghijk', view_count: 12345, created_at: '2026-09-01' }] },
  '/youtube/transcripts': [{ success: true, videoId: 'abcdefghijk', metadata: { title: 'Tiêu đề mẫu', author: 'Kênh kiểm tra', thumbnails: [], viewCount: 12345 }, transcript: [{ text: 'Kịch bản kiểm tra', offset: 0, duration: 1 }], transcriptLanguage: 'vi' }],
  '/tiktok/channel-videos': { channel: 'example', videos: [{ id: '7348463423828725038', title: 'Video TikTok mẫu', url: 'https://www.tiktok.com/@example/video/7348463423828725038', view_count: 1234, like_count: 120, comment_count: 4, created_at: '2026-09-01T00:00:00.000Z', thumbnails: [] }] },
  '/pinterest/channel': { success: true, user: { username: 'example', full_name: 'Kênh Pinterest mẫu', follower_count: 10, pin_count: 1 }, items: [{ id: '861735709966971659', title: 'Pin video mẫu', description: '', type: 'video', is_video: true, pin_url: 'https://www.pinterest.com/pin/861735709966971659/', repin_count: 2, save_count: 3, created_at: '2026-09-01T00:00:00.000Z', image_url: '' }], pagination: { page: 1, pageSize: 100, totalCount: 1, hasMore: false } },
};

app.whenReady().then(async () => {
  let instagramConnected = false;
  let downloadFolder = null;
  ipcMain.handle('downloads:get-directory', () => downloadFolder);
  ipcMain.handle('downloads:choose-directory', () => (downloadFolder = '/tmp/lenyt-chosen-downloads'));
  const youtubeQueue = { batches: [], cooldownUntil: Date.now() + 120_000, active: null };
  ipcMain.handle('downloads:youtube', (_event, request) => {
    requests.push({ route: 'ipc:youtube-downloads', body: request });
    if (request.action === 'list') return youtubeQueue;
    if (request.action === 'clear-history') {
      const previous = youtubeQueue.batches.length;
      youtubeQueue.batches = youtubeQueue.batches.filter(batch => batch.kind !== request.kind || batch.items.some(item => !['success', 'failed'].includes(item.status)));
      return { ...youtubeQueue, clearedBatches: previous - youtubeQueue.batches.length, cleanupErrors: [] };
    }
    if (request.action === 'create') {
      const batch = {
        id: `batch-${youtubeQueue.batches.length + 1}`, kind: request.kind, quality: request.quality,
        directory: downloadFolder, createdAt: Date.now(), paused: false,
        items: request.urls.map((videoUrl, i) => ({
          id: `${request.kind}-${i}`, index: i + 1, videoUrl, videoId: videoUrl.slice(-11),
          status: i === 0 ? 'success' : i === 1 ? 'retrying' : 'failed', attempts: i === 1 ? 4 : 1,
          progress: i === 0 ? 100 : 0, nextAttemptAt: i === 1 ? youtubeQueue.cooldownUntil : 0,
          title: i === 0 ? 'Media đã lưu' : undefined,
          outputPath: i === 0 ? `${downloadFolder}/1.${request.kind === 'audio' ? 'm4a' : 'mp4'}` : undefined,
          error: i === 1 ? 'HTTP Error 429: Too Many Requests' : i > 1 ? 'Private video' : undefined,
        })),
      };
      youtubeQueue.batches.push(batch);
      return batch;
    }
    const batch = youtubeQueue.batches.find(batch => batch.id === request.id);
    batch.paused = request.action === 'pause';
    if (request.action === 'retry') batch.items.filter(item => item.status === 'failed').forEach(item => { item.status = 'pending'; item.attempts = 0; item.error = undefined; });
    return youtubeQueue;
  });
  ipcMain.handle('instagram:status', () => ({ connected: instagramConnected }));
  ipcMain.handle('instagram:connect', () => ({ connected: (instagramConnected = true) }));
  ipcMain.handle('instagram:sync', () => ({ connected: instagramConnected }));
  ipcMain.handle('instagram:disconnect', () => ({ connected: (instagramConnected = false) }));
  ipcMain.handle('update:get-status', () => ({ state: 'idle', currentVersion: '1.0.2', supported: false }));
  const intercept = async request => {
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api\/v1/, '');
    if (url.pathname.includes('youtube') || url.pathname.includes('instagram') || url.pathname.includes('tiktok') || url.pathname.includes('pinterest')) {
      requests.push({ route, query: url.search });
      if (['/tiktok/audio', '/tiktok/video', '/pinterest/audio', '/pinterest/video', '/pinterest/image'].includes(route)) {
        return new Response(JSON.stringify({ message: 'Lỗi giả lập' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });
      }
      if (route === '/pinterest/channel') {
        const body = await request.json();
        requests.at(-1).body = body;
        return new Response(JSON.stringify({ ...fixtures[route], items: body.type === 'image' ? [] : fixtures[route].items, pagination: { page: body.page, pageSize: body.pageSize, totalCount: body.type === 'image' ? 0 : 1, hasMore: false } }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });
      }
      return new Response(JSON.stringify(fixtures[route] || { success: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });
    }
    return new Response('', { status: 404 });
  };
  // Block all real external requests; render only the fixtures above.
  session.defaultSession.protocol.handle('http', intercept);
  session.defaultSession.protocol.handle('https', intercept);
  const win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../dist-electron/preload.js') } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('Failed to load resource')) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) {
      if (await js(predicate)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out: ' + predicate);
  };
  const tab = async name => {
    await js(`(() => { const el = [...document.querySelectorAll('[role=tab]')].find(el => el.textContent.trim() === ${JSON.stringify(name)}); if (!el) throw new Error('Missing tab'); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); el.click(); })()`);
  };
  const screenshot = async name => { await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); await new Promise(resolve => setTimeout(resolve, 150)); fs.writeFileSync(path.join(artifactDir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadFile(path.join(__dirname, '../dist/index.html'));
    await wait(`document.body.textContent.includes('Chọn thư mục tải xuống')`);
    await js(`[...document.querySelectorAll('button')].find(el => el.textContent.includes('Chọn thư mục tải xuống')).click()`);
    await wait(`document.body.textContent.includes('Lưu tại: lenyt-chosen-downloads')`);
    await wait(`document.querySelectorAll('[role=tab]').length === 4`);
    assert.deepEqual(await js(`[...document.querySelectorAll('[role=tab]')].map(el=>el.textContent.trim())`), ['Video view', 'Lấy tiêu đề kịch bản', 'Lấy audio gốc', 'Tải video YouTube']);
    await screenshot('video-view');
    for (const name of ['Lấy tiêu đề kịch bản', 'Lấy audio gốc', 'Tải video YouTube']) {
      await tab(name);
      await wait(`document.querySelector('[role=tab][data-state=active]').textContent.trim() === ${JSON.stringify(name)}`);
      await wait(`!!document.querySelector('[role=tabpanel][data-state=active] textarea')`);
      await screenshot(name === 'Lấy tiêu đề kịch bản' ? 'transcript' : name === 'Lấy audio gốc' ? 'audio' : 'video');
    }
    await tab('Lấy audio gốc');
    await js(`(() => { const input = document.querySelector('[role=tabpanel][data-state=active] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ['https://youtu.be/abcdefghijk', 'https://youtu.be/12345678901', 'https://youtu.be/abcdefghij2'].join(' ')); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Get Audio').click()`);
    await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Đã lưu 1/3')`);
    await wait(`document.body.textContent.includes('Tự tiếp tục sau')`);
    assert.equal(await js(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Private video')`), true);
    await screenshot('youtube-audio-queue');
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Tạm dừng').click()`);
    await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Đã tạm dừng')`);
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Tiếp tục').click()`);
    await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Tạm dừng')`);
    await tab('Tải video YouTube');
    await js(`(() => { const input = document.querySelector('[role=tabpanel][data-state=active] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, 'https://youtu.be/abcdefghijk'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Get Video').click()`);
    await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Đã lưu 1/1')`);
    await screenshot('youtube-video-queue');
    await tab('Lấy audio gốc');
    await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Đã lưu 1/3')`);
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Thử lại mục lỗi').click()`);
    await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Cần xử lý 0')`);
    assert.equal(youtubeQueue.batches[0].items[0].status, 'success');
    assert.equal(youtubeQueue.batches[0].items[1].attempts, 4);
    assert.ok(requests.some(request => request.body?.action === 'pause'));
    assert.ok(requests.some(request => request.body?.action === 'resume'));
    assert.ok(requests.some(request => request.body?.action === 'retry'));
    youtubeQueue.batches.push({ ...youtubeQueue.batches[0], id: 'finished-audio-history', items: [youtubeQueue.batches[0].items[0]] });
    await wait(`([...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Xóa lịch sử tải'))?.disabled === false`);
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Xóa lịch sử tải').click()`);
    await wait(`([...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Xóa lịch sử tải'))?.disabled === true`);
    assert.equal(youtubeQueue.batches.length, 2);
    assert.equal(youtubeQueue.batches[0].items.length, 3);
    assert.equal(youtubeQueue.batches[1].kind, 'video');
    await tab('Tải video YouTube');
    await wait(`([...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Xóa lịch sử tải'))?.disabled === false`);
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Xóa lịch sử tải').click()`);
    await wait(`![...document.querySelectorAll('[role=tabpanel][data-state=active] button')].some(el => el.textContent.trim() === 'Xóa lịch sử tải')`);
    assert.equal(youtubeQueue.batches.length, 1);
    assert.equal(youtubeQueue.batches[0].kind, 'audio');
    assert.equal(await js(`!!document.querySelector('[role=tabpanel][data-state=active] [data-slot=table]')`), false);
    assert.ok(requests.some(request => request.body?.action === 'clear-history' && request.body.kind === 'audio'));
    assert.ok(requests.some(request => request.body?.action === 'clear-history' && request.body.kind === 'video'));
    win.setSize(900, 900);
    await tab('Lấy audio gốc');
    await screenshot('youtube-narrow');
    assert.equal(await js(`document.documentElement.scrollWidth > window.innerWidth`), false);
    assert.equal(await js(`[...document.querySelectorAll('.youtube-page > [data-slot=tabs] > [role=tablist] > [role=tab]')].some(el => el.scrollWidth > el.clientWidth + 2)`), false);
    await js(`location.hash = '#/instagram'`);
    await wait(`document.querySelectorAll('[role=tab]').length === 2`);
    assert.deepEqual(await js(`[...document.querySelectorAll('[role=tab]')].map(el => el.textContent.trim())`), ['Tải video hàng loạt', 'Tải audio hàng loạt']);
    await screenshot('instagram-video');
    await wait(`document.body.textContent.includes('Chưa kết nối Instagram')`);
    await js(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Kết nối Instagram').click()`);
    await wait(`document.body.textContent.includes('Đã lưu phiên Instagram')`);
    for (const name of ['Tải video hàng loạt', 'Tải audio hàng loạt']) {
      await tab(name);
      await wait(`document.querySelector('[role=tab][data-state=active]').textContent.trim() === ${JSON.stringify(name)}`);
      await screenshot(name === 'Tải video hàng loạt' ? 'instagram-video' : 'instagram-audio');
    }
    await js(`location.hash = '#/instagram?tab=channel'`);
    await wait(`document.querySelector('[role=tab][data-state=active]').textContent.trim() === 'Tải video hàng loạt'`);
    await js(`location.hash = '#/tiktok'`);
    await wait(`document.querySelectorAll('[role=tab]').length === 3`);
    assert.deepEqual(await js(`[...document.querySelectorAll('[role=tab]')].map(el => el.textContent.trim())`), ['Lấy thông tin kênh', 'Tải audio TikTok', 'Tải video TikTok']);
    await js(`(() => { const input = document.querySelector('input[placeholder="https://www.tiktok.com/@username"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'https://www.tiktok.com/@example'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await js(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Quét kênh').click()`);
    await wait(`document.body.textContent.includes('Video TikTok mẫu')`);
    assert.ok(requests.some(request => request.route === '/tiktok/channel-videos'));
    assert.equal(await js(`document.body.textContent.includes('Tải tất cả MP3 (Lần lượt)') && document.body.textContent.includes('Xuất Excel')`), true);
    await screenshot('tiktok-channel');
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.includes('Tải tất cả MP3')).click()`);
    await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Request failed')`);
    assert.ok(requests.some(request => request.route === '/tiktok/audio'));
    for (const name of ['Tải audio TikTok', 'Tải video TikTok']) {
      await tab(name);
      await wait(`document.querySelector('[role=tab][data-state=active]').textContent.trim() === ${JSON.stringify(name)}`);
      await js(`(() => { const input = document.querySelector('[role=tabpanel][data-state=active] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, 'https://www.tiktok.com/@example/video/7348463423828725038'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.includes('Định dạng danh sách link')).click()`);
      await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.includes('Bắt đầu tải')).click()`);
      await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Tải thất bại') || document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Request failed')`);
      assert.ok(requests.some(request => request.route === (name === 'Tải audio TikTok' ? '/tiktok/audio' : '/tiktok/video')));
      await screenshot(name === 'Tải audio TikTok' ? 'tiktok-audio' : 'tiktok-video');
    }
    await js(`location.hash = '#/pinterest'`);
    await wait(`document.querySelectorAll('[role=tab]').length === 4`);
    assert.deepEqual(await js(`[...document.querySelectorAll('[role=tab]')].map(el => el.textContent.trim())`), ['Lấy thông tin kênh', 'Tải audio hàng loạt', 'Tải video hàng loạt', 'Tải ảnh hàng loạt']);
    await js(`(() => { const input = document.querySelector('input[placeholder="https://www.pinterest.com/username/_created/"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'https://www.pinterest.com/example/_created/'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.trim() === 'Quét kênh').click()`);
    await wait(`document.body.textContent.includes('Pin video mẫu')`);
    assert.ok(requests.some(request => request.route === '/pinterest/channel' && request.body.page === 1 && request.body.pageSize === 100));
    await js(`(() => { const select = document.querySelector('select[aria-label="Lọc ghim"]'); select.value = 'image'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(`document.body.textContent.includes('Không có ghim phù hợp bộ lọc này.')`);
    assert.ok(requests.some(request => request.route === '/pinterest/channel' && request.body.type === 'image'));
    await screenshot('pinterest-channel');
    for (const [name, route] of [['Tải audio hàng loạt', '/pinterest/audio'], ['Tải video hàng loạt', '/pinterest/video'], ['Tải ảnh hàng loạt', '/pinterest/image']]) {
      await tab(name);
      await wait(`document.querySelector('[role=tab][data-state=active]').textContent.trim() === ${JSON.stringify(name)}`);
      await js(`(() => { const input = document.querySelector('[role=tabpanel][data-state=active] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, 'https://www.pinterest.com/pin/861735709966971659/'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.includes('Định dạng URL')).click()`);
      await js(`[...document.querySelectorAll('[role=tabpanel][data-state=active] button')].find(el => el.textContent.includes('Hàng Loạt')).click()`);
      await wait(`document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Request failed')`);
      assert.ok(requests.some(request => request.route === route));
      await screenshot(name === 'Tải audio hàng loạt' ? 'pinterest-audio' : name === 'Tải video hàng loạt' ? 'pinterest-video' : 'pinterest-image');
    }
    await js(`location.hash = '#/settings'`);
    await wait(`document.body.textContent.includes('Settings / About')`);
    await js(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Check for Updates').click()`);
    await wait(`document.querySelector('[role=dialog]')?.textContent.includes('Updates are available in the installed Windows or macOS app.')`);
    await screenshot('settings-update');
    await js(`document.querySelector('[role=dialog] button[aria-label="Close"], [role=dialog] button:has(.sr-only)').click()`);
    await wait(`!document.querySelector('[role=dialog]')`);
    // Check the window edge, local table scrolling and usable pagination with
    // a full 1,000-row queue at desktop, tablet and mobile widths.
    youtubeQueue.batches.push({
      ...youtubeQueue.batches[0], id: 'responsive-queue', createdAt: Date.now(), paused: true,
      items: Array.from({ length: 1000 }, (_, i) => ({
        ...youtubeQueue.batches[0].items[0], id: `responsive-${i}`, index: i + 1,
        title: 'Tiêu đề dài để kiểm tra bảng trên cửa sổ nhỏ '.repeat(6),
        status: i === 0 ? 'success' : 'pending', progress: i === 0 ? 100 : 0,
      })),
    });
    const measure = () => js(`(() => {
      const shell = document.querySelector('.app-shell').getBoundingClientRect();
      const main = document.querySelector('main');
      return {
        fillsWindow: Math.abs(shell.bottom - innerHeight) <= 1 && Math.abs(shell.width - innerWidth) <= 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        mainOverflow: main.scrollWidth > main.clientWidth + 1,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        shellBackground: getComputedStyle(document.querySelector('.app-shell')).backgroundColor,
        clippedTabs: [...main.querySelectorAll('[role=tab]')].some(el => el.scrollWidth > el.clientWidth + 2),
      };
    })()`);
    for (const width of [375, 480, 768, 1024, 1440]) {
      win.setContentSize(width, 700);
      for (const theme of ['light', 'dark']) {
        if ((await js(`document.documentElement.classList.contains('dark')`)) !== (theme === 'dark')) {
          await js(`document.querySelector('header button[aria-label^="Chuyển sang giao diện"]').click()`);
        }
        for (const route of ['/?tab=audio', '/instagram', '/tiktok', '/pinterest', '/settings']) {
          await js(`location.hash = ${JSON.stringify('#' + route)}`);
          await new Promise(resolve => setTimeout(resolve, 300));
          const state = await measure();
          assert.equal(state.fillsWindow, true, `${width}px ${theme} ${route}: window height`);
          assert.equal(state.pageOverflow, false, `${width}px ${theme} ${route}: page overflow`);
          assert.equal(state.mainOverflow, false, `${width}px ${theme} ${route}: content overflow`);
          assert.equal(state.clippedTabs, false, `${width}px ${theme} ${route}: clipped tabs`);
          assert.equal(state.bodyBackground, state.shellBackground, `${width}px ${theme}: theme at window edge`);
          if (route === '/?tab=audio') {
            await wait(`document.body.textContent.includes('Đã lưu 1/1000')`);
            await js(`document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight`);
            await js(`document.querySelector('button[aria-label="Trang sau"]').click()`);
            await wait(`document.querySelector('nav[aria-label="Phân trang bảng"]').textContent.includes('Trang 2/20')`);
            assert.equal(await js(`document.querySelector('nav[aria-label="Phân trang bảng"]').getBoundingClientRect().bottom <= innerHeight + 1`), true);
            if ([375, 768, 1440].includes(width)) await screenshot(`responsive-${width}-${theme}-pagination`);
            await js(`document.querySelector('main').scrollTop = 0`);
            if ([375, 768, 1440].includes(width)) await screenshot(`responsive-${width}-${theme}`);
          }
        }
      }
    }
    win.setContentSize(375, 700);
    await js(`document.querySelector('button[aria-label="Mở menu điều hướng"]').click()`);
    await wait(`document.querySelector('button[aria-label="Mở menu điều hướng"]').getAttribute('aria-expanded') === 'true'`);
    await screenshot('responsive-mobile-menu');
    await js(`document.querySelector('#app-navigation button[aria-label="YouTube"]').click()`);
    await wait(`location.hash === '#/' && document.querySelector('button[aria-label="Mở menu điều hướng"]').getAttribute('aria-expanded') === 'false'`);
    // Zooming or resizing must keep the page flush with the window's bottom.
    win.setContentSize(1024, 480);
    win.webContents.setZoomFactor(1.25);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal((await measure()).fillsWindow, true);
    assert.equal((await measure()).mainOverflow, false);
    await screenshot('responsive-short-window-zoom');
    win.webContents.setZoomFactor(1);
    assert.deepEqual(errors, []);
    console.log('PASS: YouTube, Instagram, TikTok, Pinterest and Settings render; queues, themes, responsive widths, pagination, mobile menu and zoom are valid.');
    console.log('Screenshots:', artifactDir);
    app.exit(0);
  } catch (error) { console.error(error); await screenshot('failure'); console.log('Screenshots:', artifactDir); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
