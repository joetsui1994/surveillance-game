import { useMemo } from 'react';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { METRIC_LABEL, metricValue, rankBy, scorePlays } from '../board/ranking.ts';
import type { Play, Round } from '../net/types.ts';
import type { Submission } from './flow.ts';

export interface RoundNoticeProps {
  round: Round;
  model: PresetModel;
  outbreak: Outbreak;
  playerId: string;
  submission: Submission | null;
  /** Consecutive network failures while sending. */
  failures: number;
  /** All plays of the round, once it has closed (null while loading). */
  plays: Play[] | null;
}

/** Above a round player's results: delivery status while the round is open, then their rank. */
export function RoundNotice({ round, model, outbreak, playerId, submission, failures, plays }: RoundNoticeProps) {
  const ranked = useMemo(() => {
    if (!plays) return null;
    return rankBy(scorePlays(model, outbreak, plays), (s) => metricValue(s, round.rankMetric));
  }, [plays, model, outbreak, round.rankMetric]);

  const mine = submission && submission.play.roundId === round.id ? submission : null;
  if (mine?.state === 'rejected') {
    const why = mine.reason === 'round_closed' ? 'The round closed before your result reached the server' : 'The server could not accept your result';
    return <div className="notice bad" data-testid="round-notice">{why}, so it wasn't counted.</div>;
  }
  if (round.status === 'open') {
    const text =
      mine?.state === 'sent'
        ? '✓ Result received. Waiting for the presenter to close the round…'
        : failures > 0
          ? 'Connection problem, retrying… Keep this page open.'
          : 'Sending your result…';
    return <div className={`notice${mine?.state === 'sent' ? ' good' : ''}`} data-testid="round-notice">{text}</div>;
  }
  if (!ranked) return <div className="notice" data-testid="round-notice">Loading the room's results…</div>;
  const me = ranked.find((r) => r.item.play.playerId === playerId);
  if (!me) return <div className="notice bad" data-testid="round-notice">Your game wasn't counted (it didn't reach the server before the round closed).</div>;
  return (
    <div className="notice good" data-testid="round-notice">
      <span className="rank">{me.rank === null ? '–' : `#${me.rank}`}</span> of {ranked.length} · ranked by {METRIC_LABEL[round.rankMetric]}
    </div>
  );
}
