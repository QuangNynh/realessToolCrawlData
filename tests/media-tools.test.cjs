const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { MediaJobs } = require('../dist-backend/media-jobs');
const { createMediaProcessor, srtToScript, validSrt } = require('../dist-backend/media-processor');
const { mediaFfmpeg, runMediaProcess } = require('../dist-backend/media-runtime');
const fixtureSrt = '1\n00:00:00,000 --> 00:00:01,200\nXin chào <script>hello</script>\n\n2\n00:00:01,200 --> 00:00:02,400\nĐây là lời nói.\n';
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-media-test-'));
const readyRuntime = { status: () => ({ ready: true, checking: false, installing: false, message: 'Test' }), shutdown() {} };
const wait = async (predicate) => { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out waiting for queue'); };
const done = service => service.snapshot().jobs.every(job => job.items.every(item => !['pending', 'running'].includes(item.status)));
function file(dir, name = 'voice.wav') { const filename = path.join(dir, name); fs.writeFileSync(filename, 'fixture input'); return filename; }
function fakeProcessor(dir, callback = () => {}) {
  return async (input, job, item, signal) => {
    callback(input, job, item, signal);
    const output = path.join(dir, item.id + '.tmp'); fs.writeFileSync(output, job.tool === 'script' ? 'Nội dung của ' + item.name : fixtureSrt);
    return { path: output, extension: job.tool === 'script' ? 'txt' : 'srt', cleanup: () => fs.rmSync(output, { force: true }) };
  };
}

test('SRT conversion preserves speech and removes only timestamp/index lines', () => {
  assert.equal(srtToScript('\uFEFF' + fixtureSrt.replace(/\n/g, '\r\n')), 'Xin chào <script>hello</script>\n\nĐây là lời nói.');
  assert.equal(validSrt(fixtureSrt), true); assert.equal(validSrt('1\n00:00:00,000 --> 00:00:01,000\n'), false);
  assert.equal(srtToScript('1\n00:00:00,000 --> 00:00:01,000\n1234\n'), '1234');
});

test('real FFmpeg extracts all five audio formats without Whisper or shell filename interpolation', async () => {
  const dir = root();
  try {
    const input = path.join(dir, 'video $(echo injection) tiếng Việt.mp4');
    await runMediaProcess(mediaFfmpeg, ['-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', input], new AbortController().signal);
    const processor = createMediaProcessor({ executable() { throw new Error('Whisper must not be called'); } });
    for (const format of ['mp3', 'wav', 'aac', 'flac', 'ogg']) {
      const result = await processor(input, { tool: 'extract', options: { format, bitrate: '192' } }, {}, new AbortController().signal, () => {});
      try {
        assert.ok(fs.statSync(result.path).size > 100);
        await runMediaProcess(mediaFfmpeg, ['-nostdin', '-v', 'error', '-i', result.path, '-f', 'null', '-'], new AbortController().signal);
      } finally { result.cleanup(); assert.equal(fs.existsSync(result.path), false); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Whisper integration passes model/language arguments, uses normalized audio, rejects empty speech and cleans temporary files', async () => {
  const dir = root();
  try {
    const input = path.join(dir, 'voice.wav'), executable = path.join(dir, 'fake-whisper');
    const record = path.join(dir, 'args.json');
    fs.writeFileSync(executable, `#!${process.execPath}\nconst fs=require('fs'),path=require('path'); const a=process.argv.slice(2); fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(a));const out=a[a.indexOf('--output_dir')+1]; fs.writeFileSync(path.join(out,'audio.srt'), ${JSON.stringify(fixtureSrt)});`, { mode: 0o700 });
    await runMediaProcess(mediaFfmpeg, ['-nostdin', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-y', input], new AbortController().signal);
    const runtime = { executable: async () => executable, modelDirectory: () => dir };
    const processor = createMediaProcessor(runtime);
    const job = { tool: 'script', options: { model: 'tiny', language: 'vi' } };
    const result = await processor(input, job, {}, new AbortController().signal, () => {});
    assert.match(fs.readFileSync(result.path, 'utf8'), /Xin chào/); result.cleanup();
    const args = JSON.parse(fs.readFileSync(record));
    assert.equal(args[args.indexOf('--language') + 1], 'vi'); assert.equal(args[args.indexOf('--model') + 1], 'tiny');
    assert.equal(args[args.indexOf('--output_format') + 1], 'srt'); assert.equal(args[args.indexOf('--device') + 1], 'cpu');
    assert.equal(fs.existsSync(path.dirname(args[0])), false); assert.equal(fs.existsSync(input), true);
    fs.writeFileSync(executable, `#!${process.execPath}\nconst fs=require('fs'),path=require('path'),a=process.argv.slice(2); fs.writeFileSync(path.join(a[a.indexOf('--output_dir')+1],'audio.srt'),'');`, { mode: 0o700 });
    await assert.rejects(processor(input, job, {}, new AbortController().signal, () => {}), /Không nhận dạng được/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('batch of 1000 uses a single worker, preserves duplicate filenames, retries failed files only, and exports converter-compatible text', async () => {
  const dir = root(); let service;
  try {
    const outputDir = path.join(dir, 'out'); fs.mkdirSync(outputDir);
    const input = file(dir); const paths = [input];
    for (let i = 1; i < 1000; i++) paths.push(file(dir, `voice-${i}.wav`));
    let active = 0, maximum = 0, failedOnce = false;
    const calls = new Map();
    service = new MediaJobs(path.join(dir, 'state'), readyRuntime, async (...args) => {
      const [input, job, item] = args; calls.set(input, (calls.get(input) || 0) + 1);
      active++; maximum = Math.max(maximum, active);
      try {
        if (item.name === 'voice-1.wav' && !failedOnce) { failedOnce = true; throw new Error('Temporary fixture failure'); }
        return await fakeProcessor(dir)(...args);
      } finally { active--; }
    });
    service.add({ tool: 'script', paths, directory: outputDir }); await wait(() => done(service));
    const job = service.snapshot().jobs[0]; assert.equal(job.items.length, 1000); assert.equal(maximum, 1); assert.equal(job.items.filter(i => i.status === 'completed').length, 999);
    service.control(job.id, 'retry'); await wait(() => done(service));
    assert.equal(calls.get(paths[1]), 2); assert.equal(calls.get(input), 1);
    const merged = await service.export(job.id, 'txt'); assert.match(merged.content, /^1\. voice\n\nNội dung/); assert.match(merged.content, /1000\. voice-999/);
    const zip = await service.export(job.id, 'zip'); assert.ok(fs.statSync(zip.output).size > 1000);
    const sub = path.join(dir, 'sub'); fs.mkdirSync(sub); const duplicate = file(sub);
    service.add({ tool: 'srt', paths: [input, duplicate], directory: outputDir }); await wait(() => done(service));
    const sameNames = service.snapshot().jobs[0].items; assert.notEqual(sameNames[0].output, sameNames[1].output); assert.match(sameNames[1].output, /voice \(2\)\.srt$/);
    assert.equal(fs.existsSync(input), true); assert.equal(fs.readdirSync(outputDir).some(name => name.endsWith('.part')), false);
    assert.throws(() => service.add({ tool: 'script', paths: Array(1001).fill(input), directory: outputDir }), /1.000/);
    assert.throws(() => service.add({ tool: 'extract', paths: [input], directory: outputDir }), /Định dạng/);
  } finally { service?.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pause aborts active work, preserves completed files, resumes the interrupted item and cancels pending items', async () => {
  const dir = root(); let service, block = true; const calls = [];
  try {
    const paths = [file(dir, 'one.wav'), file(dir, 'two.wav'), file(dir, 'three.wav')];
    service = new MediaJobs(path.join(dir, 'state'), readyRuntime, async (...args) => {
      const [input, _job, item, signal] = args; calls.push({ input, signal });
      if (item.name === 'two.wav' && block) await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
      return fakeProcessor(dir)(...args);
    });
    service.add({ tool: 'srt', paths, directory: dir }); const id = service.snapshot().jobs[0].id;
    await wait(() => calls.length === 2); service.control(id, 'pause');
    await wait(() => service.snapshot().jobs[0].items[1].status === 'pending');
    assert.equal(calls[1].signal.aborted, true); assert.equal(service.snapshot().jobs[0].items[0].status, 'completed');
    assert.equal(service.clear('srt').jobs.length, 1);
    block = false; service.control(id, 'resume'); await wait(() => done(service));
    assert.equal(calls.filter(call => call.input === paths[0]).length, 1); assert.equal(calls.length, 4);
    block = true; service.add({ tool: 'srt', paths: [paths[1], paths[2]], directory: dir });
    const cancelId = service.snapshot().jobs[0].id; await wait(() => calls.length === 5); service.control(cancelId, 'cancel');
    await wait(() => !service.snapshot().jobs[0].items.some(item => item.status === 'running'));
    assert.equal(service.snapshot().jobs[0].items.filter(item => item.status === 'cancelled').length, 2);
    block = false; service.control(cancelId, 'retry'); await wait(() => done(service));
    assert.equal(service.snapshot().jobs[0].items.filter(item => item.status === 'completed').length, 2);
  } finally { service?.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restart checkpoints preserve outputs and pause unfinished jobs; clearing history preserves originals/results', async () => {
  const dir = root(); let service, restored;
  try {
    const one = file(dir, 'one.wav'), two = file(dir, 'two.wav'); let calls = 0;
    service = new MediaJobs(path.join(dir, 'state'), readyRuntime, async (...args) => {
      calls++; if (calls === 2) await new Promise((_resolve, reject) => args[3].addEventListener('abort', () => reject(new Error('abort')), { once: true }));
      return fakeProcessor(dir)(...args);
    });
    service.add({ tool: 'script', paths: [one, two], directory: dir }); await wait(() => calls === 2); service.shutdown();
    await wait(() => service.snapshot().jobs[0].items[1].status === 'pending');
    restored = new MediaJobs(path.join(dir, 'state'), readyRuntime, fakeProcessor(dir));
    const job = restored.snapshot().jobs[0]; assert.equal(job.paused, true); assert.equal(job.items[0].status, 'completed'); assert.equal(job.items[1].status, 'pending');
    restored.control(job.id, 'resume'); await wait(() => done(restored));
    const outputs = restored.snapshot().jobs[0].items.map(i => i.output);
    assert.match(restored.preview(job.id, job.items[0].id).content, /Nội dung/);
    assert.equal(restored.clear('script').jobs.length, 0); outputs.forEach(output => assert.equal(fs.existsSync(output), true)); assert.equal(fs.existsSync(one), true);
    assert.equal(fs.readFileSync(path.join(dir, 'state/jobs.json'), 'utf8'), '[]');
  } finally { service?.shutdown(); restored?.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing runtime blocks transcription but extraction works, invalid options never enter queue, failed results are not exported', async () => {
  const dir = root(); let service;
  try {
    const runtime = { status: () => ({ ready: false, checking: false, installing: false, message: 'Cần cài Whisper' }), shutdown() {} };
    service = new MediaJobs(path.join(dir, 'state'), runtime, async () => { throw new Error('Video không có audio'); });
    const audio = file(dir), video = file(dir, 'silent.mp4');
    assert.throws(() => service.add({ tool: 'srt', paths: [audio], directory: dir }), /Cần cài Whisper/);
    assert.throws(() => service.add({ tool: 'extract', paths: [video], directory: dir, options: { format: '../../bad' } }), /không hợp lệ/);
    assert.equal(service.snapshot().jobs.length, 0);
    service.add({ tool: 'extract', paths: [video], directory: dir }); await wait(() => done(service));
    const job = service.snapshot().jobs[0]; assert.equal(job.items[0].status, 'failed'); assert.equal(job.items[0].output, undefined);
    await assert.rejects(service.export(job.id, 'zip'), /Chưa có/); assert.throws(() => service.preview(job.id, job.items[0].id), /Audio không có/);
  } finally { service?.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP media boundary rejects web origins; real upload API extracts audio and cleans uploads after errors/downloads', async () => {
  const dir = root(); let server, media;
  try {
    process.env.USER_DATA_PATH = dir;
    const { createServer } = require('../dist-backend/server');
    const { UPLOADS_DIR } = require('../dist-backend/config');
    const express = require('express');
    const { mountMediaRoutes } = require('../dist-backend/media-routes');
    media = new MediaJobs(path.join(dir, 'queue'), readyRuntime, fakeProcessor(dir));
    const internal = express(); internal.use(express.json()); mountMediaRoutes(internal, () => media);
    const app = createServer(); app.use('/fixture', internal);
    server = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject); });
    const url = 'http://127.0.0.1:' + server.address().port;
    let response = await fetch(url + '/fixture/api/v1/internal/media', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify({ action: 'list' }) });
    assert.equal(response.status, 403);
    response = await fetch(url + '/fixture/api/v1/internal/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', tool: 'script', paths: [file(dir)], directory: dir }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).jobs.length, 1);
    await wait(() => done(media));
    response = await fetch(url + '/api/v1/media/extract-audio', { method: 'POST' }); assert.equal(response.status, 400);
    const video = path.join(dir, 'demo.mp4');
    await runMediaProcess(mediaFfmpeg, ['-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=0.2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', video], new AbortController().signal);
    const send = async format => { const form = new FormData(); form.append('file', new Blob([fs.readFileSync(video)]), 'demo.mp4'); form.append('format', format); return fetch(url + '/api/v1/media/extract-audio', { method: 'POST', body: form }); };
    response = await send('../../unsafe'); assert.equal(response.status, 400); assert.match((await response.json()).message, /không hợp lệ/);
    response = await send('mp3'); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/mpeg'); assert.match(response.headers.get('content-disposition'), /demo.mp3/);
    const output = path.join(dir, 'download.mp3'); fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
    await runMediaProcess(mediaFfmpeg, ['-nostdin', '-v', 'error', '-i', output, '-f', 'null', '-'], new AbortController().signal);
    await wait(() => fs.readdirSync(UPLOADS_DIR).length === 0);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); media?.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
