import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { firefox, type Browser } from 'playwright';

interface Watch {
  id: number;
  name: string;
  group_name: string;
  url: string;
  selector: string;
  interval_seconds: number | null;
  value: string | null;
  error: string | null;
  last_checked: string | null;
}

interface WatchInput {
  name: string;
  group: string;
  url: string;
  selector: string;
  interval: number | null;
}

type RequestBody = Record<string, unknown>;

const APP_VERSION = '2.0.0';
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || './data';
const DEFAULT_INTERVAL = Number(process.env.DEFAULT_INTERVAL_SECONDS) || 3600;
const MIN_INTERVAL = 5;
const MAX_CONCURRENT_CHECKS = 3;
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');
let browser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (browser) return Promise.resolve(browser);
  if (!browserLaunch) {
    browserLaunch = firefox.launch({ headless: true })
      .then(instance => {
        browser = instance;
        return instance;
      })
      .catch(error => {
        browserLaunch = null;
        throw new Error(`Impossible de démarrer Firefox : ${errorMessage(error)}`);
      });
  }
  return browserLaunch;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const browserTempDir = path.resolve(DATA_DIR, '.tmp');
fs.mkdirSync(browserTempDir, { recursive: true });
if (process.platform !== 'win32') process.env.TMPDIR = browserTempDir;
const db = new DatabaseSync(path.join(DATA_DIR, 'watches.db'));
db.exec(`CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  selector TEXT NOT NULL,
  interval_seconds INTEGER,
  value TEXT,
  error TEXT,
  last_checked TEXT
)`);
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

const getSetting = (key: string): string => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
};

const setSetting = (key: string, value: string): void => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
};

function toWatch(row: Record<string, SQLOutputValue>): Watch {
  const stringValue = (column: string): string => {
    const value = row[column];
    if (typeof value !== 'string') throw new Error(`Valeur SQLite invalide : ${column}`);
    return value;
  };
  const nullableString = (column: string): string | null => {
    const value = row[column];
    if (value !== null && typeof value !== 'string') throw new Error(`Valeur SQLite invalide : ${column}`);
    return value;
  };
  const integer = (column: string): number => {
    const value = row[column];
    if ((typeof value !== 'number' && typeof value !== 'bigint') || !Number.isSafeInteger(Number(value))) {
      throw new Error(`Valeur SQLite invalide : ${column}`);
    }
    return Number(value);
  };
  const interval = row.interval_seconds;
  if (interval !== null && interval !== undefined &&
      ((typeof interval !== 'number' && typeof interval !== 'bigint') || !Number.isSafeInteger(Number(interval)))) {
    throw new Error('Valeur SQLite invalide : interval_seconds');
  }
  return {
    id: integer('id'),
    name: stringValue('name'),
    group_name: stringValue('group_name'),
    url: stringValue('url'),
    selector: stringValue('selector'),
    interval_seconds: interval == null ? null : Number(interval),
    value: nullableString('value'),
    error: nullableString('error'),
    last_checked: nullableString('last_checked'),
  };
}

async function pushover(title: string, message: string, url?: string): Promise<void> {
  const token = getSetting('pushover_token');
  const user = getSetting('pushover_user');
  if (!token || !user) throw new Error('Clés Pushover non configurées');
  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    body: new URLSearchParams({ token, user, title, message, ...(url && { url }) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { errors?: string[] };
    throw new Error(`Pushover : ${body.errors?.join(', ') || `HTTP ${res.status}`}`);
  }
}

const getWatch = (id: number): Watch | undefined => {
  const row = db.prepare('SELECT * FROM watches WHERE id = ?').get(id);
  return row ? toWatch(row) : undefined;
};

const requireWatch = (id: number): Watch => {
  const watch = getWatch(id);
  if (!watch) throw new Error('Surveillance introuvable');
  return watch;
};

function validate(body: RequestBody): WatchInput {
  const name = body.name ?? '';
  const groupName = body.group_name ?? '';
  const url = body.url;
  const selector = body.selector;
  const intervalSeconds = body.interval_seconds;
  if (typeof url !== 'string') throw new Error('URL invalide');
  if (typeof selector !== 'string' || !selector.trim()) throw new Error('Sélecteur CSS requis');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('URL invalide');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Seules les URL http(s) sont acceptées');
  const interval = intervalSeconds === '' || intervalSeconds == null ? null : Number(intervalSeconds);
  if (interval !== null && !(Number.isInteger(interval) && interval >= MIN_INTERVAL)) {
    throw new Error(`Intervalle invalide (entier ≥ ${MIN_INTERVAL} s)`);
  }
  return {
    name: String(name).trim(),
    group: String(groupName).trim(),
    url: parsedUrl.href,
    selector: selector.trim(),
    interval,
  };
}

async function check(watch: Watch): Promise<Watch | undefined> {
  let value: string | null = null;
  let error: string | null = null;
  let context: Awaited<ReturnType<Browser['newContext']>> | undefined;
  try {
    const url = new URL(watch.url);
    const proxyServer = url.protocol === 'https:'
      ? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
      : process.env.HTTP_PROXY ?? process.env.http_proxy ?? process.env.HTTPS_PROXY ?? process.env.https_proxy;
    const proxyBypass = process.env.NO_PROXY ?? process.env.no_proxy;
    const browserInstance = await getBrowser();
    context = await browserInstance.newContext({
      proxy: proxyServer ? { server: proxyServer, ...(proxyBypass && { bypass: proxyBypass }) } : undefined,
    });
    const page = await context.newPage();
    const response = await page.goto(watch.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
    const element = page.locator(watch.selector).first();
    try {
      await element.waitFor({ state: 'attached', timeout: 5000 });
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') throw new Error('Élément introuvable');
      throw e;
    }
    const text = await element.textContent();
    if (text === null) throw new Error('Élément introuvable');
    value = text.replace(/\s+/g, ' ').trim();
  } catch (e) {
    error = errorMessage(e);
  } finally {
    await context?.close();
  }
  db.prepare('UPDATE watches SET value = COALESCE(?, value), error = ?, last_checked = ? WHERE id = ?')
    .run(value, error, new Date().toISOString(), watch.id);
  if (value !== null && watch.value !== null && value !== watch.value && getSetting('pushover_enabled') === '1') {
    pushover(`Changement : ${watch.name || watch.url}`, `${watch.value} → ${value}`, watch.url)
      .catch(e => console.error(errorMessage(e)));
  }
  return getWatch(watch.id);
}

const running = new Set<number>();
async function tick(): Promise<void> {
  const now = Date.now();
  const watches = db.prepare('SELECT * FROM watches').all().map(toWatch);
  for (const watch of watches) {
    const interval = (watch.interval_seconds ?? DEFAULT_INTERVAL) * 1000;
    if (running.has(watch.id) || (watch.last_checked && now - Date.parse(watch.last_checked) < interval)) continue;
    if (running.size >= MAX_CONCURRENT_CHECKS) break;
    running.add(watch.id);
    check(watch).finally(() => running.delete(watch.id));
  }
}
setInterval(() => {
  tick().catch(e => console.error(errorMessage(e)));
}, 1000);
tick().catch(e => console.error(errorMessage(e)));

const send = (res: http.ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(status === 204 ? undefined : JSON.stringify(data));
};

async function readBody(req: http.IncomingMessage): Promise<RequestBody> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new Error('Corps trop volumineux');
  }
  const body: unknown = JSON.parse(raw || '{}');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Corps de requête invalide');
  }
  return body as RequestBody;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        version: APP_VERSION,
        default_interval_seconds: DEFAULT_INTERVAL,
        min_interval_seconds: MIN_INTERVAL,
      });
    }

    // Les clés ne sont jamais renvoyées au navigateur, seulement leur présence.
    if (pathname === '/api/settings') {
      if (req.method === 'PUT') {
        const { pushover_token, pushover_user, pushover_enabled } = await readBody(req);
        if (pushover_token) setSetting('pushover_token', String(pushover_token).trim());
        if (pushover_user) setSetting('pushover_user', String(pushover_user).trim());
        setSetting('pushover_enabled', pushover_enabled ? '1' : '0');
      } else if (req.method !== 'GET') {
        return send(res, 405, { error: 'Méthode non autorisée' });
      }
      return send(res, 200, {
        pushover_token_set: !!getSetting('pushover_token'),
        pushover_user_set: !!getSetting('pushover_user'),
        pushover_enabled: getSetting('pushover_enabled') === '1',
      });
    }
    if (pathname === '/api/settings/test' && req.method === 'POST') {
      await pushover('Web Watcher', 'Notification de test ✔');
      return send(res, 204, null);
    }

    if (pathname === '/api/watches') {
      if (req.method === 'GET') {
        return send(res, 200, db.prepare("SELECT * FROM watches ORDER BY group_name = '', group_name, id").all());
      }
      if (req.method === 'POST') {
        const watch = validate(await readBody(req));
        const { lastInsertRowid } = db.prepare(
          'INSERT INTO watches (name, group_name, url, selector, interval_seconds) VALUES (?, ?, ?, ?, ?)',
        ).run(watch.name, watch.group, watch.url, watch.selector, watch.interval);
        return send(res, 201, await check(requireWatch(Number(lastInsertRowid))));
      }
    }

    const match = pathname.match(/^\/api\/watches\/(\d+)(\/check)?$/);
    if (match) {
      const watch = getWatch(Number(match[1]));
      if (!watch) return send(res, 404, { error: 'Introuvable' });
      if (match[2] && req.method === 'POST') return send(res, 200, await check(watch));
      if (!match[2] && req.method === 'PUT') {
        const updated = validate(await readBody(req));
        const target = updated.url !== watch.url || updated.selector !== watch.selector;
        db.prepare(`UPDATE watches SET name = ?, group_name = ?, url = ?, selector = ?, interval_seconds = ?${target ? ', value = NULL' : ''} WHERE id = ?`)
          .run(updated.name, updated.group, updated.url, updated.selector, updated.interval, watch.id);
        return send(res, 200, await check(requireWatch(watch.id)));
      }
      if (!match[2] && req.method === 'DELETE') {
        db.prepare('DELETE FROM watches WHERE id = ?').run(watch.id);
        return send(res, 204, null);
      }
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
    }
    send(res, 404, { error: 'Introuvable' });
  } catch (e) {
    send(res, 400, { error: errorMessage(e) });
  }
});

server.listen(PORT, () => console.log(
  `web-watcher v${APP_VERSION} sur http://localhost:${PORT} (intervalle par défaut : ${DEFAULT_INTERVAL} s)`,
));
