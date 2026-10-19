/**
 * Naschii's Adventure Map – Taktgeber für die automatische Aktualisierung
 *
 * Stößt alle 15 Minuten den GitHub-Workflow "Streams und Clips aktualisieren" an.
 * Einrichtung (einmalig):
 *   1. Projekteinstellungen (Zahnrad) → Skripteigenschaften → Eigenschaft hinzufügen:
 *        GITHUB_TOKEN = dein Fine-grained Token (Actions: Read and write, nur dieses Repo)
 *   2. Oben die Funktion "einrichten" auswählen → Ausführen → Zugriff erlauben
 *   3. Im Protokoll muss stehen: "Antwort von GitHub: 204 (OK)"
 */

const REPO = 'Wlankabelvergessen/streamer-history-map';
const WORKFLOW = 'update.yml';

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
