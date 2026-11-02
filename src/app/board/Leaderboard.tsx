import type { RankMetric } from '../net/types.ts';
import { formatMetric, METRIC_LABEL, metricValue } from './ranking.ts';
import type { Row } from './rows.ts';

export interface LeaderboardProps {
  rows: Row[];
  metric: RankMetric;
  onSelect: (row: Row) => void;
  /** Shown only while the presenter drawer is unlocked. */
  onHide?: (row: Row) => void;
}

const OTHER: Record<RankMetric, RankMetric[]> = { auc: ['lc_auc', 'accuracy'], lc_auc: ['auc', 'accuracy'], accuracy: ['auc', 'lc_auc'] };

export function Leaderboard({ rows, metric, onSelect, onHide }: LeaderboardProps) {
  return (
    <table className="leaderboard" data-testid="leaderboard">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th className="num">{METRIC_LABEL[metric]}</th>
          {OTHER[metric].map((m) => (
            <th key={m} className="num muted">{METRIC_LABEL[m]}</th>
          ))}
          <th>Looked at</th>
          {onHide && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const replayable = r.picks !== null;
          return (
            <tr
              key={r.key}
              className={`${r.bot ? 'bot' : ''}${replayable ? ' clickable' : ''}`}
              onClick={replayable ? () => onSelect(r) : undefined}
              data-testid={`row-${r.key}`}
            >
              <td>{r.bot ? '–' : (r.rank ?? '–')}</td>
              <td>
                {r.name}
                {r.bot && <span className="tag bot">bot</span>}
              </td>
              <td className="num strong">{formatMetric(metricValue(r, metric), metric)}</td>
              {OTHER[metric].map((m) => (
                <td key={m} className="num muted">{formatMetric(metricValue(r, m), m)}</td>
              ))}
              <td>
                {r.play?.usedPredictions && <span className="tag">predictions</span>}
                {r.play?.usedUncertainty && <span className="tag">uncertainty</span>}
              </td>
              {onHide && (
                <td>
                  {r.play && (
                    <button
                      className="hide"
                      aria-label={`Hide ${r.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHide(r);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
