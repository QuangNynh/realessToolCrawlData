import fs from 'node:fs';
import path from 'node:path';

// Electron can read files inside app.asar, but child processes cannot execute them there.
export function executablePath(binaryPath: string): string {
  return binaryPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

export function ffmpegBinaryPath(context: { platform?: NodeJS.Platform; resourcesPath?: string; projectRoot?: string; packaged?: boolean } = {}): string {
  const platform = context.platform || process.platform;
  const resources = context.resourcesPath || (process as any).resourcesPath as string | undefined;
  const packaged = context.packaged ?? Boolean(resources && fs.existsSync(path.join(resources, 'app.asar')));
  if (platform === 'win32') {
    const projectRoot = context.projectRoot || path.resolve(__dirname, path.basename(__dirname) === 'dist-backend' ? '..' : '../..');
    const directory = packaged && resources ? path.join(resources, 'bin') : path.join(projectRoot, 'build', 'ffmpeg', 'win');
    const ffmpeg = path.join(directory, 'ffmpeg.exe');
    const ffprobe = path.join(directory, 'ffprobe.exe');
    if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) return ffmpeg;
    if (packaged || fs.existsSync(ffmpeg)) throw Object.assign(new Error('FFmpeg/ffprobe đi kèm bản Windows bị thiếu. Hãy cài lại bản cập nhật CrawlData.'), { code: 'ENOENT' });
  }
  return executablePath(require('@ffmpeg-installer/ffmpeg').path);
}
