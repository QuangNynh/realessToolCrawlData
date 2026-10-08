const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-contract-'));
require.cache[require.resolve('../dist-backend/config')] = { exports: {
  DATA_DIR: temporary,
  UPLOADS_DIR: temporary,
  loadSettings: () => ({ port: 0 }),
} };

const { youtubeToolsService } = require('../dist-backend/youtube-tools.service');
const { instagramService } = require('../dist-backend/instagram.service');
const axios = require('axios');
const { createServer } = require('../dist-backend/server');
const { youtubeDownloads } = require('../dist-backend/youtube-downloads');

after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('desktop YouTube downloads reject browser origins and accept trusted queue commands', async t => {
  const calls = [];
  const clearCalls = [];
  t.mock.method(youtubeDownloads, 'add', input => { calls.push(input); return { id: 'queue-test', items: [] }; });
  t.mock.method(youtubeDownloads, 'clearHistory', kind => { clearCalls.push(kind); return { ...youtubeDownloads.snapshot(), clearedBatches: 1, cleanupErrors: [] }; });
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/internal/youtube-downloads`;
  const body = JSON.stringify({ action: 'create', urls: ['abcdefghijk'], kind: 'audio', directory: temporary });
  let response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://untrusted.example' }, body });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
  response = await fetch(url, { headers: { Origin: 'null' } });
  assert.equal(response.status, 403);
  response = await fetch(url);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).batches));
  response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, 'queue-test');
  assert.equal(calls[0].directory, temporary);
  const clearBody = JSON.stringify({ action: 'clear-history', kind: 'audio' });
  response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://untrusted.example' }, body: clearBody });
  assert.equal(response.status, 403);
  assert.equal(clearCalls.length, 0);
  response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: clearBody });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).clearedBatches, 1);
  assert.deepEqual(clearCalls, ['audio']);
  response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause', id: 'missing' }) });
  assert.equal(response.status, 400);
});

test('YouTube tools remain available and scheduling endpoints are removed', async t => {
  const transcript = {
    success: true,
    videoId: 'abcdefghijk',
    transcript: [{ text: 'Hello', duration: 1, offset: 0, lang: 'en' }],
    metadata: { title: 'Title' },
    transcriptLanguage: 'en',
  };
  t.mock.method(youtubeToolsService, 'getTranscript', async id => ({ ...transcript, videoId: id }));
  t.mock.method(youtubeToolsService, 'getTranscripts', async ids => ids.map(videoId => ({ ...transcript, videoId })));
  t.mock.method(youtubeToolsService, 'getChannelVideos', async () => ({
    totalVideos: 1,
    videos: [{ id: 'abcdefghijk', url: 'https://youtu.be/abcdefghijk', title: 'Title', view_count: 100 }],
  }));

  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const post = (route, body) => fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let response = await post('/youtube/transcript', { videoId: 'abcdefghijk' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).videoId, 'abcdefghijk');

  response = await post('/youtube/transcripts', { videoIds: ['abcdefghijk', '12345678901'] });
  assert.equal((await response.json()).length, 2);

  response = await post('/youtube/urls', { url: 'https://youtube.com/@channel' });
  assert.equal((await response.json()).videos[0].view_count, 100);

  for (const [method, route] of [
    ['GET', '/youtube/auth/url'],
    ['GET', '/youtube/channels'],
    ['GET', '/youtube/videos?channelId=channel'],
    ['POST', '/youtube/schedule'],
    ['POST', '/youtube/update-status'],
    ['POST', '/youtube/update-metadata'],
    ['POST', '/youtube/thumbnail'],
  ]) {
    response = await fetch(base + route, { method });
    assert.equal(response.status, 404, `${method} ${route}`);
  }
});

test('Instagram info, channel, export, cache, video and audio endpoints work', async t => {
  t.mock.method(instagramService, 'downloadVideo', async (_url, res) => res.type('video/mp4').send('video-data'));
  t.mock.method(instagramService, 'downloadAudio', async (_url, res) => res.type('audio/mpeg').send('audio-data'));
  t.mock.method(instagramService, 'getVideoInfo', async url => ({ success: true, title: 'Post', username: 'example', videoUrl: url }));
  t.mock.method(instagramService, 'getChannelVideos', async (username, type, page, pageSize) => {
    return { success: true, user: { username }, items: [{ type }], pagination: { page, pageSize, totalCount: 1, hasMore: false } };
  });
  t.mock.method(instagramService, 'exportChannelVideosToExcel', async (_username, res) => res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send('excel-data'));
  t.mock.method(instagramService, 'exportChannelImagesToZip', async (_username, res) => res.type('application/zip').send('zip-data'));
  t.mock.method(instagramService, 'clearAllChannelCache', async () => ({ success: true, deletedFilesCount: 2 }));

  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const post = (route, body) => fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let response = await post('/instagram/video', { url: 'https://www.instagram.com/reel/example/' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'video-data');

  response = await post('/instagram/audio', { url: 'https://www.instagram.com/reel/example/' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'audio-data');

  response = await post('/instagram/info', { url: 'post-code' });
  assert.equal((await response.json()).username, 'example');

  response = await post('/instagram/channel?type=video&page=2&pageSize=25', { username: 'example' });
  const channel = await response.json();
  assert.equal(channel.user.username, 'example');
  assert.deepEqual(channel.pagination, { page: 2, pageSize: 25, totalCount: 1, hasMore: false });
  assert.equal(channel.items[0].type, 'video');

  response = await post('/internal/instagram-session', { cookie: 'sessionid=test-session; csrftoken=test-csrf' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).connected, true);
  t.after(() => instagramService.setSessionCookie(null));

  response = await fetch(base + '/internal/instagram-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://untrusted.example' },
    body: JSON.stringify({ cookie: 'sessionid=other' }),
  });
  assert.equal(response.status, 403);

  response = await post('/instagram/channel/export?type=video', { username: 'example' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'excel-data');

  response = await post('/instagram/channel/export-images?type=image', { username: 'example' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'zip-data');

  response = await post('/instagram/channel/clear-cache', {});
  assert.equal((await response.json()).deletedFilesCount, 2);

  response = await post('/instagram/channel', {});
  assert.equal(response.status, 400);
});

test('Instagram audio and video use yt-dlp when the Instagram metadata API fails', async t => {
  t.mock.method(instagramService, 'getInstagramData', async () => { throw new Error('Instagram API unavailable'); });
  const fallbacks = [];
  t.mock.method(instagramService, 'downloadWithYtDlp', async (url, kind, res) => {
    fallbacks.push({ url, kind });
    res.type(kind === 'video' ? 'video/mp4' : 'audio/mpeg').send(`${kind}-fallback`);
  });
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const [route, url, expected] of [
    ['/instagram/video', 'https://www.instagram.com/p/example/', 'video-fallback'],
    ['/instagram/audio', 'https://www.instagram.com/reel/example/', 'audio-fallback'],
  ]) {
    const response = await fetch(base + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expected);
  }
  assert.deepEqual(fallbacks, [
    { url: 'https://www.instagram.com/p/example/', kind: 'video' },
    { url: 'https://www.instagram.com/reel/example/', kind: 'audio' },
  ]);
});

test('Instagram channel explains upstream login failures instead of reporting invalid input', async t => {
  t.mock.method(axios, 'request', async () => {
    const error = new Error('Request failed with status code 401');
    error.isAxiosError = true;
    error.response = { status: 401 };
    throw error;
  });
  await assert.rejects(
    instagramService.getChannelVideos('login_required_test'),
    error => error.statusCode === 502 && error.message.includes('Không thể quét kênh này ẩn danh')
  );
});

test('Instagram channel requests stay anonymous even if a cookie is present in the environment', async t => {
  instagramService.setSessionCookie(null);
  const oldCookie = process.env.INSTAGRAM_COOKIE;
  process.env.INSTAGRAM_COOKIE = 'sessionid=test-session; csrftoken=test-csrf';
  t.after(() => {
    if (oldCookie === undefined) delete process.env.INSTAGRAM_COOKIE;
    else process.env.INSTAGRAM_COOKIE = oldCookie;
  });
  const headers = [];
  t.mock.method(axios, 'request', async options => {
    headers.push(options.headers);
    if (options.url.includes('web_profile_info')) {
      return { data: { data: { user: { username: 'cookie_header_test', edge_owner_to_timeline_media: { count: 0 } } } } };
    }
    return { data: { items: [], more_available: false } };
  });
  const result = await instagramService.getChannelVideos('anonymous_request_test');
  assert.equal(result.user.username, 'cookie_header_test');
  assert.equal(headers.length, 2);
  assert.ok(headers.every(h => !('Cookie' in h) && !('X-CSRFToken' in h)));
});

test('Instagram channel forwards an Electron login session to both upstream requests', async t => {
  instagramService.setSessionCookie('sessionid=test-session; csrftoken=test-csrf', 'Electron-test-agent');
  t.after(() => instagramService.setSessionCookie(null));
  const headers = [];
  t.mock.method(axios, 'request', async options => {
    headers.push(options.headers);
    if (options.url.includes('web_profile_info')) {
      return { data: { data: { user: { username: 'connected_request_test', edge_owner_to_timeline_media: { count: 0 } } } } };
    }
    return { data: { items: [], more_available: false } };
  });
  const result = await instagramService.getChannelVideos('connected_request_test');
  assert.equal(result.user.username, 'connected_request_test');
  assert.equal(headers.length, 2);
  assert.ok(headers.every(h => h.Cookie === 'sessionid=test-session; csrftoken=test-csrf' && h['X-CSRFToken'] === 'test-csrf' && h['User-Agent'] === 'Electron-test-agent'));
});

test('Instagram channel uses the desktop request user agent when session sync has no agent yet', async t => {
  instagramService.setSessionCookie('sessionid=test-session');
  t.after(() => instagramService.setSessionCookie(null));
  const agents = [];
  t.mock.method(axios, 'request', async options => {
    agents.push(options.headers['User-Agent']);
    if (options.url.includes('web_profile_info')) {
      return { data: { data: { user: { username: 'request_agent_test', edge_owner_to_timeline_media: { count: 0 } } } } };
    }
    return { data: { items: [], more_available: false } };
  });
  await instagramService.getChannelVideos('request_agent_test', undefined, 1, 1, undefined, 'Electron-request-agent');
  assert.deepEqual(agents, ['Electron-request-agent', 'Electron-request-agent']);
});

test('Instagram channel saves each feed page and resumes without fetching profile again', async t => {
  let profileCalls = 0;
  const cursors = [];
  t.mock.method(axios, 'request', async options => {
    if (options.url.includes('web_profile_info')) {
      profileCalls++;
      return { data: { data: { user: { username: 'resume_feed_test', edge_owner_to_timeline_media: { count: 3 } } } } };
    }
    const cursor = new URL(options.url).searchParams.get('max_id');
    cursors.push(cursor);
    const number = cursor ? Number(cursor) : 1;
    return { data: { items: [{ id: String(number), code: `post${number}`, taken_at: 100 - number }], more_available: number < 3, next_max_id: number < 3 ? String(number + 1) : null } };
  });
  const first = await instagramService.getChannelVideos('resume_feed_test', undefined, 1, 1);
  assert.equal(first.items.length, 1);
  assert.equal(first.pagination.hasMore, true);
  const saved = JSON.parse(fs.readFileSync(path.join(temporary, 'instagram', 'resume_feed_test.json'), 'utf8'));
  assert.equal(saved.nextMaxId, '2');
  const second = await instagramService.getChannelVideos('resume_feed_test', undefined, 2, 1);
  assert.equal(second.items[0].id, '2');
  assert.equal(profileCalls, 1);
  assert.deepEqual(cursors, [null, '2']);
});

test('Instagram channel distinguishes upstream 429 and avoids retrying during cooldown', async t => {
  let calls = 0;
  t.mock.method(axios, 'request', async options => {
    calls++;
    if (options.url.includes('web_profile_info')) {
      const error = new Error('Request failed with status code 429');
      error.isAxiosError = true;
      error.response = { status: 429, headers: { 'retry-after': '120' } };
      throw error;
    }
    throw new Error('Unexpected feed call');
  });
  await assert.rejects(instagramService.getChannelVideos('limited_profile_test'), error => error.statusCode === 429 && error.stage === 'profile' && error.retryAfterSeconds === 120 && error.message.includes('Backend chưa nhận phiên'));
  await assert.rejects(instagramService.getChannelVideos('limited_profile_test'), error => error.statusCode === 429 && error.stage === 'profile' && error.retryAfterSeconds > 0);
  assert.equal(calls, 1);
  instagramService.setSessionCookie('sessionid=reset-cooldown');
  instagramService.setSessionCookie(null);
});

test('Instagram channel returns saved posts when a later feed request receives 429', async t => {
  let feedCalls = 0;
  t.mock.method(axios, 'request', async options => {
    if (options.url.includes('web_profile_info')) {
      return { data: { data: { user: { username: 'partial_429_test', edge_owner_to_timeline_media: { count: 10 } } } } };
    }
    feedCalls++;
    if (feedCalls === 1) {
      return { data: { items: [{ id: 'first', code: 'first', taken_at: 100 }], more_available: true, next_max_id: 'cursor2' } };
    }
    const error = new Error('Request failed with status code 429');
    error.isAxiosError = true;
    error.response = { status: 429, headers: {} };
    throw error;
  });
  const result = await instagramService.getChannelVideos('partial_429_test', undefined, 1, 2);
  assert.equal(result.items[0].id, 'first');
  assert.equal(result.pagination.incompletePage, true);
  assert.ok(result.pagination.retryAfterSeconds >= 299);
  const saved = JSON.parse(fs.readFileSync(path.join(temporary, 'instagram', 'partial_429_test.json'), 'utf8'));
  assert.equal(saved.nextMaxId, 'cursor2');
  assert.equal(saved.items.length, 1);
  instagramService.setSessionCookie('sessionid=reset-partial-cooldown');
  instagramService.setSessionCookie(null);
});

test('Instagram channel API returns retry timing separately from the error message', async t => {
  t.mock.method(instagramService, 'getChannelVideos', async () => {
    const error = new Error('Instagram đang giới hạn truy cập');
    error.statusCode = 429;
    error.retryAfterSeconds = 23;
    error.stage = 'profile';
    throw error;
  });
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/instagram/channel?page=1&pageSize=20`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pray' }),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '23');
  assert.deepEqual(await response.json(), { success: false, message: 'Instagram đang giới hạn truy cập', retryAfterSeconds: 23, stage: 'profile', sessionConnected: false });
});

test('Instagram session status reports whether the desktop session reached the backend', async t => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => instagramService.setSessionCookie(null));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/internal/instagram-session`;
  let response = await fetch(url);
  assert.deepEqual(await response.json(), { connected: false });
  response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'sessionid=test-session' }) });
  assert.equal(response.status, 200);
  response = await fetch(url);
  assert.deepEqual(await response.json(), { connected: true });
});
