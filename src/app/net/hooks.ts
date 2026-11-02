import { useEffect, useState } from 'react';
import type { Play, PresenceState, PresenceStatus, Round, RoundsApi } from './types.ts';

/** Live list of rounds (null while loading, or with no backend). */
export function useRounds(api: RoundsApi | null): Round[] | null {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  useEffect(() => api?.onRounds(setRounds), [api]);
  return rounds;
}

const STATUSES: readonly string[] = ['lobby', 'free', 'playing', 'finished'] satisfies PresenceStatus[];

/**
 * Players currently on the site, one entry per player ID. Presence is written by any browser, so entries with an
 * unknown status are ignored and nicknames are trimmed to 24 characters for the projector.
 */
export function usePresenceList(api: RoundsApi | null): PresenceState[] {
  const [players, setPlayers] = useState<PresenceState[]>([]);
  useEffect(
    () =>
      api?.onPresence((list) => {
        const valid = list
          .filter((p) => STATUSES.includes(p.status) && typeof p.nickname === 'string')
          .map((p) => ({ ...p, nickname: p.nickname.trim().slice(0, 24).trim() }));
        setPlayers([...new Map(valid.map((p) => [p.playerId, p])).values()]);
      }),
    [api],
  );
  return players;
}

/**
 * Live plays of one round (null while loading or when roundId is null). `resync` (e.g. the round's status) only
 * restarts the subscription when it changes, so the list is reloaded from scratch at that moment.
 */
export function useRoundPlays(api: RoundsApi | null, roundId: number | null, resync?: unknown): Play[] | null {
  const [plays, setPlays] = useState<{ roundId: number; plays: Play[] } | null>(null);
  useEffect(() => {
    if (!api || roundId === null) return;
    return api.onPlays(roundId, (p) => setPlays({ roundId, plays: p }));
  }, [api, roundId, resync]);
  return plays && plays.roundId === roundId ? plays.plays : null;
}
