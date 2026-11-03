// Dev-server endpoints for the #/layout editor: GET /__layout/<id> reads offline/layouts/<id>.json and
// POST /__layout/save { id, layout } rewrites it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const LAYOUT_ROUTE = '/__layout';

export interface LayoutFile {
  id: string;
  edges: [number, number][];
  layout: [number, number][];
  source: string;
}

/** The path of an existing layout file; throws on a bad or unknown id. */
function layoutPath(dir: string, id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9]+$/.test(id)) throw new Error('bad id');
  const path = resolve(dir, `${id}.json`);
  if (!existsSync(path)) throw new Error(`no layout file for ${id}`);
  return path;
}

export function readLayoutFile(dir: string, id: unknown): LayoutFile {
  return JSON.parse(readFileSync(layoutPath(dir, id), 'utf8')) as LayoutFile;
}

/** Replace the positions in an existing layout file, keeping its edges; throws on anything unexpected. */
export function saveLayoutFile(dir: string, body: unknown): string {
  const { id, layout } = (body ?? {}) as { id?: unknown; layout?: unknown };
  const path = layoutPath(dir, id);
  const saved = readLayoutFile(dir, id);
  const ok =
    Array.isArray(layout) &&
    layout.length === saved.layout.length &&
    layout.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && v >= 0 && v <= 1));
  if (!ok) throw new Error('layout must be one [x, y] in [0, 1]² per node');
  const rounded = (layout as [number, number][]).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  writeFileSync(path, JSON.stringify({ id, edges: saved.edges, layout: rounded, source: 'edited' }) + '\n');
  return path;
}

/** Why a request must be refused, or null: another site's page (403), or a POST that isn't JSON (415). */
export function requestError(method: string | undefined, headers: IncomingHttpHeaders): { status: number; error: string } | null {
  const { origin, host } = headers;
  if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) return { status: 403, error: 'cross-origin request' };
  if (method === 'POST' && headers['content-type']?.split(';')[0].trim() !== 'application/json') return { status: 415, error: 'expected application/json' };
  return null;
}

export function layoutSavePlugin(dir: string): Plugin {
  return {
    name: 'layout-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(LAYOUT_ROUTE, (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const refused = requestError(req.method, req.headers);
        if (refused) return reply(refused.status, { error: refused.error });
        const route = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (req.method === 'GET' && route !== 'save') {
          try {
            reply(200, readLayoutFile(dir, route));
          } catch (e) {
            reply(404, { error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }
        if (req.method !== 'POST' || route !== 'save') return reply(405, { error: 'method not allowed' });
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          try {
            reply(200, { path: saveLayoutFile(dir, JSON.parse(raw)) });
          } catch (e) {
            reply(400, { error: e instanceof Error ? e.message : String(e) });
          }
        });
      });
    },
  };
}
