/** Shared shapes for the multiplayer backend (Supabase in production, an in-memory fake in tests). */
export type RankMetric = 'auc' | 'lc_auc' | 'accuracy';

export interface RoundConfig {
  presetId: string;
  outbreakId: string;
  budget: number;
  rankMetric: RankMetric;
}

export interface Round extends RoundConfig {
  id: number;
  /** 1, 2, 3… in the order rounds were opened. */
  number: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
}

/** A finished round game, as submitted by a player. Scores are never sent; the board recomputes them from picks. */
export interface NewPlay {
  roundId: number;
  presetId: string;
  outbreakId: string;
  budget: number;
  playerId: string;
  nickname: string;
  picks: number[];
  usedPredictions: boolean;
  usedUncertainty: boolean;
}

export interface Play extends NewPlay {
  id: number;
  hidden: boolean;
  createdAt: string;
}

export type PresenceStatus = 'lobby' | 'free' | 'playing' | 'finished';

export interface PresenceState {
  playerId: string;
  nickname: string;
  status: PresenceStatus;
  /** The round being played (status 'playing' or 'finished'), else null. */
  roundId: number | null;
}

export type SubmitErrorKind = 'round_closed' | 'duplicate' | 'invalid' | 'network';

export class SubmitError extends Error {
  readonly kind: SubmitErrorKind;
  constructor(kind: SubmitErrorKind, message: string = kind) {
    super(message);
    this.kind = kind;
  }
}

/** Thrown by presenter actions when the PIN is wrong. */
export class PinError extends Error {
  constructor() {
    super('Wrong PIN');
  }
}

export type Unsubscribe = () => void;

export interface PresenceHandle {
  update(state: PresenceState): void;
  leave(): void;
}

export interface RoundsApi {
  /** All rounds, oldest first. Called once with the current list, then on every change. */
  onRounds(cb: (rounds: Round[]) => void): Unsubscribe;
  /** All plays of one round (hidden ones included), oldest first. Called once, then on every change. */
  onPlays(roundId: number, cb: (plays: Play[]) => void): Unsubscribe;
  /** Rejects with a SubmitError. */
  submitPlay(play: NewPlay): Promise<void>;
  joinPresence(me: PresenceState): PresenceHandle;
  onPresence(cb: (players: PresenceState[]) => void): Unsubscribe;
  checkPin(pin: string): Promise<boolean>;
  /** Presenter actions reject with PinError on a wrong PIN. Opening a round closes any open one. */
  openRound(pin: string, cfg: RoundConfig): Promise<Round>;
  closeRound(pin: string, roundId: number): Promise<void>;
  hidePlay(pin: string, playId: number): Promise<void>;
}

/** The most recently opened round, if any. */
export const latestRound = (rounds: Round[]): Round | null => (rounds.length === 0 ? null : rounds.reduce((a, b) => (b.number > a.number ? b : a)));

/** The open round, if any (there is never more than one). */
export const openRound = (rounds: Round[]): Round | null => rounds.find((r) => r.status === 'open') ?? null;
