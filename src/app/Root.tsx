import { useEffect, useState } from 'react';
import { App } from './App.tsx';
import { BoardApp } from './board/BoardApp.tsx';
import type { RoundsApi } from './net/types.ts';

/** Hash routes, because GitHub Pages can't rewrite paths: #/board is the projector, anything else the player app. */
export const isBoardRoute = (hash: string): boolean => hash.replace(/\/$/, '') === '#/board';

export function Root({ api }: { api: RoundsApi | null }) {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return isBoardRoute(hash) ? <BoardApp api={api} /> : <App api={api} />;
}
