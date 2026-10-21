# Naschii’s Adventure Map

**Seite:** https://naschiis-adventure-map.github.io

Karte der Streams von [naschiitaschii](https://www.twitch.tv/naschiitaschii): Streams ab 01.01.2025 mit Datum, Dauer, ungefähren Orten (aus den Streamtiteln) und zugeordnete Twitch-Clips.

- Streams ab 01.01.2025 (ältere werden nicht übernommen) · Streamliste bis 18.10.2026: TwitchTracker · seitdem und Clips: Twitch-API · keine Zuschauer- oder Followerzahlen
- Karte: © OpenStreetMap-Mitwirkende, Ländergrenzen: Natural Earth
- Eine einzige Datei: `index.html`, läuft auf GitHub Pages ohne Build.

## Automatische Aktualisierung

`.github/workflows/update.yml` läuft alle 15 Minuten und führt `scripts/update.mjs` aus:

- erfasst laufende Streams direkt (auch ohne öffentliches VOD),

- holt neue Streams (VODs) und Clips von naschiitaschii über die offizielle Twitch-API,
- prüft alle gespeicherten Clips: auf Twitch gelöschte werden entfernt, Aufrufe und Titel aktualisiert,
- ordnet Clips über ihr VOD bzw. die Uhrzeit dem richtigen Stream zu,
- setzt bei Ortsnamen im Titel (siehe `data/locations.json`) einen ungefähren Ort,
- speichert alles in `data/streams.json`; die Seite lädt diese Datei beim Öffnen.

Benötigte Repository-Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (App von dev.twitch.tv/console).
Manuell starten: *Actions → Streams und Clips aktualisieren → Run workflow*.

Orte: `data/locations.json` enthält ~100 Städte/Orte. Neuer Eintrag = `key` (Wort im Titel, kleingeschrieben), `name`, `lat`, `lng`; `"prefix": true` erlaubt auch Wortanfänge. Neue Einträge wirken beim nächsten Lauf auch rückwirkend.

## Zuverlässiger Takt mit cron-job.org (optional)

GitHub startet geplante Läufe nicht garantiert. Ein externer Dienst kann den Lauf zusätzlich anstoßen:

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → *Generate new token*
   - Repository access: *Only select repositories* → `naschiis-adventure-map.github.io`
   - Permissions → Repository → **Actions: Read and write**
2. Auf [cron-job.org](https://cron-job.org) einen Job anlegen:
   - URL: `https://api.github.com/repos/naschiis-adventure-map/naschiis-adventure-map.github.io/actions/workflows/update.yml/dispatches`
   - Zeitplan: alle 15 Minuten · Methode: **POST**
   - Header: `Authorization: Bearer <TOKEN>` · `Accept: application/vnd.github+json` · `Content-Type: application/json`
   - Body: `{"ref":"main"}`
3. Testlauf in cron-job.org: Antwort **204** = erfolgreich.

### Alternative: Google Apps Script

Code: `scripts/google-apps-script.gs` – auf script.google.com in ein neues Projekt einfügen, `GITHUB_TOKEN` als Skripteigenschaft anlegen, einmal `einrichten` ausführen.
