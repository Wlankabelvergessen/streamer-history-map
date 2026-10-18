// Holt neue Streams (VODs) und Clips von Twitch und pflegt sie in data/streams.json ein.
// Läuft per GitHub Actions. Braucht TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET als Umgebungsvariablen.
// Node 20+, keine Abhängigkeiten.
import { readFile, writeFile } from 'node:fs/promises';

const LOGIN = process.env.TWITCH_LOGIN || 'naschiitaschii';
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const CLIP_DAYS = Number(process.env.CLIP_DAYS || 30);   // wie weit zurück Clips geprüft werden
const MATCH_MIN = 25;                                     // Toleranz beim Abgleich von Startzeiten
const TZ = 'Europe/Berlin';
const DATA = new URL('../data/streams.json', import.meta.url);
const LOCS = new URL('../data/locations.json', import.meta.url);
const META = new URL('../data/meta.json', import.meta.url);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET fehlen (GitHub: Settings → Secrets and variables → Actions).');
  process.exit(1);
}

// ---------- Twitch API ----------
async function token() {
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!r.ok) throw new Error('Token-Abruf fehlgeschlagen: ' + r.status + ' ' + (await r.text()));
  return (await r.json()).access_token;
}
let TOKEN;
async function helix(path, params = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams(params); // akzeptiert Objekt oder URLSearchParams
    if (cursor) q.set('after', cursor);
    const r = await fetch('https://api.twitch.tv/helix/' + path + '?' + q, {
      headers: { 'Client-Id': CLIENT_ID, Authorization: 'Bearer ' + TOKEN },
    });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 2000)); page--; continue; }
    if (!r.ok) throw new Error(path + ': ' + r.status + ' ' + (await r.text()));
    const j = await r.json();
    out.push(...(j.data || []));
    cursor = j.pagination && j.pagination.cursor;
    if (!cursor || !(j.data || []).length) break;
  }
  return out;
}

// ---------- Helfer ----------
const pad = n => String(n).padStart(2, '0');
function berlin(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
// "Europe/Berlin"-Ortszeit -> UTC-Zeitpunkt (über Offset-Schätzung, auf Minuten genau)
function fromBerlin(date, time) {
  const guess = new Date(`${date}T${time}:00Z`);
  for (let i = 0; i < 2; i++) {
    const b = berlin(guess);
    const diff = (new Date(`${b.date}T${b.time}:00Z`) - new Date(`${date}T${time}:00Z`));
    guess.setTime(guess.getTime() - diff);
  }
  return guess;
}
function durationMin(s) { // "3h12m5s"
  const m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(s || '') || [];
  return Math.max(1, Math.round((+(m[1] || 0)) * 60 + (+(m[2] || 0)) + (+(m[3] || 0)) / 60));
}
function cleanTitle(t) {
  return String(t || '')
    .replace(/\s*[|│┃]?\s*!(subtember|subathon|rad|dc|insta|tt|yt|ig|clip)\b.*$/i, '')
    .replace(/\s*\|\s*10 SUBS.*$/i, '')
    .replace(/[\s|┃│]+$/, '')
    .trim();
}

// ---------- Ablauf ----------
const streams = JSON.parse(await readFile(DATA, 'utf8'));
const locs = JSON.parse(await readFile(LOCS, 'utf8'));
function locate(title) {
  const low = title.toLowerCase();
  const l = locs.find(x => low.includes(x.key));
  return l ? { name: l.name, lat: l.lat, lng: l.lng, approx: true } : undefined;
}
const startOf = r => fromBerlin(r.date, r.start || '00:00');

TOKEN = await token();
const [user] = await helix('users', { login: LOGIN });
if (!user) throw new Error('Kanal nicht gefunden: ' + LOGIN);

// 1) Streams aus den VODs (Twitch hält sie je nach Status 7–60 Tage vor)
const videos = await helix('videos', { user_id: user.id, type: 'archive', first: '100' });
let added = 0, updated = 0;
for (const v of videos) {
  const start = new Date(v.created_at);
  const dur = durationMin(v.duration);
  const title = cleanTitle(v.title);
  let r = streams.find(x => x.vodId === v.id)
       || streams.find(x => !x.vodId && Math.abs(startOf(x) - start) <= MATCH_MIN * 60000);
  if (r) {
    const before = JSON.stringify([r.vodId, r.durationMin, r.title]);
    r.vodId = v.id;
    // Dauer wächst, solange ein Stream noch läuft; nie kürzen, was TwitchTracker schon hatte
    if (r.source !== 'twitchtracker' || dur > r.durationMin) r.durationMin = Math.max(r.durationMin || 0, dur);
    if (r.source !== 'twitchtracker') { r.title = title; if (!r.location) { const l = locate(title); if (l) r.location = l; } }
    if (JSON.stringify([r.vodId, r.durationMin, r.title]) !== before) updated++;
  } else {
    const b = berlin(start);
    const n = {
      id: `tw-${v.id}`, vodId: v.id, source: 'twitch', title, date: b.date, start: b.time, durationMin: dur,
      desc: '', points: [], stops: [], clips: [],
    };
    const l = locate(title); if (l) n.location = l;
    streams.push(n); added++;
  }
}

// 2) Clips der letzten CLIP_DAYS Tage
const since = new Date(Date.now() - CLIP_DAYS * 86400000).toISOString();
const clips = await helix('clips', { broadcaster_id: user.id, started_at: since, ended_at: new Date().toISOString(), first: '100' });
const gameIds = [...new Set(clips.map(c => c.game_id).filter(Boolean))];
const games = {};
for (let i = 0; i < gameIds.length; i += 100) {
  const q = new URLSearchParams(); gameIds.slice(i, i + 100).forEach(id => q.append('id', id));
  for (const g of await helix('games', q)) games[g.id] = g.name;
}
const known = new Map();
for (const r of streams) for (const c of r.clips || []) known.set(c.url.split('/').pop(), { r, c });

let clipsNew = 0, clipsUpd = 0, clipsLost = 0;
for (const c of clips) {
  const slug = c.id;
  const k = known.get(slug);
  if (k) { if (k.c.views !== c.view_count) { k.c.views = c.view_count; clipsUpd++; } continue; }
  // Zuordnung: erst über das VOD, sonst über die Zeit (Stream, der lief), sonst letzter Stream davor (≤ 72 h)
  const t = new Date(c.created_at);
  let r = c.video_id && streams.find(x => x.vodId === c.video_id);
  if (!r) {
    const hits = streams.filter(x => { const s = startOf(x); return t >= s - 5 * 60000 && t <= +s + (x.durationMin + 10) * 60000; });
    r = hits.sort((a, b) => Math.abs(t - startOf(a)) - Math.abs(t - startOf(b)))[0];
  }
  if (!r) {
    const prev = streams.filter(x => startOf(x) <= t && t - startOf(x) <= 72 * 3600000);
    r = prev.sort((a, b) => startOf(b) - startOf(a))[0];
  }
  if (!r) { clipsLost++; continue; }
  r.clips = r.clips || [];
  r.clips.push({
    title: (c.title || 'Clip').trim(), url: `https://www.twitch.tv/${LOGIN}/clip/${slug}`,
    views: c.view_count, by: c.creator_name || '', dur: Math.round(c.duration || 0), game: games[c.game_id] || '',
  });
  clipsNew++;
}

for (const r of streams) (r.clips || []).sort((a, b) => b.views - a.views);
streams.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));

const json = JSON.stringify(streams, null, 0).replace(/\},\{"id"/g, '},\n{"id"');
const old = await readFile(DATA, 'utf8');
if (json !== old) {
  await writeFile(DATA, json);
  await writeFile(META, JSON.stringify({ updated: new Date().toISOString(), streams: streams.length }, null, 1) + '\n');
}
console.log(`VODs geprüft: ${videos.length} · neue Streams: ${added} · aktualisiert: ${updated}`);
console.log(`Clips geprüft: ${clips.length} · neu: ${clipsNew} · Aufrufe aktualisiert: ${clipsUpd} · ohne Stream: ${clipsLost}`);
