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
    assert.deepEqual(errors, []);
    console.log('PASS: YouTube, Instagram, TikTok, Pinterest and Settings render; download and updater controls are valid.');
    console.log('Screenshots:', artifactDir);
    app.exit(0);
  } catch (error) { console.error(error); await screenshot('failure'); console.log('Screenshots:', artifactDir); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
