import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
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
  type SubmitErrorKind,
  type Unsubscribe,
} from './types.ts';

interface RoundRow {
  id: number;
  number: number;
  preset_id: string;
  outbreak_id: string;
  budget: number;
  rank_metric: Round['rankMetric'];
  status: Round['status'];
  opened_at: string;
  closed_at: string | null;
}

interface PlayRow {
  id: number;
  round_id: number;
  preset_id: string;
  outbreak_id: string;
  budget: number;
  player_id: string;
  nickname: string;
  picks: number[];
  used_predictions: boolean;
  used_uncertainty: boolean;
  hidden: boolean;
  created_at: string;
}

const toRound = (r: RoundRow): Round => ({
  id: r.id,
  number: r.number,
  presetId: r.preset_id,
  outbreakId: r.outbreak_id,
  budget: r.budget,
  rankMetric: r.rank_metric,
  status: r.status,
  openedAt: r.opened_at,
  closedAt: r.closed_at,
});

const toPlay = (p: PlayRow): Play => ({
  id: p.id,
  roundId: p.round_id,
  presetId: p.preset_id,
  outbreakId: p.outbreak_id,
  budget: p.budget,
  playerId: p.player_id,
  nickname: p.nickname,
  picks: p.picks,
  usedPredictions: p.used_predictions,
  usedUncertainty: p.used_uncertainty,
  hidden: p.hidden,
  createdAt: p.created_at,
});

interface RpcResult {
  error: { message: string; code: string } | null;
  status: number;
}

/** Map an RPC failure to a submit error: our own exceptions by name, server faults and no response as network. */
export function submitErrorKind(res: RpcResult): SubmitErrorKind {
  const known: SubmitErrorKind[] = ['round_closed', 'duplicate', 'invalid'];
  const message = res.error?.message ?? '';
  if ((known as string[]).includes(message)) return message as SubmitErrorKind;
  return res.status === 0 || res.status >= 500 ? 'network' : 'invalid';
}

function throwIfPinError(res: RpcResult): void {
  if (!res.error) return;
  if (res.error.message === 'wrong_pin') throw new PinError();
  throw new Error(res.error.message);
}

let channelCount = 0;
const channelName = (base: string) => `${base}-${++channelCount}-${Math.random().toString(36).slice(2, 8)}`;

/** Current players on a presence channel (first entry per key). */
function presencePlayers(channel: RealtimeChannel): PresenceState[] {
  return Object.values(channel.presenceState<PresenceState>())
    .map((metas) => metas[0])
    .filter((m) => m !== undefined)
    .map(({ playerId, nickname, status, roundId }) => ({ playerId, nickname, status, roundId }));
}

const POLL_MS = 15_000;
const RETRY_MS = 2000;

/** Live data via Supabase. Every subscription reloads the full list on each change, on (re)connect and on a timer. */
export class SupabaseRoundsApi implements RoundsApi {
  private presenceChannel: RealtimeChannel | null = null;
  private me: PresenceState | null = null;
  private presenceListeners = new Set<(p: PresenceState[]) => void>();
  private readonly sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: false } });
  }

  /**
   * Load now, then reload on every change, on (re)subscribe, on channel errors and every 15 s, so a dead
   * WebSocket can't leave the list stale. A failed load is retried once after 2 s. Responses are numbered:
   * one older than the result already shown is dropped, and so is an unchanged list (most polls), to spare re-renders.
   */
  private live<T>(table: 'rounds' | 'plays', filter: string | undefined, load: () => PromiseLike<T[] | null>, cb: (rows: T[]) => void): Unsubscribe {
    let seq = 0;
    let shown = 0;
    let stopped = false;
    let last = '';
    let retry: ReturnType<typeof setTimeout> | undefined;
    const reload = async (retryOnFail = true) => {
      const mine = ++seq;
      const rows = await Promise.resolve(load()).catch(() => null);
      if (stopped || mine < shown) return;
      if (rows) {
        shown = mine;
        const json = JSON.stringify(rows);
        if (json !== last) cb(rows);
        last = json;
      } else if (retryOnFail) {
        clearTimeout(retry);
        retry = setTimeout(() => void reload(false), RETRY_MS);
      }
    };
    const channel = this.sb
      .channel(channelName(table))
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => void reload())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void reload();
      });
    const poll = setInterval(() => void reload(), POLL_MS);
    void reload();
    return () => {
      stopped = true;
      clearInterval(poll);
      clearTimeout(retry);
      void this.sb.removeChannel(channel);
    };
  }

  onRounds(cb: (rounds: Round[]) => void): Unsubscribe {
    return this.live<Round>(
      'rounds',
      undefined,
      async () => {
        const { data, error } = await this.sb.from('rounds').select('*').order('number');
        return error ? null : (data as RoundRow[]).map(toRound);
      },
      cb,
    );
  }

  onPlays(roundId: number, cb: (plays: Play[]) => void): Unsubscribe {
    return this.live<Play>(
      'plays',
      `round_id=eq.${roundId}`,
      async () => {
        const { data, error } = await this.sb.from('plays').select('*').eq('round_id', roundId).order('id');
        return error ? null : (data as PlayRow[]).map(toPlay);
      },
      cb,
    );
  }

  async submitPlay(play: NewPlay): Promise<void> {
    const res = await this.sb.rpc('submit_play', {
      p_round_id: play.roundId,
      p_preset_id: play.presetId,
      p_outbreak_id: play.outbreakId,
      p_budget: play.budget,
      p_player_id: play.playerId,
      p_nickname: play.nickname,
      p_picks: play.picks,
      p_used_predictions: play.usedPredictions,
      p_used_uncertainty: play.usedUncertainty,
    })
      // A hung request becomes a network error (status 0) after 8 s, so the player's retry loop moves on.
      .abortSignal(AbortSignal.timeout(8000));
    if (res.error) throw new SubmitError(submitErrorKind(res), res.error.message);
  }

  private channel(): RealtimeChannel {
    if (this.presenceChannel) return this.presenceChannel;
    const channel = this.sb.channel('players', { config: { presence: { key: channelName('p'), enabled: true } } });
    channel.on('presence', { event: 'sync' }, () => {
      const players = presencePlayers(channel);
      for (const cb of this.presenceListeners) cb(players);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && this.me) void channel.track(this.me);
    });
    this.presenceChannel = channel;
    return channel;
  }

  joinPresence(me: PresenceState): PresenceHandle {
    this.me = me;
    const channel = this.channel();
    void channel.track(me);
    return {
      update: (state) => {
        this.me = state;
        void channel.track(state);
      },
      leave: () => {
        this.me = null;
        void channel.untrack();
      },
    };
  }

  onPresence(cb: (players: PresenceState[]) => void): Unsubscribe {
    this.presenceListeners.add(cb);
    // A listener added after the channel joined (e.g. a remounted board) would otherwise wait for the next sync.
    const channel = this.channel();
    if (channel.state === 'joined') cb(presencePlayers(channel));
    return () => this.presenceListeners.delete(cb);
  }

  async checkPin(pin: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc('check_pin', { pin });
    if (error) throw new Error(error.message);
    return data === true;
  }

  async openRound(pin: string, cfg: RoundConfig): Promise<Round> {
    const res = await this.sb.rpc('open_round', {
      pin,
      p_preset_id: cfg.presetId,
      p_outbreak_id: cfg.outbreakId,
      p_budget: cfg.budget,
      p_rank_metric: cfg.rankMetric,
    });
    throwIfPinError(res);
    return toRound(res.data as RoundRow);
  }

  async closeRound(pin: string, roundId: number): Promise<void> {
    throwIfPinError(await this.sb.rpc('close_round', { pin, p_round_id: roundId }));
  }

  async hidePlay(pin: string, playId: number): Promise<void> {
    throwIfPinError(await this.sb.rpc('hide_play', { pin, p_play_id: playId }));
  }
}
