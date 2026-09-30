const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

// SVG biểu tượng YouTube chuẩn
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <g transform="translate(32, 32) scale(18.6666)">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" fill="#FF0000"/>
    <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFFFFF"/>
  </g>
</svg>`;

const tmpSvg = '/tmp/yt_official_icon.svg';
fs.writeFileSync(tmpSvg, svgContent);

// Render sang 1024x1024 base PNG
execSync(`qlmanage -t -s 1024 -o /tmp ${tmpSvg}`);
const basePng = '/tmp/yt_official_icon.svg.png';

// 1. Lưu icon.png 512x512
execSync(`sips -z 512 512 ${basePng} --out ${path.join(buildDir, 'icon.png')}`);

// 2. Tạo macOS icon.icns
const iconsetDir = '/tmp/yt_app_icon.iconset';
if (fs.existsSync(iconsetDir)) fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

const macSizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

for (const s of macSizes) {
  execSync(`sips -z ${s.size} ${s.size} ${basePng} --out ${path.join(iconsetDir, s.name)}`);
}
execSync(`iconutil -c icns ${iconsetDir} -o ${path.join(buildDir, 'icon.icns')}`);
fs.rmSync(iconsetDir, { recursive: true, force: true });

// 3. Tạo Windows icon.ico
const winSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = [];

for (const sz of winSizes) {
  const p = `/tmp/win_icon_${sz}.png`;
  execSync(`sips -z ${sz} ${sz} ${basePng} --out ${p}`);
  icoImages.push({ width: sz, height: sz, buffer: fs.readFileSync(p) });
  fs.unlinkSync(p);
}

function createIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const entries = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += img.buffer.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buffer)]);
}

fs.writeFileSync(path.join(buildDir, 'icon.ico'), createIco(icoImages));
console.log('Icons generated successfully in ' + buildDir);
