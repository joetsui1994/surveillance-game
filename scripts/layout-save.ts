// Dev-server endpoint for the #/layout editor: POST /__layout/save { id, layout } rewrites offline/layouts/<id>.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const LAYOUT_ROUTE = '/__layout/save';

/** Replace the positions in an existing layout file, keeping its edges; throws on anything unexpected. */
export function saveLayoutFile(dir: string, body: unknown): string {
  const { id, layout } = (body ?? {}) as { id?: unknown; layout?: unknown };
  if (typeof id !== 'string' || !/^[a-z0-9]+$/.test(id)) throw new Error('bad id');
  const path = resolve(dir, `${id}.json`);
  if (!existsSync(path)) throw new Error(`no layout file for ${id}`);
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { edges: [number, number][]; layout: [number, number][] };
  const ok =
    Array.isArray(layout) &&
    layout.length === saved.layout.length &&
    layout.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && v >= 0 && v <= 1));
  if (!ok) throw new Error('layout must be one [x, y] in [0, 1]² per node');
  const rounded = (layout as [number, number][]).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  writeFileSync(path, JSON.stringify({ id, edges: saved.edges, layout: rounded, source: 'edited' }) + '\n');
  return path;
}

export function layoutSavePlugin(dir: string): Plugin {
  return {
    name: 'layout-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(LAYOUT_ROUTE, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          try {
            const path = saveLayoutFile(dir, JSON.parse(raw));
            res.end(JSON.stringify({ path }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
        });
      });
    },
  };
}
