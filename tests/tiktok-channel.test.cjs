const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-tiktok-channel-'));
const channelId = 'MS4wLjABAAAA9dm9ebDXuM4Iw7uxr7oh0iTAPqBSFCUoeWjjtdfMIqMFDL1XX9M6LwcKmYWRtYBI';
const calls = [];
let responses = [];
const exec = async (target, options, spawnOptions) => {
  calls.push({ target, options, spawnOptions });
  return responses.shift();
};
require.cache[require.resolve('youtube-dl-exec')] = { exports: { exec } };
require.cache[require.resolve('../dist-backend/config')] = { exports: { DATA_DIR: temporary } };
const { tiktokService } = require('../dist-backend/tiktok.service');
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('TikTok channel retries profile extraction and saves its public channel ID', async () => {
  responses = [
    { exitCode: 1, stderr: 'ERROR: [tiktok:user] example: Unable to extract secondary user ID', stdout: '' },
    { exitCode: 0, stderr: '', stdout: JSON.stringify({ id: channelId, title: 'example', entries: [{ id: '12345', title: 'Clip', timestamp: 100, view_count: 42 }] }) },
  ];
  const result = await tiktokService.getChannelVideos('https://www.tiktok.com/@example', 1);
  assert.equal(result.videos[0].url, 'https://www.tiktok.com/@example/video/12345');
  assert.equal(result.videos[0].view_count, 42);
  assert.deepEqual(calls.map(call => call.target), ['https://www.tiktok.com/@example', 'https://www.tiktok.com/@example']);
  assert.ok(calls.every(call => call.options.playlistItems === '1-1' && call.spawnOptions.reject === false));
  assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'tiktok-channel-ids.json'), 'utf8')).example, channelId);
});

test('TikTok channel uses the saved ID and keeps video URLs tied to the username', async () => {
  calls.length = 0;
  responses = [{ exitCode: 0, stderr: '', stdout: JSON.stringify({ id: channelId, entries: [{ id: '98765', url: `https://www.tiktok.com/@${channelId}/video/98765` }] }) }];
  const result = await tiktokService.getChannelVideos('@example', 1);
  assert.equal(calls[0].target, `tiktokuser:${channelId}`);
  assert.equal(result.videos[0].url, 'https://www.tiktok.com/@example/video/98765');
});

test('TikTok channel reports an actionable error after limited retries', async () => {
  calls.length = 0;
  responses = Array.from({ length: 3 }, () => ({ exitCode: 1, stderr: 'ERROR: [tiktok:user] blocked: Unable to extract secondary user ID', stdout: '' }));
  await assert.rejects(tiktokService.getChannelVideos('@blocked', 1), error =>
    error.message.includes('TikTok đang yêu cầu xác minh') && !error.message.includes('The command spawned'));
  assert.equal(calls.length, 3);
});
