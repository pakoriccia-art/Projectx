/**
 * PizzaMatrix — generatore icone PWA (issue #28)
 *
 *   node scripts/generate-icons.mjs
 *
 * Produce public/icons/{icon-192,icon-512,icon-512-maskable}.png.
 *
 * ⚠ Sono un SEGNAPOSTO on-brand, non un logo. Servono a rendere l'app
 * installabile — senza icone valide Chrome non mostra il prompt. Quando esiste
 * una grafica vera, sostituire i PNG e questo script diventa superfluo.
 *
 * Niente dipendenze: encoder PNG minimale su zlib (RGBA8, nessun filtro).
 * Il mark è un disco "brace" con alone, sui colori del design system:
 *   sfondo  #0f0b07   ember #ff8c32   ember-lo #ffd166
 *
 * Maskable: Android ritaglia fino a un cerchio di diametro 80%. Il disco della
 * variante maskable sta quindi dentro il 52% centrale, ben dentro la safe zone.
 */
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ─── PNG encoder minimale ────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type RGBA
  // 10-12: compression / filter / interlace = 0

  // scanline: 1 byte di filtro (0 = None) + size*4 byte
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 4 + 1);
    raw[off] = 0;
    rgba.copy(raw, off + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Disegno ─────────────────────────────────────────────────────────────────
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Antialiasing: copertura del pixel dato lo scarto dal bordo, in pixel. */
const cover = (d) => clamp01(0.5 - d);

const BG       = [15, 11, 7];
const EMBER    = [255, 140, 50];
const EMBER_LO = [255, 209, 102];

function draw(size, discRatio) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const rDisc = size * discRatio;
  const rGlow = rDisc * 1.9;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c;
      const dist = Math.hypot(dx, dy);

      // sfondo + alone caldo che sfuma verso l'esterno
      const glow = clamp01(1 - dist / rGlow) ** 2.2;
      let rgb = mix(BG, [58, 26, 10], glow * 0.85);

      // disco brace, con gradiente dall'alto (più chiaro) al basso
      const inDisc = cover(dist - rDisc);
      if (inDisc > 0) {
        const vert = clamp01((dy / rDisc + 1) / 2);      // 0 in alto, 1 in basso
        const disc = mix(EMBER_LO, EMBER, vert ** 0.85);
        rgb = mix(rgb, disc, inDisc);
      }

      // anello interno sottile: dà profondità senza dettaglio che sparisce a 48px
      const ring = cover(Math.abs(dist - rDisc * 0.66) - size * 0.012);
      if (ring > 0) rgb = mix(rgb, [26, 14, 6], ring * 0.30);

      const i = (y * size + x) * 4;
      px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, ratio] of [
  ['icon-192.png',          192, 0.30],
  ['icon-512.png',          512, 0.30],
  ['icon-512-maskable.png', 512, 0.26],   // dentro la safe zone dell'80%
]) {
  const file = join(OUT, name);
  writeFileSync(file, encodePNG(size, draw(size, ratio)));
  console.log(`  ${name}  ${size}x${size}`);
}
console.log('\nIcone generate in public/icons/');
