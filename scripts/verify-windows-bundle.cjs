const fs = require('node:fs');
const path = require('node:path');
const { asset, digest } = require('./prepare-ffmpeg.cjs');

function verifyWindowsBundle(directory = path.resolve(__dirname, '../release/win-unpacked')) {
  const bin = path.join(directory, 'resources', 'bin');
  const manifest = JSON.parse(fs.readFileSync(path.join(bin, 'ffmpeg-build.json'), 'utf8'));
  if (manifest.archiveSha256 !== asset.sha256) throw new Error('Installer does not contain the pinned FFmpeg build');
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    if (digest(path.join(bin, name)) !== manifest.files[name]) throw new Error(`Packaged binary is missing/corrupt: ${name}`);
  }
  if (!fs.existsSync(path.join(bin, 'FFmpeg-LICENSE.txt'))) throw new Error('FFmpeg license is missing');
  if (!fs.existsSync(path.join(bin, 'yt-dlp.exe'))) throw new Error('Standalone yt-dlp is missing');
  console.log(`Verified packaged static FFmpeg/ffprobe ${manifest.version}`);
}

module.exports = { verifyWindowsBundle };
if (require.main === module) {
  try { verifyWindowsBundle(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
