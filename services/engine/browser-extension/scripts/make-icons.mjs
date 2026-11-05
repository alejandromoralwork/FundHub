// Generates the extension icons (icons/icon{16,32,48,128}.png) — no image tools needed.
// Design: FundHub navy rounded square, a white "F", and a gold "capture" corner mark.
// Run: node services/engine/browser-extension/scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const NAVY = [11, 42, 74];
const GOLD = [242, 178, 51];
const WHITE = [255, 255, 255];

/** Colour of the logo at unit coordinates (x, y in 0..1), or null for transparent. */
function shade(x, y) {
  // Rounded square background (corner radius 0.2).
  const r = 0.2;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  // Gold capture mark: an "L" bracket in the bottom-right corner.
  if ((x > 0.62 && x < 0.84 && y > 0.74 && y < 0.82) || (x > 0.76 && x < 0.84 && y > 0.6 && y < 0.82)) return GOLD;
  // White "F".
  if (x > 0.24 && x < 0.37 && y > 0.18 && y < 0.82) return WHITE; // stem
  if (x > 0.24 && x < 0.72 && y > 0.18 && y < 0.31) return WHITE; // top bar
  if (x > 0.24 && x < 0.6 && y > 0.44 && y < 0.56) return WHITE; // middle bar
  return NAVY;
}

/** Renders one size with 4×4 supersampling (smooth edges). */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < S; sj++)
        for (let si = 0; si < S; si++) {
          const c = shade((i + (si + 0.5) / S) / size, (j + (sj + 0.5) / S) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      const o = (j * size + i) * 4;
      if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = (255 * a) / (S * S); }
    }
  return px;
}

/** Minimal PNG encoder (RGBA, 8-bit). */
function png(size, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const dir = fileURLToPath(new URL("../icons/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`${dir}icon${size}.png`, png(size, render(size)));
console.log("icons written to", dir);
