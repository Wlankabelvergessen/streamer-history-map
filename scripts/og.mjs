// Erzeugt og.png (1200×630): Vorschaubild, das beim Teilen des Links (Discord, WhatsApp, X …) erscheint.
// Läuft in der GitHub Action nach dem Daten-Update. Benötigt das npm-Paket "playwright" mit Chromium.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const streams = JSON.parse(await readFile(new URL('../data/streams.json', import.meta.url), 'utf8'));
let meta = {};
try { meta = JSON.parse(await readFile(new URL('../data/meta.json', import.meta.url), 'utf8')); } catch {}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n.toLocaleString('de-DE', { maximumFractionDigits: 0 });
const hours = streams.reduce((s, r) => s + (r.durationMin || 0), 0) / 60;
const clips = streams.reduce((s, r) => s + (r.clips || []).length, 0);
const cityCount = {};
for (const r of streams) if (r.location) { const c = r.location.name.split(',')[0].replace(/\s*\(.*\)$/, ''); cityCount[c] = (cityCount[c] || 0) + 1; }
const cities = Object.entries(cityCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
const last = streams[0];
const lastDate = last ? new Date(last.date + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
const lastTitle = last ? last.title.replace(/\p{Extended_Pictographic}|️/gu, '').trim() : '';

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Rubik+Bubbles&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@500;600&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:'IBM Plex Sans',sans-serif;color:#f4ebf3;
  background:radial-gradient(120% 140% at 50% 0%,#5a2a5e 0%,#3b1d40 45%,#1c0f21 100%);position:relative}
.stars{position:absolute;inset:0;background:
 radial-gradient(2px 2px at 8% 18%,#fff9 50%,transparent 51%),radial-gradient(2px 2px at 22% 40%,#fff8 50%,transparent 51%),
 radial-gradient(2px 2px at 36% 12%,#fffa 50%,transparent 51%),radial-gradient(1.5px 1.5px at 64% 26%,#fff9 50%,transparent 51%),
 radial-gradient(2px 2px at 78% 10%,#fffa 50%,transparent 51%),radial-gradient(1.5px 1.5px at 90% 36%,#fff8 50%,transparent 51%)}
.clouds{position:absolute;left:-60px;right:-60px;bottom:-10px;height:230px;background:
 radial-gradient(closest-side,#e9c1de 98%,transparent) -2% 100%/26% 95% no-repeat,
 radial-gradient(closest-side,#e9c1de 98%,transparent) 18% 120%/24% 80% no-repeat,
 radial-gradient(closest-side,#c98fbd 98%,transparent) 40% 125%/26% 70% no-repeat,
 radial-gradient(closest-side,#e9c1de 98%,transparent) 66% 130%/22% 70% no-repeat,
 radial-gradient(closest-side,#e9c1de 98%,transparent) 88% 105%/28% 95% no-repeat,
 radial-gradient(closest-side,#c98fbd 98%,transparent) 104% 95%/20% 80% no-repeat;opacity:.95}
.wrap{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:44px;gap:14px}
.av{width:118px;height:118px;border-radius:50%;background:#c9579f center/cover;box-shadow:0 0 0 6px #f5a9d6,0 10px 30px #0009}
h1{font:400 76px/1 'Rubik Bubbles',sans-serif;color:#f5a9d6;-webkit-text-stroke:3px #7d2a63;text-shadow:0 6px 0 #7d2a63,0 12px 30px #000a}
.sub{font:600 18px 'IBM Plex Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#f6dcee}
.stats{display:flex;gap:14px;margin-top:6px}
.stats div{display:flex;align-items:baseline;gap:10px;padding:10px 22px;border-radius:999px;background:#1c0f21dd;border:2px solid #f5a9d666}
.stats b{font:600 30px 'IBM Plex Mono',monospace;color:#fff}
.stats span{font:600 15px 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#f1cfe6}
.foot{position:absolute;left:0;right:0;bottom:26px;display:flex;flex-direction:column;align-items:center;gap:8px;color:#3b1d40}
.cities{font:600 20px 'IBM Plex Sans',sans-serif}
.last{font:500 16px 'IBM Plex Mono',monospace;max-width:1000px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<div class="stars"></div><div class="clouds"></div>
<div class="wrap">
  <div class="av" style="background-image:url('${esc(meta.profileImage || '')}')"></div>
  <h1>Naschii’s Adventure Map</h1>
  <div class="sub">twitch.tv/naschiitaschii · IRL-Streams &amp; Clips</div>
  <div class="stats"><div><b>${fmt(streams.length)}</b><span>Streams</span></div><div><b>${fmt(hours)}</b><span>Stunden</span></div><div><b>${fmt(clips)}</b><span>Clips</span></div></div>
</div>
<div class="foot">
  ${cities.length ? `<div class="cities">📍 ${cities.map(esc).join(' · ')}</div>` : ''}
  ${last ? `<div class="last">Zuletzt: ${esc(lastTitle)} · ${esc(lastDate)}</div>` : ''}
</div>
</body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../og.png', import.meta.url).pathname });
await browser.close();
console.log('og.png erstellt');
