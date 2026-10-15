import fs from 'node:fs';

// Universal binaries are valid when they contain an arm64 slice; child launches
// explicitly select it. Read headers without spawning file/lipo under Rosetta.
export function machOArchitectures(filename: string): number[] | undefined {
  const file = fs.openSync(filename, 'r');
  try {
    const header = Buffer.alloc(4096);
    const size = fs.readSync(file, header, 0, header.length, 0);
    if (size < 8) return;
    const magic = header.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf].includes(magic)) return [header.readUInt32BE(4)];
    if ([0xcefaedfe, 0xcffaedfe].includes(magic)) return [header.readUInt32LE(4)];
    if (![0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magic)) return;
    const read = (offset: number) => [0xbebafeca, 0xbfbafeca].includes(magic) ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
    const count = read(4), stride = [0xcafebabf, 0xbfbafeca].includes(magic) ? 32 : 20;
    if (!count || count > 64 || 8 + count * stride > size) throw new Error(`Mach-O header không hợp lệ: ${filename}`);
    return Array.from({ length: count }, (_, index) => read(8 + index * stride));
  } finally { fs.closeSync(file); }
}
export const MACHO_ARM64 = 0x0100000c;
export function assertNativeSpeechHost() {
  if (process.platform === 'darwin' && process.arch !== 'arm64') throw new Error('Nhận dạng trên Mac cần Electron/Node arm64 chạy native trên Apple Silicon. Hãy mở bản arm64, không chạy qua Rosetta.');
}
export function assertNativeSpeechBinary(filename: string) {
  if (process.platform !== 'darwin') return;
  assertNativeSpeechHost();
  if (!machOArchitectures(filename)?.includes(MACHO_ARM64)) throw new Error(`Binary không có kiến trúc arm64: ${filename}. Hãy cài bản native Apple Silicon.`);
}
export function nativeSpeechCommand(executable: string, args: string[]) {
  if (process.platform !== 'darwin') return { executable, args };
  assertNativeSpeechBinary(executable);
  return { executable: '/usr/bin/arch', args: ['-arm64', executable, ...args] };
}
