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
// Ortsnamen im Titel erkennen. Standard: ganzes Wort (auch "Kölner", "Berlins"),
// Einträge mit "prefix": true auch als Wortanfang (z. B. "dokom" für "DoKomi"/"Dokoomiii").
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchers = locs.map(l => ({ l, re: new RegExp('(^|[^\\p{L}])' + esc(l.key) + (l.prefix ? '' : '(er|s|n)?(?![\\p{L}])'), 'iu') }));
function locate(title) {
  const m = matchers.find(x => x.re.test(title));
  return m ? { name: m.l.name, lat: m.l.lat, lng: m.l.lng, approx: true } : undefined;
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

// Orte nachtragen: Streams ohne Ort bekommen einen, sobald ihr Titel zu einem Eintrag in data/locations.json passt.
// (Bestehende Orte werden nie überschrieben – so wirken neue Einträge in der Ortsliste auch rückwirkend.)
let located = 0;
for (const r of streams) if (!r.location) { const l = locate(r.title); if (l) { r.location = l; located++; } }

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
  const entry = {
    title: (c.title || 'Clip').trim(), url: `https://www.twitch.tv/${LOGIN}/clip/${slug}`,
    views: c.view_count, by: c.creator_name || '', dur: Math.round(c.duration || 0), game: games[c.game_id] || '',
  };
  r.clips.push(entry);
  known.set(slug, { r, c: entry });   // gleicher Clip kann in mehreren Seiten der Antwort auftauchen
  clipsNew++;
}

// Doppelte Clips entfernen (gleiche URL nur einmal behalten)
{
  const seen = new Set();
  for (const r of streams) r.clips = (r.clips || []).filter(c => !seen.has(c.url) && seen.add(c.url));
}

// 3) Alle gespeicherten Clips prüfen: gelöschte entfernen, Aufrufe aktualisieren
//    Twitch liefert bei /clips?id=… nur Clips zurück, die noch existieren (bis 100 IDs pro Anfrage).
const stored = [];
for (const r of streams) for (const c of r.clips || []) stored.push({ r, c, id: c.url.split('/').pop() });
const alive = new Map();
let checkFailed = false;
for (let i = 0; i < stored.length; i += 100) {
  const batch = stored.slice(i, i + 100);
  const q = new URLSearchParams(); batch.forEach(s => q.append('id', s.id));
  try {
    const res = await helix('clips', q);
    // Sicherheitsnetz: ein komplett leerer Block deutet eher auf einen API-Fehler hin als auf 100 gelöschte Clips
    if (!res.length && batch.length >= 20) { checkFailed = true; console.warn('Leere Antwort für einen Clip-Block, Prüfung übersprungen.'); continue; }
    for (const c of res) alive.set(c.id, c);
  } catch (e) { checkFailed = true; console.warn('Clip-Prüfung fehlgeschlagen:', e.message); }
}
let clipsDel = 0;
const missing = stored.filter(s => !alive.has(s.id));
if (!checkFailed && missing.length > stored.length * 0.25) {
  console.warn(`${missing.length} von ${stored.length} Clips fehlen – das sieht nach einem API-Problem aus, es wird nichts gelöscht.`);
} else if (!checkFailed) {
  const gone = new Set(missing.map(s => s.c));
  for (const r of streams) {
    const before = (r.clips || []).length;
    r.clips = (r.clips || []).filter(c => !gone.has(c));
    clipsDel += before - r.clips.length;
  }
  if (clipsDel) console.log('Gelöschte Clips entfernt:', missing.map(s => s.c.title).join(' | '));
}
for (const s of stored) {
  const a = alive.get(s.id);
  if (a && s.c.views !== a.view_count) { s.c.views = a.view_count; clipsUpd++; }
  if (a && a.title && s.c.title !== a.title.trim()) s.c.title = a.title.trim();   // umbenannte Clips
}

for (const r of streams) (r.clips || []).sort((a, b) => b.views - a.views);
streams.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));

const json = JSON.stringify(streams, null, 0).replace(/\},\{"id"/g, '},\n{"id"');
const old = await readFile(DATA, 'utf8');
let meta = {};
try { meta = JSON.parse(await readFile(META, 'utf8')); } catch {}
const profile = { profileImage: user.profile_image_url || meta.profileImage || null, displayName: user.display_name || meta.displayName || LOGIN };
const profileChanged = profile.profileImage !== meta.profileImage || profile.displayName !== meta.displayName;
if (json !== old) await writeFile(DATA, json);
if (json !== old || profileChanged) {
  await writeFile(META, JSON.stringify({ updated: json !== old ? new Date().toISOString() : meta.updated, streams: streams.length, ...profile }, null, 1) + '\n');
}
console.log(`VODs geprüft: ${videos.length} · neue Streams: ${added} · aktualisiert: ${updated} · Orte nachgetragen: ${located}`);
console.log(`Clips geprüft: ${clips.length} neue · ${stored.length} gespeicherte · neu: ${clipsNew} · gelöscht: ${clipsDel} · Aufrufe aktualisiert: ${clipsUpd} · ohne Stream: ${clipsLost}`);
