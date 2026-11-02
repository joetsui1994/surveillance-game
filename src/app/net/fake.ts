import { checkPlay } from './rules.ts';
import {
  PinError,
  SubmitError,
  type NewPlay,
  type Play,
  type PresenceHandle,
  type PresenceState,
  type Round,
  type RoundConfig,
  type RoundsApi,
  type Unsubscribe,
} from './types.ts';

/** In-memory backend with the same rules as the database. Listeners fire synchronously. */
export class FakeRoundsApi implements RoundsApi {
  rounds: Round[] = [];
  plays: Play[] = [];
  /** Set to make submitPlay fail with 'network' (simulates Wi-Fi loss). */
  offline = false;
  private presence = new Map<string, PresenceState>();
  private roundListeners = new Set<(r: Round[]) => void>();
  private playListeners = new Set<{ roundId: number; cb: (p: Play[]) => void }>();
  private presenceListeners = new Set<(p: PresenceState[]) => void>();
  private clock = 0;
  private readonly pin: string;

  constructor(pin = '1234') {
    this.pin = pin;
  }

  private now() {
    return new Date(Date.UTC(2026, 10, 12, 9, 0, this.clock++)).toISOString();
  }
  private emitRounds() {
    for (const cb of this.roundListeners) cb(this.rounds.map((r) => ({ ...r })));
  }
  private emitPlays() {
    for (const { roundId, cb } of this.playListeners) cb(this.plays.filter((p) => p.roundId === roundId).map((p) => ({ ...p })));
  }
  private emitPresence() {
    for (const cb of this.presenceListeners) cb([...this.presence.values()]);
  }
  private requirePin(pin: string) {
    if (pin !== this.pin) throw new PinError();
  }

  onRounds(cb: (r: Round[]) => void): Unsubscribe {
    this.roundListeners.add(cb);
    cb(this.rounds.map((r) => ({ ...r })));
    return () => this.roundListeners.delete(cb);
  }

  onPlays(roundId: number, cb: (p: Play[]) => void): Unsubscribe {
    const entry = { roundId, cb };
    this.playListeners.add(entry);
    cb(this.plays.filter((p) => p.roundId === roundId).map((p) => ({ ...p })));
    return () => this.playListeners.delete(entry);
  }

  async submitPlay(play: NewPlay): Promise<void> {
    if (this.offline) throw new SubmitError('network');
    const error = checkPlay(this.rounds.find((r) => r.id === play.roundId), play, this.plays);
    if (error) throw new SubmitError(error);
    this.plays.push({ ...play, picks: [...play.picks], id: this.plays.length + 1, hidden: false, createdAt: this.now() });
    this.emitPlays();
  }

  joinPresence(me: PresenceState): PresenceHandle {
    this.presence.set(me.playerId, { ...me });
    this.emitPresence();
    return {
      update: (state) => {
        this.presence.set(state.playerId, { ...state });
        this.emitPresence();
      },
      leave: () => {
        this.presence.delete(me.playerId);
        this.emitPresence();
      },
    };
  }

  onPresence(cb: (p: PresenceState[]) => void): Unsubscribe {
    this.presenceListeners.add(cb);
    cb([...this.presence.values()]);
    return () => this.presenceListeners.delete(cb);
  }

  async checkPin(pin: string): Promise<boolean> {
    return pin === this.pin;
  }

  async openRound(pin: string, cfg: RoundConfig): Promise<Round> {
    this.requirePin(pin);
    // Like the database: never close a live round by accident.
    if (this.rounds.some((r) => r.status === 'open')) throw new Error('round_open');
    const now = this.now();
    const round: Round = { ...cfg, id: this.rounds.length + 1, number: this.rounds.length + 1, status: 'open', openedAt: now, closedAt: null };
    this.rounds.push(round);
    this.emitRounds();
    return { ...round };
  }

  async closeRound(pin: string, roundId: number): Promise<void> {
    this.requirePin(pin);
    const r = this.rounds.find((x) => x.id === roundId);
    if (r && r.status === 'open') Object.assign(r, { status: 'closed', closedAt: this.now() });
    this.emitRounds();
  }

  async hidePlay(pin: string, playId: number): Promise<void> {
    this.requirePin(pin);
    const p = this.plays.find((x) => x.id === playId);
    if (p) p.hidden = true;
    this.emitPlays();
  }
}
