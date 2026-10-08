const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');
const { createHash } = require('node:crypto');
const { YouTubeDownloadQueue } = require('../dist-backend/youtube-download-queue');
const policy = require('../dist-backend/youtube-download-policy');
const roots = [];
after(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function setup(t, downloader, pacing = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-download-test-'));
  roots.push(root);
  const directory = path.join(root, 'destination');
  fs.mkdirSync(directory);
  const queue = new YouTubeDownloadQueue(path.join(root, 'queue'), downloader, pacing, () => 0);
  t.after(() => queue.shutdown());
  return { queue, root, directory };
}

async function fixture(_batch, item, workspace, _signal, progress) {
  const file = path.join(workspace, 'media.m4a');
  fs.writeFileSync(file, `verified-audio-${item.videoId}`);
  progress(100);
  return { file, title: `Audio ${item.index}`, extension: 'm4a' };
}

async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for queue');
    await delay(5);
  }
}

test('only supported YouTube URLs are accepted and equivalent links have one identity', () => {
  for (const url of ['abcdefghijk', 'https://youtu.be/abcdefghijk?t=2', 'https://www.youtube.com/watch?v=abcdefghijk&list=example', 'https://youtube.com/shorts/abcdefghijk', 'https://music.youtube.com/watch?v=abcdefghijk']) {
    assert.equal(policy.youtubeVideoId(url), 'abcdefghijk');
  }
  for (const url of ['https://attacker.example/watch?v=abcdefghijk', 'file:///etc/passwd', 'https://youtube.com/@channel', 'https://youtube.com.evil.example/watch?v=abcdefghijk', 'invalid-id']) {
    assert.throws(() => policy.youtubeVideoId(url), /không hợp lệ/);
  }
});

test('retry policy distinguishes blocks, outages, access restrictions and local errors', () => {
  const cases = [
    ['HTTP Error 429: Too Many Requests', 'rate_limit'],
    ["Video unavailable. Sign in to confirm you’re not a bot", 'rate_limit'],
    ['HTTP Error 403: Forbidden', 'network'],
    ['ECONNRESET', 'network'],
    ['fragment unavailable', 'network'],
    ['Private video. Sign in if granted access', 'unavailable'],
    ['Sign in to confirm your age', 'unavailable'],
    ['Video is not available in your country', 'unavailable'],
    ['ENOSPC: no space left on device', 'filesystem'],
    ['no such option: --invalid', 'filesystem'],
    ['unexpected extractor layout', 'unknown'],
  ];
  for (const [message, kind] of cases) assert.equal(policy.classifyDownloadError(new Error(message)).kind, kind, message);
  assert.equal(policy.retryDelay('rate_limit', 1, () => 0), 120000);
  assert.equal(policy.retryDelay('rate_limit', 2, () => 0), 240000);
  assert.equal(policy.retryDelay('rate_limit', 100, () => 0), 3600000);
  assert.equal(policy.retryDelay('network', 1, () => 0), 15000);
  assert.equal(policy.classifyDownloadError({ response: { status: 429, headers: { 'retry-after': '600' } } }).retryAfterMs, 600000);
});

test('a 1,000-item batch writes every file once, deduplicates links and never overwrites files', { timeout: 60000 }, async t => {
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  const { queue, directory } = setup(t, async (...args) => {
    calls++; inFlight++; peak = Math.max(peak, inFlight);
    try { return await fixture(...args); } finally { inFlight--; }
  });
  fs.writeFileSync(path.join(directory, '1.m4a'), 'existing-file');
  const urls = Array.from({ length: 999 }, (_, i) => `v${String(i).padStart(10, '0')}`);
  // Exactly 1,000 input links with one duplicate identity.
  queue.add({ urls: [...urls, `https://youtu.be/${urls[0]}`], kind: 'audio', directory });
  queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches.every(batch => batch.items.every(item => item.status === 'success')), 55000);
  assert.equal(calls, 1000);
  assert.equal(peak, 1);
  assert.equal(fs.readFileSync(path.join(directory, '1.m4a'), 'utf8'), 'existing-file');
  assert.equal(fs.readdirSync(directory).length, 1001);
  const items = queue.snapshot().batches.flatMap(batch => batch.items);
  assert.equal(new Set(items.map(item => item.outputPath)).size, 1000);
  for (const item of items) assert.equal(fs.readFileSync(item.outputPath, 'utf8'), `verified-audio-${item.videoId}`);
  const cleared = queue.clearHistory('audio');
  assert.equal(cleared.clearedBatches, 2);
  assert.equal(cleared.batches.length, 0);
  assert.equal(fs.readdirSync(directory).length, 1001);
});

test('a block pauses both audio and video requests and retries after the shared cooldown', async t => {
  t.mock.method(policy, 'retryDelay', () => 100);
  const starts = [];
  const { queue, directory } = setup(t, async (...args) => {
    starts.push(Date.now());
    if (starts.length === 1) throw Object.assign(new Error('Too Many Requests'), { response: { status: 429, headers: { 'retry-after': '0.15' } } });
    return fixture(...args);
  });
  queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  queue.add({ urls: ['12345678901'], kind: 'video', directory });
  await until(() => queue.snapshot().batches[0].items[0].status === 'retrying');
  const snapshot = queue.snapshot();
  assert.equal(snapshot.batches[0].items[0].errorKind, 'rate_limit');
  assert.equal(snapshot.batches[1].items[0].attempts, 0);
  await delay(30);
  assert.equal(starts.length, 1);
  await until(() => queue.snapshot().batches.every(batch => batch.items[0].status === 'success'));
  assert.ok(starts[1] - starts[0] >= 145);
  assert.equal(queue.snapshot().batches[0].items[0].attempts, 2);
});

test('network failures can recover after more than three rounds; unavailable videos remain listed', async t => {
  t.mock.method(policy, 'retryDelay', () => 5);
  const { queue, directory } = setup(t, async (...args) => {
    const item = args[1];
    if (item.videoId === '12345678901') throw new Error('Private video');
    if (item.attempts <= 6) throw new Error('ECONNRESET');
    return fixture(...args);
  });
  queue.add({ urls: ['abcdefghijk', '12345678901'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches[0].items.every(item => ['success', 'failed'].includes(item.status)));
  const [success, failed] = queue.snapshot().batches[0].items;
  assert.equal(success.attempts, 7);
  assert.equal(failed.attempts, 1);
  assert.equal(failed.errorKind, 'unavailable');
  assert.match(failed.error, /Private/);
});

test('pause finishes the active save, retry skips successful files, and local errors pause the batch', async t => {
  let release;
  let calls = 0;
  const { queue, directory } = setup(t, async (...args) => {
    calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    if (calls === 2) throw new Error('ENOSPC: no space left');
    return fixture(...args);
  });
  const batch = queue.add({ urls: ['abcdefghijk', '12345678901', 'abcdefghij2'], kind: 'audio', directory });
  await until(() => Boolean(release));
  queue.control(batch.id, 'pause');
  release();
  await until(() => queue.snapshot().batches[0].items[0].status === 'success');
  await delay(20);
  assert.equal(calls, 1);
  queue.control(batch.id, 'resume');
  await until(() => queue.snapshot().batches[0].items[1].status === 'failed');
  assert.equal(queue.snapshot().batches[0].paused, true);
  assert.equal(queue.snapshot().batches[0].items[2].attempts, 0);
  queue.control(batch.id, 'retry');
  await until(() => queue.snapshot().batches[0].items.every(item => item.status === 'success'));
  assert.equal(calls, 4);
  assert.equal(queue.snapshot().batches[0].items[0].attempts, 1);
});

test('restart preserves partial files, success history and global cooldown', async t => {
  t.mock.method(policy, 'retryDelay', () => 80);
  let calls = 0;
  const { queue, root, directory } = setup(t, async (_batch, _item, workspace) => {
    calls++;
    fs.writeFileSync(path.join(workspace, 'media.m4a.part'), 'partial');
    throw new Error('HTTP Error 429');
  });
  queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches[0].items[0].status === 'retrying');
  const before = queue.snapshot();
  queue.shutdown();
  const restored = new YouTubeDownloadQueue(path.join(root, 'queue'), async (...args) => {
    calls++;
    assert.equal(fs.readFileSync(path.join(args[2], 'media.m4a.part'), 'utf8'), 'partial');
    return fixture(...args);
  }, 0, () => 0);
  t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().cooldownUntil, before.cooldownUntil);
  assert.equal(restored.snapshot().batches[0].items[0].attempts, 1);
  await delay(10);
  assert.equal(calls, 1);
  await until(() => restored.snapshot().batches[0].items[0].status === 'success');
  assert.equal(calls, 2);
  restored.shutdown();
  const final = new YouTubeDownloadQueue(path.join(root, 'queue'), async () => { throw new Error('must not redownload success'); }, 0);
  t.after(() => final.shutdown());
  assert.equal(final.snapshot().batches[0].items[0].status, 'success');
});

test('a crash between file commit and success recording recovers without downloading again', async t => {
  const { queue, root, directory } = setup(t, fixture);
  const batch = queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  queue.control(batch.id, 'pause');
  queue.shutdown();
  const manifest = path.join(root, 'queue', 'queue.json');
  const saved = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const item = saved.batches[0].items[0];
  item.status = 'loading'; item.bytes = 14; item.outputPath = path.join(directory, '1.m4a');
  item.sha256 = createHash('sha256').update('committed-file').digest('hex');
  fs.writeFileSync(item.outputPath, 'committed-file');
  saved.batches[0].paused = false;
  fs.writeFileSync(manifest, JSON.stringify(saved));
  const restored = new YouTubeDownloadQueue(path.join(root, 'queue'), async () => { assert.fail('already committed file was downloaded again'); }, 0);
  t.after(() => restored.shutdown());
  await until(() => restored.snapshot().batches[0].items[0].status === 'success');
  assert.equal(fs.readdirSync(directory).length, 1);
});

test('media preparation configures safe retries and validates actual audio before returning', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-media-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
  const fixtureFile = path.join(root, 'fixture.m4a');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'aac', fixtureFile]);
  const library = require('youtube-dl-exec');
  let flags;
  let spawnOptions;
  t.mock.method(library, 'exec', (_url, options, childOptions) => {
    flags = options; spawnOptions = childOptions;
    const file = path.join(root, 'media.m4a');
    fs.copyFileSync(fixtureFile, file);
    return Object.assign(Promise.resolve({ stdout: `LENYT_TITLE="Test Audio"\nLENYT_FILE=${JSON.stringify(file)}` }), { stdout: new PassThrough() });
  });
  const { youtubeToolsService } = require('../dist-backend/youtube-tools.service');
  const result = await youtubeToolsService.prepareMedia('abcdefghijk', 'audio', root);
  assert.equal(result.extension, 'm4a');
  assert.equal(result.title, 'Test Audio');
  assert.equal(flags.abortOnUnavailableFragments, true);
  assert.equal(flags.concurrentFragments, 2);
  assert.equal(flags.continue, true);
  assert.equal(flags.socketTimeout, 30);
  assert.equal(flags.retries, 3);
  assert.ok(flags.jsRuntimes.startsWith('node:'));
  assert.equal(spawnOptions.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(flags.extractorArgs, undefined);
  // Parse these flags with the real bundled yt-dlp binary without making a request.
  execFileSync(library.constants.YOUTUBE_DL_PATH, [...library.args(flags), '--help'], { stdio: 'pipe' });
  fs.writeFileSync(fixtureFile, 'not-a-media-file');
  await assert.rejects(() => youtubeToolsService.prepareMedia('abcdefghijk', 'audio', root));
});

test('destination volumes without hard links still save a complete file', async t => {
  t.mock.method(fs.promises, 'link', async () => { throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' }); });
  const { queue, directory } = setup(t, fixture);
  queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches[0].items[0].status === 'success');
  assert.equal(fs.readFileSync(path.join(directory, '1.m4a'), 'utf8'), 'verified-audio-abcdefghijk');
  assert.deepEqual(fs.readdirSync(directory), ['1.m4a']);
});

test('same-sized unrelated files are never mistaken for a recovered download', async t => {
  let calls = 0;
  const { queue, root, directory } = setup(t, fixture);
  const batch = queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  queue.control(batch.id, 'pause'); queue.shutdown();
  const manifest = path.join(root, 'queue', 'queue.json');
  const saved = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const item = saved.batches[0].items[0];
  item.status = 'loading'; item.bytes = 14; item.outputPath = path.join(directory, '1.m4a');
  item.sha256 = createHash('sha256').update('committed-file').digest('hex');
  fs.writeFileSync(item.outputPath, 'unrelated-file');
  saved.batches[0].paused = false;
  fs.writeFileSync(manifest, JSON.stringify(saved));
  const restored = new YouTubeDownloadQueue(path.join(root, 'queue'), async (...args) => { calls++; return fixture(...args); }, 0);
  t.after(() => restored.shutdown());
  await until(() => restored.snapshot().batches[0].items[0].status === 'success');
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(item.outputPath, 'utf8'), 'unrelated-file');
  assert.equal(fs.readFileSync(path.join(directory, '1 (2).m4a'), 'utf8'), 'verified-audio-abcdefghijk');
});

test('clear history reclaims finished batches and temp files, preserves media and unfinished work, and compacts both manifests', async t => {
  const { queue, root, directory } = setup(t, async (...args) => {
    if (args[1].videoId === 'abcdefghij2') {
      fs.writeFileSync(path.join(args[2], 'media.m4a.part'), 'failed-partial');
      throw new Error('Private video');
    }
    return fixture(...args);
  });
  const audio = queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches[0].items[0].status === 'success' && !queue.snapshot().active);
  const video = queue.add({ urls: ['12345678901'], kind: 'video', directory });
  await until(() => queue.snapshot().batches[1].items[0].status === 'success' && !queue.snapshot().active);
  const failed = queue.add({ urls: ['abcdefghij2'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches[2].items[0].status === 'failed' && !queue.snapshot().active);
  const pending = queue.add({ urls: ['abcdefghij3'], kind: 'audio', directory });
  queue.control(pending.id, 'pause');
  const workRoot = path.join(root, 'queue', 'files');
  const audioCache = path.join(workRoot, audio.items[0].id);
  fs.mkdirSync(audioCache);
  fs.writeFileSync(path.join(audioCache, 'media.m4a'), 'leftover-cache');
  const staging = path.join(directory, `.lenyt-${audio.items[0].id}.part`);
  fs.writeFileSync(staging, 'leftover-staging');
  const pendingCache = path.join(workRoot, pending.items[0].id);
  fs.mkdirSync(pendingCache);
  fs.writeFileSync(path.join(pendingCache, 'media.m4a.part'), 'pending-partial');
  fs.writeFileSync(path.join(directory, 'unrelated.part'), 'unrelated-file');
  const audioFile = queue.snapshot().batches[0].items[0].outputPath;
  const videoFile = queue.snapshot().batches[1].items[0].outputPath;
  const manifest = path.join(root, 'queue', 'queue.json');
  const previousSize = fs.statSync(manifest).size;
  const cleared = queue.clearHistory('audio');
  assert.equal(cleared.clearedBatches, 2);
  assert.deepEqual(cleared.cleanupErrors, []);
  assert.deepEqual(cleared.batches.map(batch => batch.id), [video.id, pending.id]);
  assert.equal(fs.readFileSync(audioFile, 'utf8'), 'verified-audio-abcdefghijk');
  assert.equal(fs.readFileSync(videoFile, 'utf8'), 'verified-audio-12345678901');
  assert.equal(fs.existsSync(audioCache), false);
  assert.equal(fs.existsSync(path.join(workRoot, failed.items[0].id)), false);
  assert.equal(fs.existsSync(staging), false);
  assert.equal(fs.readFileSync(path.join(pendingCache, 'media.m4a.part'), 'utf8'), 'pending-partial');
  assert.equal(fs.readFileSync(path.join(directory, 'unrelated.part'), 'utf8'), 'unrelated-file');
  assert.ok(fs.statSync(manifest).size < previousSize);
  for (const file of [manifest, manifest + '.bak']) {
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).batches.map(batch => batch.id), [video.id, pending.id]);
  }
  queue.shutdown();
  // Force recovery from the backup: deleted history must not reappear.
  fs.writeFileSync(manifest, '{corrupted');
  const restored = new YouTubeDownloadQueue(path.join(root, 'queue'), async () => assert.fail('paused work must not download'), 0);
  t.after(() => restored.shutdown());
  assert.deepEqual(restored.snapshot().batches.map(batch => batch.id), [video.id, pending.id]);
  assert.equal(restored.snapshot().batches[1].paused, true);
  assert.equal(restored.clearHistory('video').clearedBatches, 1);
  assert.equal(fs.existsSync(videoFile), true);
  assert.deepEqual(restored.snapshot().batches.map(batch => batch.id), [pending.id]);
  assert.equal(restored.clearHistory('audio').clearedBatches, 0);
  assert.throws(() => restored.clearHistory('all'), /không hợp lệ/);
});

test('clear history leaves the active worker and mixed batches intact', async t => {
  let release;
  let activeSignal;
  const { queue, root, directory } = setup(t, async (...args) => {
    if (args[1].videoId === 'abcdefghij2') {
      activeSignal = args[3];
      fs.writeFileSync(path.join(args[2], 'media.m4a.part'), 'active-partial');
      await new Promise(resolve => { release = resolve; });
    }
    return fixture(...args);
  });
  queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches[0].items[0].status === 'success' && !queue.snapshot().active);
  const active = queue.add({ urls: ['12345678901', 'abcdefghij2', 'abcdefghij3'], kind: 'audio', directory });
  await until(() => Boolean(release));
  const activeFile = path.join(root, 'queue', 'files', active.items[1].id, 'media.m4a.part');
  const before = queue.snapshot().batches[1].items;
  const result = queue.clearHistory('audio');
  assert.equal(result.clearedBatches, 1);
  assert.deepEqual(result.batches[0].items, before);
  assert.equal(result.active, active.items[1].id);
  assert.equal(activeSignal.aborted, false);
  assert.equal(fs.readFileSync(activeFile, 'utf8'), 'active-partial');
  assert.equal(queue.clearHistory('audio').clearedBatches, 0);
  release();
  await until(() => queue.snapshot().batches[0].items.every(item => item.status === 'success') && !queue.snapshot().active);
  assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.m4a')).length, 4);
});

test('failed history cleanup remains available to retry and never deletes downloaded media', async t => {
  const { queue, root, directory } = setup(t, fixture);
  const batch = queue.add({ urls: ['abcdefghijk'], kind: 'audio', directory });
  await until(() => queue.snapshot().batches[0].items[0].status === 'success' && !queue.snapshot().active);
  const workspace = path.join(root, 'queue', 'files', batch.items[0].id);
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'media.m4a.part'), 'cache');
  const realRemove = fs.rmSync;
  const mockedRemove = t.mock.method(fs, 'rmSync', (file, options) => {
    if (file === workspace) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    return realRemove(file, options);
  });
  const result = queue.clearHistory('audio');
  assert.equal(result.clearedBatches, 0);
  assert.equal(result.cleanupErrors.length, 1);
  assert.equal(result.batches.length, 1);
  assert.equal(fs.existsSync(result.batches[0].items[0].outputPath), true);
  mockedRemove.mock.restore();
  assert.equal(queue.clearHistory('audio').clearedBatches, 1);
  assert.equal(fs.existsSync(workspace), false);
  assert.equal(fs.existsSync(result.batches[0].items[0].outputPath), true);
});
