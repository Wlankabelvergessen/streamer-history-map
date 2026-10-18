# Naschii’s Adventure Map

Karte der Streams von [naschiitaschii](https://www.twitch.tv/naschiitaschii): Datum, Dauer, Zuschauerzahlen, ungefähre Orte (aus den Streamtiteln) und zugeordnete Twitch-Clips.

- Streamliste bis 18.10.2026: TwitchTracker · seitdem und Clips: Twitch-API
- Karte: © OpenStreetMap-Mitwirkende, Ländergrenzen: Natural Earth
- Eine einzige Datei: `index.html`, läuft auf GitHub Pages ohne Build.

## Automatische Aktualisierung

`.github/workflows/update.yml` läuft 2× täglich und führt `scripts/update.mjs` aus:

- holt neue Streams (VODs) und Clips von naschiitaschii über die offizielle Twitch-API,
- prüft alle gespeicherten Clips: auf Twitch gelöschte werden entfernt, Aufrufe und Titel aktualisiert,
- ordnet Clips über ihr VOD bzw. die Uhrzeit dem richtigen Stream zu,
- setzt bei Ortsnamen im Titel (siehe `data/locations.json`) einen ungefähren Ort,
- speichert alles in `data/streams.json`; die Seite lädt diese Datei beim Öffnen.

Benötigte Repository-Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (App von dev.twitch.tv/console).
Manuell starten: *Actions → Streams und Clips aktualisieren → Run workflow*.

Neue Orte: Eintrag in `data/locations.json` ergänzen (`key` = Wort im Titel, kleingeschrieben).
