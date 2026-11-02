import { useEffect, useState } from 'react';
import type { Play, PresenceState, Round, RoundsApi } from './types.ts';

/** Live list of rounds (null while loading, or with no backend). */
export function useRounds(api: RoundsApi | null): Round[] | null {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  useEffect(() => api?.onRounds(setRounds), [api]);
  return rounds;
}

/** Players currently on the site, one entry per player ID. */
export function usePresenceList(api: RoundsApi | null): PresenceState[] {
  const [players, setPlayers] = useState<PresenceState[]>([]);
  useEffect(() => api?.onPresence((list) => setPlayers([...new Map(list.map((p) => [p.playerId, p])).values()])), [api]);
  return players;
}

/** Live plays of one round (null while loading or when roundId is null). */
export function useRoundPlays(api: RoundsApi | null, roundId: number | null): Play[] | null {
  const [plays, setPlays] = useState<{ roundId: number; plays: Play[] } | null>(null);
  useEffect(() => {
    if (!api || roundId === null) return;
    return api.onPlays(roundId, (p) => setPlays({ roundId, plays: p }));
  }, [api, roundId]);
  return plays && plays.roundId === roundId ? plays.plays : null;
}
