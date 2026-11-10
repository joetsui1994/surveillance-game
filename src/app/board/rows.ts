import type { BotsFile } from '../../core/bots.ts';
import { lcArea } from '../../core/metrics.ts';
import type { PolicyName } from '../../core/policies.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { botResult } from '../data.ts';
import type { Play, Round } from '../net/types.ts';
import { medianCurve, metricValue, rankBy, scorePlays, type Scores } from './ranking.ts';

/** One leaderboard line: a player, or a bot once revealed. */
export interface Row extends Scores {
  key: string;
  name: string;
  bot: boolean;
  /** Human rank (bots are not ranked); null if the metric is undefined or for bots. */
  rank: number | null;
  /** AUC after each test, 0..budget. */
  curve: (number | null)[];
  /** Picks to replay; null for Random and DC (200-run averages). */
  picks: number[] | null;
  play: Play | null;
}

const BOTS: { policy: PolicyName; name: string }[] = [
  { policy: 'LE', name: 'LE' },
  { policy: 'NE', name: 'NE' },
  { policy: 'BALD', name: 'BALD' },
  { policy: 'DC', name: 'DC (degree, mean)' },
  { policy: 'RAND', name: 'Random (mean)' },
];

export function botRows(bots: BotsFile, presetId: string, outbreakId: string, budget: number): Row[] {
  return BOTS.map(({ policy, name }) => {
    const r = botResult(bots, presetId, outbreakId, policy);
    const curve = r.auc.mean.slice(0, budget + 1);
    return {
      key: `bot-${policy}`,
      name,
      bot: true,
      rank: null,
      curve,
      auc: curve[budget] ?? null,
      aucArea: lcArea(curve),
      accuracy: r.accuracy.mean[budget] ?? null,
      picks: r.picks ? r.picks.slice(0, budget) : null,
      play: null,
    };
  });
}

/** Players ranked by the round's metric, with bots (if shown) placed by their value. */
export function leaderboardRows(model: PresetModel, outbreak: Outbreak, round: Round, plays: Play[], bots: BotsFile, showBots: boolean): Row[] {
  const players: Row[] = rankBy(scorePlays(model, outbreak, plays), (s) => metricValue(s, round.rankMetric)).map(({ item, rank }) => ({
    key: `play-${item.play.id}`,
    name: item.name,
    bot: false,
    rank,
    curve: item.curve,
    auc: item.auc,
    aucArea: item.aucArea,
    accuracy: item.accuracy,
    picks: item.play.picks,
    play: item.play,
  }));
  if (!showBots) return players;
  const all = [...players, ...botRows(bots, round.presetId, round.outbreakId, round.budget)];
  // Stable sort: bots go after players with the same value; undefined values last.
  const v = (r: Row) => metricValue(r, round.rankMetric) ?? -Infinity;
  return all.map((r, k) => ({ r, k })).sort((a, b) => v(b.r) - v(a.r) || a.k - b.k).map(({ r }) => r);
}

/** The room's median learning curve. */
export const roomMedian = (rows: Row[]): (number | null)[] => medianCurve(rows.filter((r) => !r.bot).map((r) => r.curve));
