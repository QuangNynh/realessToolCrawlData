// macOS smoke test: synthetic speech only; no user audio or remote AI account is used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { MediaJobs } = require('../dist-backend/media-jobs');
const { WhisperRuntime, mediaFfmpeg, runMediaProcess } = require('../dist-backend/media-runtime');
async function main() {
  if (process.platform !== 'darwin') throw new Error('Synthetic speech smoke test needs macOS say');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-media-live-'));
  const runtime = new WhisperRuntime(path.join(__dirname, '../data/media-runtime'));
  await runtime.refresh(); assert.equal(runtime.status().ready, true, runtime.status().message);
  const audio = path.join(dir, 'voice.aiff'), video = path.join(dir, 'video.mp4'), out = path.join(dir, 'outputs'); fs.mkdirSync(out);
  await runMediaProcess('/usr/bin/say', ['-v', 'Samantha', '-o', audio, 'Hello. This is a test of audio transcription. The audio should become subtitles and a readable script.'], new AbortController().signal, undefined, 30_000);
  await runMediaProcess(mediaFfmpeg, ['-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=15', '-i', audio, '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', video], new AbortController().signal);
  const media = new MediaJobs(path.join(dir, 'state'), runtime);
  try {
    for (const tool of ['srt', 'script', 'extract']) media.add({ tool, paths: [tool === 'extract' ? video : audio], directory: out, options: { model: 'base', language: 'en' } });
    for (let i = 0; i < 240; i++) {
      const jobs = media.snapshot().jobs;
      if (jobs.every(job => job.items.every(item => !['pending', 'running'].includes(item.status)))) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const jobs = media.snapshot().jobs;
    for (const job of jobs) {
      const item = job.items[0]; assert.equal(item.status, 'completed', item.error || item.stage);
      assert.ok(fs.existsSync(item.output));
      if (job.tool !== 'extract') {
        const result = media.preview(job.id, item.id).content;
        assert.match(result, /audio|transcription|subtitles/i);
        if (job.tool === 'srt') assert.match(result, /\d\d:\d\d:\d\d,\d{3} -->/);
        else assert.equal(result.includes('-->'), false);
        console.log(job.tool + ': ' + result.slice(0, 500));
      } else await runMediaProcess(mediaFfmpeg, ['-nostdin', '-v', 'error', '-i', item.output, '-f', 'null', '-'], new AbortController().signal);
    }
    console.log('PASS: real Whisper Base + FFmpeg through all three desktop queue operations.'); console.log('Artifacts:', dir);
  } finally { media.shutdown(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
