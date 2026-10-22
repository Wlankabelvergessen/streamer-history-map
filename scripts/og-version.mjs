// Hängt an die Vorschaubild-Adresse (og:image) eine Versionsnummer aus dem Bildinhalt an, z. B. og.png?v=3f9a1c2b7d.
// Discord, WhatsApp & Co. speichern Vorschaubilder lange zwischen – mit neuer Adresse holen sie das aktuelle Bild.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const png = await readFile(new URL('../og.png', import.meta.url)).catch(() => null);
if (!png) process.exit(0);
const v = createHash('sha1').update(png).digest('hex').slice(0, 10);
const file = new URL('../index.html', import.meta.url);
const html = await readFile(file, 'utf8');
const out = html.replace(/(https:\/\/naschiis-adventure-map\.github\.io\/og\.png)(\?v=[0-9a-f]+)?"/g, `$1?v=${v}"`);
if (out !== html) { await writeFile(file, out); console.log('og:image Version: ' + v); }
