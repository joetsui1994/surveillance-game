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

/** Live data via Supabase. Every subscription reloads the full list on each change and on (re)connect. */
export class SupabaseRoundsApi implements RoundsApi {
  private presenceChannel: RealtimeChannel | null = null;
  private me: PresenceState | null = null;
  private presenceListeners = new Set<(p: PresenceState[]) => void>();
  private readonly sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: false } });
  }

  /** Load once, then reload on every change; a sequence number drops stale responses. */
  private live<T>(table: 'rounds' | 'plays', filter: string | undefined, load: () => PromiseLike<T[] | null>, cb: (rows: T[]) => void): Unsubscribe {
    let seq = 0;
    const reload = async () => {
      const mine = ++seq;
      const rows = await load();
      if (rows && mine === seq) cb(rows);
    };
    const channel = this.sb
      .channel(channelName(table))
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => void reload())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void reload();
      });
    return () => void this.sb.removeChannel(channel);
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
    });
    if (res.error) throw new SubmitError(submitErrorKind(res), res.error.message);
  }

  private channel(): RealtimeChannel {
    if (this.presenceChannel) return this.presenceChannel;
    const channel = this.sb.channel('players', { config: { presence: { key: channelName('p'), enabled: true } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceState>();
      const players = Object.values(state)
        .map((metas) => metas[0])
        .filter((m) => m !== undefined)
        .map(({ playerId, nickname, status, roundId }) => ({ playerId, nickname, status, roundId }));
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
    this.channel();
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
