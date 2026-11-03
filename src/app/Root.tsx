import { lazy, Suspense, useEffect, useState } from 'react';
import { App } from './App.tsx';
import { BoardApp } from './board/BoardApp.tsx';
import type { RoundsApi } from './net/types.ts';

/** Hash routes, because GitHub Pages can't rewrite paths: #/board is the projector, anything else the player app. */
export const isBoardRoute = (hash: string): boolean => hash.replace(/\/$/, '') === '#/board';
export const isLayoutRoute = (hash: string): boolean => hash.replace(/\/$/, '') === '#/layout';

// The layout editor exists only under `npm run dev`; production builds drop it (and its import) entirely.
const LayoutEditor = import.meta.env.DEV ? lazy(() => import('./layout/LayoutEditor.tsx')) : null;

export function Root({ api }: { api: RoundsApi | null }) {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  if (LayoutEditor && isLayoutRoute(hash))
    return (
      <Suspense fallback={<main className="message">Loading…</main>}>
        <LayoutEditor />
      </Suspense>
    );
  return isBoardRoute(hash) ? <BoardApp api={api} /> : <App api={api} />;
}
