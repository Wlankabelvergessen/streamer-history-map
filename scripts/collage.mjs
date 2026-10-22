// Erzeugt collage.jpg: ein fertiges Mosaik aus den Vorschaubildern der beliebtesten Clips.
// Header, rechte Leiste und Fußleiste nutzen dieses eine Bild als Hintergrund –
// statt bis zu 160 Einzelbilder bei jedem Besuch von Twitch zu laden.
// Läuft einmal pro Woche (.github/workflows/collage.yml) oder von Hand. Benötigt "playwright" mit Chromium.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const W = 1800, H = 960, TW = 140;            // Bildgröße, Kachelbreite (wie bisher auf der Seite)
const TH = Math.round(TW * 0.5625);
const streams = JSON.parse(await readFile(new URL('../data/streams.json', import.meta.url), 'utf8'));

// Beliebteste Clips (jedes Vorschaubild nur einmal)
const seen = new Set(), pool = [];
for (const r of streams) for (const c of r.clips || []) {
  if (c.thumb && /^https:\/\//.test(c.thumb) && !seen.has(c.thumb)) { seen.add(c.thumb); pool.push({ u: c.thumb, v: c.views || 0 }); }
}
pool.sort((a, b) => b.v - a.v);
const top = pool.slice(0, 160);
if (!top.length) { console.log('Keine Clip-Bilder – Collage unverändert.'); process.exit(0); }

// Mischen mit der Kalenderwoche als Startwert: jede Woche eine andere Anordnung
const d = new Date(), week = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 6048e5);
let seed = 7 + d.getFullYear() * 53 + week;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = top.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [top[i], top[j]] = [top[j], top[i]]; }

const cols = Math.ceil(W / (TW - 6)) + 1, rows = Math.ceil(H / (TH - 6)) + 1;
let k = 0, tiles = '';
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
  const p = top[k++ % top.length], rot = (rnd() * 8 - 4).toFixed(1);
  tiles += `<img src="${p.u.replace(/"/g, '')}" style="transform:rotate(${rot}deg)" onerror="this.style.visibility='hidden'">`;
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;background:#24132a}
.c{position:absolute;inset:-12px;display:flex;flex-wrap:wrap;align-content:flex-start;justify-content:center}
img{flex:none;width:${TW}px;height:${TH}px;margin:-3px;object-fit:cover;border-radius:4px;border:2px solid #f5d6ea40;box-shadow:0 3px 8px #000a;background:#3b1d40}
</style></head><body><div class="c">${tiles}</div></body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--headless=new'] } : {});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
const ok = await page.evaluate(() => [...document.images].filter(i => i.complete && i.naturalWidth).length);
await page.screenshot({ path: new URL('../collage.jpg', import.meta.url).pathname, type: 'jpeg', quality: 52 });
await browser.close();
console.log(`collage.jpg erstellt: ${top.length} Clips, ${ok} Kacheln geladen`);
