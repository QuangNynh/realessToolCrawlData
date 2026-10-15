const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const JSZip = require('jszip');

// Fixed release + digest: never download a moving "latest" asset for an installer.
const asset = {
  version: 'N-127511-g01cf1a5396',
  url: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/autobuild-2026-10-13-20-20/ffmpeg-N-127511-g01cf1a5396-win64-gpl.zip',
  sha256: 'cc4c8f3e15b317be771bce75e4f7cba40ab89991cf1a6bfc4c9385e3ae50baec',
};
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = ['ffmpeg.exe', 'ffprobe.exe'];
async function download(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Download FFmpeg failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file, { flags: 'wx' }));
}
async function prepareWindowsFfmpeg(root = path.resolve(__dirname, '..'), source = asset, fetchArchive = download) {
  const base = path.join(root, 'build', 'ffmpeg');
  const directory = path.join(base, 'win');
  const archive = path.join(base, `win-${source.sha256}.zip`);
  fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(archive) || digest(archive) !== source.sha256) {
    const temporary = `${archive}.${process.pid}.download`;
    try {
      await fetchArchive(source.url, temporary);
      if (digest(temporary) !== source.sha256) throw new Error('FFmpeg archive checksum mismatch');
      fs.renameSync(temporary, archive);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'ffmpeg-build.json'), 'utf8'));
    if (manifest.archiveSha256 === source.sha256 && fs.existsSync(path.join(directory, 'FFmpeg-LICENSE.txt')) && files.every(name => digest(path.join(directory, name)) === manifest.files[name])) return directory;
  } catch { /* Recreate a missing, outdated or damaged bundle from the verified archive. */ }
  const temporary = fs.mkdtempSync(path.join(base, '.crawldata-ffmpeg-'));
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(archive));
    for (const entry of Object.values(zip.files)) {
      const original = entry.unsafeOriginalName || entry.name;
      if (original.includes('\\') || original.startsWith('/') || /^[a-z]:/i.test(original) || original.split('/').includes('..')) throw new Error('Unsafe FFmpeg ZIP entry');
      if (entry.dir) continue;
      const filename = path.posix.basename(entry.name);
      if (!files.includes(filename) && !/^LICENSE(?:\.txt)?$/i.test(filename)) continue;
      const target = path.join(temporary, /^LICENSE/i.test(filename) ? 'FFmpeg-LICENSE.txt' : filename);
      if (fs.existsSync(target)) throw new Error('Duplicate FFmpeg ZIP entry');
      const data = await entry.async('nodebuffer');
      if (files.includes(filename) && (data.length < 1024 || data[0] !== 0x4d || data[1] !== 0x5a)) throw new Error(`Invalid Windows executable: ${filename}`);
      fs.writeFileSync(target, data);
    }
    if (!files.every(name => fs.existsSync(path.join(temporary, name))) || !fs.existsSync(path.join(temporary, 'FFmpeg-LICENSE.txt'))) throw new Error('FFmpeg archive is missing binaries or license');
    fs.writeFileSync(path.join(temporary, 'ffmpeg-build.json'), JSON.stringify({ version: source.version, source: source.url, archiveSha256: source.sha256, files: Object.fromEntries(files.map(name => [name, digest(path.join(temporary, name))])) }, null, 2));
    fs.rmSync(directory, { recursive: true, force: true });
    fs.renameSync(temporary, directory);
    return directory;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { asset, prepareWindowsFfmpeg, digest };
if (require.main === module) prepareWindowsFfmpeg().then(directory => console.log(`Prepared verified static FFmpeg ${asset.version}: ${directory}`)).catch(error => { console.error(error); process.exitCode = 1; });
