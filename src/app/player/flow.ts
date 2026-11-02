import { openRound, type NewPlay, type PresenceStatus, type Round, type SubmitErrorKind } from '../net/types.ts';
import { isFinished, type Session } from '../session.ts';

/** What the player's screen shows, derived from their game and the live rounds (null = not loaded yet). */
export type PlayerView =
  | { kind: 'start'; round: Round | null }
  | { kind: 'play'; round: Round | null; banner: Round | null }
  | { kind: 'practice-results'; banner: Round | null }
  | { kind: 'round-results'; round: Round }
  | { kind: 'round-missed'; round: Round }
  /** The stored game's round no longer exists, or its id now belongs to a different game (database reset): drop the game. */
  | { kind: 'stale' };

/** The open round, unless this player has already joined it. */
export function joinableRound(rounds: Round[] | null, lastJoined: number | null): Round | null {
  const open = rounds ? openRound(rounds) : null;
  return open && open.id !== lastJoined ? open : null;
}

export function playerView(session: Session | null, rounds: Round[] | null, lastJoined: number | null): PlayerView {
  const joinable = joinableRound(rounds, lastJoined);
  if (!session) return { kind: 'start', round: joinable };
  if (session.roundId === null) {
    return isFinished(session) ? { kind: 'practice-results', banner: joinable } : { kind: 'play', round: null, banner: joinable };
  }
  // Rounds not loaded yet: show the board as it was; results wait for the round's status.
  if (rounds === null) return { kind: 'play', round: null, banner: null };
  const round = rounds.find((r) => r.id === session.roundId);
  if (!round || round.presetId !== session.presetId || round.outbreakId !== session.outbreakId || round.budget !== session.budget) {
    return { kind: 'stale' };
  }
  if (isFinished(session)) return { kind: 'round-results', round };
  return round.status === 'open' ? { kind: 'play', round, banner: null } : { kind: 'round-missed', round };
}

/**
 * Join the open round straight away when the player is in the lobby (has a nickname and no game in progress)
 * or has just finished a practice game.
 */
export function shouldAutoJoin(session: Session | null, joinable: Round | null, nickname: string): boolean {
  if (!joinable || nickname.trim() === '') return false;
  return session === null || (session.roundId === null && isFinished(session));
}

export function presenceStatus(session: Session | null): { status: PresenceStatus; roundId: number | null } {
  if (!session) return { status: 'lobby', roundId: null };
  if (session.roundId === null) return { status: 'free', roundId: null };
  return { status: isFinished(session) ? 'finished' : 'playing', roundId: session.roundId };
}

/** A finished round game waiting to reach (or already at) the server. Kept in localStorage across reloads. */
export interface Submission {
  play: NewPlay;
  state: 'pending' | 'sent' | 'rejected';
  reason?: SubmitErrorKind;
}

export function newSubmission(session: Session, playerId: string, nickname: string): Submission {
  if (session.roundId === null || !isFinished(session)) throw new Error('newSubmission: needs a finished round game');
  return {
    state: 'pending',
    play: {
      roundId: session.roundId,
      presetId: session.presetId,
      outbreakId: session.outbreakId,
      budget: session.budget,
      playerId,
      nickname: nickname.trim(),
      picks: session.picks,
      usedPredictions: session.usedPredictions,
      usedUncertainty: session.usedUncertainty,
    },
  };
}

/** Outcome of one submit attempt. 'duplicate' means the server already has this play (an earlier retry got through). */
export function afterSubmit(sub: Submission, error: SubmitErrorKind | null): Submission {
  if (error === null || error === 'duplicate') return { ...sub, state: 'sent', reason: undefined };
  if (error === 'network') return sub;
  return { ...sub, state: 'rejected', reason: error };
}

/** Retry delay after `failures` consecutive network failures: 1 s, 2 s, 4 s … capped at 15 s. */
export const retryDelay = (failures: number): number => Math.min(15_000, 1000 * 2 ** Math.max(0, failures - 1));
