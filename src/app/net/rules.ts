import type { NewPlay, Play, Round, SubmitErrorKind } from './types.ts';

/** The insert rules the database enforces (supabase/schema.sql); the fake backend applies the same ones. */
export function checkPlay(round: Round | undefined, play: NewPlay, existing: Play[]): SubmitErrorKind | null {
  if (!round || round.status !== 'open') return 'round_closed';
  if (play.presetId !== round.presetId || play.outbreakId !== round.outbreakId || play.budget !== round.budget) return 'invalid';
  if (play.picks.length !== round.budget || new Set(play.picks).size !== play.picks.length) return 'invalid';
  if (!play.picks.every((p) => Number.isInteger(p) && p >= 0)) return 'invalid';
  const nickname = play.nickname.trim();
  if (nickname.length === 0 || nickname.length > 24) return 'invalid';
  if (existing.some((p) => p.roundId === play.roundId && p.playerId === play.playerId)) return 'duplicate';
  return null;
}
