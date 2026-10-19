/**
 * Naschii's Adventure Map – Taktgeber für die automatische Aktualisierung
 *
 * 1) Stößt alle 15 Minuten den GitHub-Workflow "Streams und Clips aktualisieren" an.
 * 2) Nimmt gezeichnete Routen von der Webseite entgegen (doPost), prüft Twitch-Login und
 *    Bearbeitungsrecht (naschiitaschii, EDITORS, Mods des Kanals) und stößt "Route speichern" an.
 *
 * Einrichtung Taktgeber (einmalig):
 *   1. Projekteinstellungen (Zahnrad) → Skripteigenschaften → Eigenschaft hinzufügen:
 *        GITHUB_TOKEN = dein Fine-grained Token (Actions: Read and write, nur dieses Repo)
 *   2. Oben die Funktion "einrichten" auswählen → Ausführen → Zugriff erlauben
 *   3. Im Protokoll muss stehen: "Antwort von GitHub: 204 (OK)"
 *
 * Einrichtung Routen-Speichern (einmalig):
 *   Bereitstellen → Neue Bereitstellung → Typ "Web-App"
 *     Ausführen als: Ich · Zugriff: Jeder → Bereitstellen → Web-App-URL kopieren
 *   Nach jeder Code-Änderung: Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) → Version "Neue Version".
 */

const REPO = 'Wlankabelvergessen/streamer-history-map';
const WORKFLOW = 'update.yml';
const SAVE_WORKFLOW = 'save-route.yml';
const CHANNEL = 'naschiitaschii';
const TWITCH_CLIENT_ID = '37d0tdpcaxwlyeyojbsh1pwwynr58w';   // öffentlich
const EDITORS = ['naschiitaschii', 'wlankabelvergessen'];    // dürfen immer; Mods von CHANNEL zusätzlich

/** Wird alle 15 Minuten automatisch ausgeführt. */
function anstossen() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Skripteigenschaft GITHUB_TOKEN fehlt (Projekteinstellungen → Skripteigenschaften).');
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  console.log('Antwort von GitHub: ' + code + (code === 204 ? ' (OK)' : ' – ' + res.getContentText()));
  if (code !== 204) throw new Error('GitHub hat den Lauf abgelehnt (' + code + '). Token prüfen: Ablaufdatum, Repo, Recht "Actions: Read and write".');
}

/** Einmal von Hand ausführen: legt den 15-Minuten-Zeitplan an und testet sofort. */
function einrichten() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'anstossen')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('anstossen').timeBased().everyMinutes(15).create();
  console.log('Zeitplan angelegt: alle 15 Minuten.');
  anstossen();
}

/** Falls du den Taktgeber einmal stoppen willst. */
function stoppen() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Zeitplan entfernt.');
}

/* ---------------- Routen speichern ---------------- */

function antwort(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Webseite schickt { token, id, route }. Antwort: { ok, at } oder { ok:false, error, code }. */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = String(body.token || '');
    if (!token) return antwort({ ok: false, code: 'token', error: 'Nicht angemeldet.' });

    // 1. Twitch-Token prüfen: gültig und für unsere App ausgestellt?
    const v = UrlFetchApp.fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + token }, muteHttpExceptions: true });
    if (v.getResponseCode() !== 200) return antwort({ ok: false, code: 'token', error: 'Twitch-Anmeldung abgelaufen.' });
    const who = JSON.parse(v.getContentText());
    if (who.client_id !== TWITCH_CLIENT_ID) return antwort({ ok: false, code: 'token', error: 'Fremder Twitch-Token.' });
    const login = String(who.login || '').toLowerCase();

    // 2. Darf diese Person bearbeiten?
    if (!(login === CHANNEL || EDITORS.indexOf(login) >= 0 || istMod(who.user_id, token))) {
      return antwort({ ok: false, code: 'forbidden', error: 'Nur naschiitaschii, ihre Mods und eingetragene Bearbeiter dürfen Routen speichern.' });
    }

    // 3. Grobe Prüfung der Daten (die genaue Prüfung macht scripts/save-route.mjs)
    const id = String(body.id || '');
    if (!/^[\w-]{1,80}$/.test(id)) return antwort({ ok: false, error: 'Ungültiger Stream.' });
    const route = body.route === null ? null : body.route;
    const payload = JSON.stringify({ id: id, route: route, by: login });
    if (payload.length > 60000) return antwort({ ok: false, error: 'Route zu groß. Bitte gröber zeichnen.' });

    // 4. GitHub-Workflow "Route speichern" anstoßen
    const ghToken = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
    const res = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${SAVE_WORKFLOW}/dispatches`, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ghToken, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      payload: JSON.stringify({ ref: 'main', inputs: { payload: payload } }),
    });
    if (res.getResponseCode() !== 204) {
      console.log('GitHub: ' + res.getResponseCode() + ' ' + res.getContentText());
      return antwort({ ok: false, error: 'GitHub hat das Speichern abgelehnt (' + res.getResponseCode() + ').' });
    }
    console.log('Route ' + id + ' gespeichert von ' + login);
    return antwort({ ok: true, at: new Date().toISOString(), by: login });
  } catch (err) {
    console.log(err);
    return antwort({ ok: false, error: 'Interner Fehler: ' + err });
  }
}

/** Ist user_id Moderator bei CHANNEL? (Token braucht den Scope user:read:moderated_channels) */
function istMod(userId, token) {
  let cursor = '';
  for (let i = 0; i < 10; i++) {
    const res = UrlFetchApp.fetch('https://api.twitch.tv/helix/moderation/channels?first=100&user_id=' + encodeURIComponent(userId) + (cursor ? '&after=' + encodeURIComponent(cursor) : ''), {
      headers: { Authorization: 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID }, muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return false;
    const j = JSON.parse(res.getContentText());
    if ((j.data || []).some(c => String(c.broadcaster_login).toLowerCase() === CHANNEL)) return true;
    cursor = j.pagination && j.pagination.cursor;
    if (!cursor) return false;
  }
  return false;
}

/** Zum Testen im Editor: zeigt, dass die Web-App erreichbar ist. */
function doGet() {
  return antwort({ ok: true, info: 'Adventure Map Speicher-Dienst läuft.' });
}
