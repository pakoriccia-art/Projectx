// scripts/generate-icons.mjs
//
// Genera le icone PWA/Android di PizzaMatrix da un singolo SVG maskable-safe.
// Rasterizza via Chromium headless di Playwright (già presente nell'ambiente),
// così non serve alcun rasterizzatore nativo (sharp/resvg/ImageMagick).
//
// Output (committati):
//   public/icons/icon.svg      sorgente
//   public/icons/icon-192.png  192x192
//   public/icons/icon-512.png  512x512  (usato anche come maskable dal manifest)
//
// Uso:  node scripts/generate-icons.mjs
//
// I file vanno in public/icons/ perché Vite serve public/ come root statica:
// finiscono in dist/icons/ e risolvono sia per index.html (./icons/...) sia per
// il manifest PWA sia per includeAssets:['icons/*.png','icons/*.svg'].

import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');

// Palette dal design system (index.html / vite.config manifest)
const BG = '#0a0806'; // background_color / theme_color
const CRUST = '#ff8c32'; // accent-brand
const CHEESE = '#ffd166'; // accent-warning
const PEPP = '#d63031'; // state-collapsed
const BASIL = '#3ddc97'; // pm4-green

// SVG 512x512 — motivo confinato al central ~80% (safe zone maskable: >=51px
// di margine per lato). Fondo a tutto campo: Android applica la sua maschera.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" fill="${BG}"/>
  <!-- brace glow dietro la fetta -->
  <radialGradient id="ember" cx="50%" cy="42%" r="52%">
    <stop offset="0%" stop-color="#ff8c32" stop-opacity="0.20"/>
    <stop offset="100%" stop-color="#ff8c32" stop-opacity="0"/>
  </radialGradient>
  <rect x="0" y="0" width="512" height="512" fill="url(#ember)"/>
  <!-- corpo fetta (formaggio) -->
  <path d="M 112 176 Q 256 104 400 176 L 256 428 Z" fill="${CHEESE}"/>
  <!-- crosta (arco superiore) -->
  <path d="M 112 176 Q 256 104 400 176" fill="none" stroke="${CRUST}"
        stroke-width="36" stroke-linecap="round"/>
  <!-- pepperoni -->
  <circle cx="214" cy="228" r="21" fill="${PEPP}"/>
  <circle cx="304" cy="236" r="21" fill="${PEPP}"/>
  <circle cx="256" cy="312" r="19" fill="${PEPP}"/>
  <circle cx="228" cy="356" r="14" fill="${PEPP}"/>
  <!-- basilico -->
  <circle cx="300" cy="316" r="10" fill="${BASIL}"/>
  <circle cx="196" cy="292" r="9" fill="${BASIL}"/>
</svg>`;

// Legge width/height dall'header IHDR di un PNG (bytes 16..24).
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'icon.svg'), SVG, 'utf8');

  const browser = await chromium.launch({
    // build dell'ambiente (evita il mismatch headless_shell dell'npm ci)
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });

  try {
    for (const size of [192, 512]) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      const html = `<!doctype html><html><head><style>
        html,body{margin:0;padding:0;background:${BG}}
        svg{display:block;width:${size}px;height:${size}px}
      </style></head><body>${SVG}</body></html>`;
      await page.setContent(html, { waitUntil: 'networkidle' });
      const path = join(OUT_DIR, `icon-${size}.png`);
      await page.screenshot({
        path,
        clip: { x: 0, y: 0, width: size, height: size },
        omitBackground: false,
      });
      await page.close();

      const buf = await readFile(path);
      const dim = pngSize(buf);
      if (dim.width !== size || dim.height !== size) {
        throw new Error(`icon-${size}.png ha dimensioni ${dim.width}x${dim.height}, atteso ${size}x${size}`);
      }
      console.log(`✓ public/icons/icon-${size}.png  ${dim.width}x${dim.height}  ${buf.length} bytes`);
    }
    console.log('✓ public/icons/icon.svg');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
