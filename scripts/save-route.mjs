// Schreibt eine gezeichnete Route in data/routes.json.
// Aufruf durch den Workflow "Route speichern" mit der Umgebungsvariable PAYLOAD
// ({ id, route, by }), die das Google Apps Script nach Prüfung von Login und Rechten schickt.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = 'data/routes.json';
const fail = (m) => { console.error('Abgelehnt: ' + m); process.exit(1); };

let p;
try { p = JSON.parse(process.env.PAYLOAD || ''); } catch { fail('PAYLOAD ist kein JSON'); }
const { id, route, by } = p || {};
if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) fail('ungültige Stream-ID');
if (typeof by !== 'string' || !/^\w{1,40}$/.test(by)) fail('ungültiger Bearbeiter');

const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const pt = (a) => Array.isArray(a) && a.length === 2 && num(a[0], -90, 90) && num(a[1], -180, 180);
const r5 = (v) => Math.round(v * 1e5) / 1e5;

let clean = null;
if (route !== null) {
  if (!route || typeof route !== 'object') fail('Route fehlt');
  const points = route.points || [], stops = route.stops || [], clips = route.clips || {};
  if (!Array.isArray(points) || points.length > 3000 || !points.every(pt)) fail('Punkte ungültig');
  if (!Array.isArray(stops) || stops.length > 60) fail('Stationen ungültig');
  const cs = Object.entries(clips);
  if (cs.length > 600) fail('zu viele Clips');
  clean = {
    points: points.map(([a, b]) => [r5(a), r5(b)]),
    stops: stops.map((s) => {
      if (!s || !num(s.lat, -90, 90) || !num(s.lng, -180, 180)) fail('Station ungültig');
      return { lat: r5(s.lat), lng: r5(s.lng), name: String(s.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) };
    }),
    clips: Object.fromEntries(cs.map(([k, v]) => {
      if (!/^[\w-]{1,120}$/.test(k) || !pt(v)) fail('Clip-Position ungültig');
      return [k, [r5(v[0]), r5(v[1])]];
    })),
    by,
    at: new Date().toISOString(),
  };
}

let all = {};
try { all = JSON.parse(await readFile(FILE, 'utf8')); } catch {}
if (clean) all[id] = clean; else delete all[id];

// Eine Route pro Zeile: kleine, gut lesbare Änderungen im Verlauf
const keys = Object.keys(all).sort();
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(all[k])}`).join(',\n');
await writeFile(FILE, keys.length ? `{\n${body}\n}\n` : '{}\n');
console.log(`${clean ? 'Gespeichert' : 'Gelöscht'}: ${id} (von ${by}) · ${clean ? clean.points.length + ' Punkte, ' + clean.stops.length + ' Stationen, ' + Object.keys(clean.clips).length + ' Clips' : ''}`);
