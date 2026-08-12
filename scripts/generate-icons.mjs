/**
 * Generate the PWA icons as real PNGs.
 *
 * Written by hand rather than pulled from an image library: the icon is a flat
 * mark (brand background, white barbell), which is a few rectangles of pixel
 * data, and this keeps an image-processing dependency out of the build for one
 * asset that changes almost never.
 *
 * Run with: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BRAND = [0xf2, 0x54, 0x2d];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function png(size, pixelAt) {
  // Each scanline is prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y, size);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Brand field with a white barbell: a centre bar and two plates. */
function barbell(x, y, size) {
  const u = size / 32; // design grid
  const cx = x / u;
  const cy = y / u;

  const inBar = cy >= 15 && cy < 17 && cx >= 6 && cx < 26;
  const inPlateLeft = cx >= 6 && cx < 9 && cy >= 11 && cy < 21;
  const inPlateRight = cx >= 23 && cx < 26 && cy >= 11 && cy < 21;
  const inCollarLeft = cx >= 9 && cx < 11 && cy >= 13 && cy < 19;
  const inCollarRight = cx >= 21 && cx < 23 && cy >= 13 && cy < 19;

  return inBar || inPlateLeft || inPlateRight || inCollarLeft || inCollarRight ? WHITE : BRAND;
}

const outDir = join(process.cwd(), 'public');
mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), png(size, barbell));
  console.log(`public/icon-${size}.png`);
}

// Maskable icon: same mark, inset so platform-applied masks never clip it.
writeFileSync(
  join(outDir, 'icon-maskable-512.png'),
  png(512, (x, y, size) => {
    const inset = size * 0.1;
    const inner = size - inset * 2;
    if (x < inset || y < inset || x >= size - inset || y >= size - inset) return BRAND;
    return barbell(((x - inset) / inner) * size, ((y - inset) / inner) * size, size);
  }),
);
console.log('public/icon-maskable-512.png');

// Apple touch icon — iOS ignores SVG and wants a concrete PNG.
writeFileSync(join(outDir, 'apple-touch-icon.png'), png(180, barbell));
console.log('public/apple-touch-icon.png');
