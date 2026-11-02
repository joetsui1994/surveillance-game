import { useState } from 'react';
import type { Preset } from '../../core/presets.ts';
import { openRound, PinError, type RankMetric, type Round, type RoundsApi } from '../net/types.ts';
import { METRIC_LABEL } from './ranking.ts';

export interface PresenterDrawerProps {
  api: RoundsApi;
  presets: Preset[];
  rounds: Round[];
  showBots: boolean;
  onShowBots: (on: boolean) => void;
  /** The checked PIN, or null while locked. Owned by the board, which also uses it to hide players. */
  pin: string | null;
  onPin: (pin: string | null) => void;
  onClose: () => void;
  /** Hidden rather than unmounted, so the choices below survive hiding the drawer. */
  hidden?: boolean;
}

/** Presenter controls, unlocked with the PIN (kept for this tab only). */
export function PresenterDrawer({ api, presets, rounds, showBots, onShowBots, pin, onPin, onClose, hidden = false }: PresenterDrawerProps) {
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === presetId);
  const roundOutbreaks = preset?.outbreaks.filter((o) => o.split === 'round') ?? [];
  const unused = roundOutbreaks.find((o) => !rounds.some((r) => r.presetId === presetId && r.outbreakId === o.id));
  const [outbreakId, setOutbreakId] = useState(unused?.id ?? roundOutbreaks[0]?.id ?? '');
  const [budget, setBudget] = useState(preset?.defaultBudget ?? 10);
  const [metric, setMetric] = useState<RankMetric>('auc');
  // The round this drawer opened counts as open until the live list shows it closed, even if that list lags behind.
  const [opened, setOpened] = useState<Round | null>(null);
  const openedClosed = opened !== null && rounds.some((r) => r.id === opened.id && r.status === 'closed');
  const open = openRound(rounds) ?? (opened && !openedClosed ? opened : null);
  const nextNumber = Math.max(0, opened?.number ?? 0, ...rounds.map((r) => r.number)) + 1;

  const act = async (f: (pin: string) => Promise<unknown>) => {
    if (!pin) return;
    setBusy(true);
    setError(null);
    try {
      await f(pin);
    } catch (e) {
      if (e instanceof PinError) onPin(null);
      const message = e instanceof Error ? e.message : String(e);
      setError(message === 'round_open' ? 'A round is already open. Close it first.' : message);
    } finally {
      setBusy(false);
    }
  };

  if (!pin) {
    return (
      <aside className="drawer" data-testid="drawer" hidden={hidden}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              if (await api.checkPin(entry)) onPin(entry);
              else setError('Wrong PIN');
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <b>Presenter</b>
          <label>
            PIN
            <input type="password" value={entry} onChange={(e) => setEntry(e.target.value)} autoFocus />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy || entry === ''}>Unlock</button>
            <button type="button" onClick={onClose}>Hide</button>
          </div>
        </form>
      </aside>
    );
  }

  return (
    <aside className="drawer" data-testid="drawer" hidden={hidden}>
      <b>Presenter</b>
      <label>
        Network
        <select
          value={presetId}
          onChange={(e) => {
            const next = presets.find((p) => p.id === e.target.value);
            setPresetId(e.target.value);
            setOutbreakId(next?.outbreaks.find((o) => o.split === 'round')?.id ?? '');
            setBudget(next?.defaultBudget ?? 10);
          }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        Outbreak
        <select value={outbreakId} onChange={(e) => setOutbreakId(e.target.value)}>
          {roundOutbreaks.map((o) => {
            const used = rounds.filter((r) => r.presetId === presetId && r.outbreakId === o.id).map((r) => r.number);
            return (
              <option key={o.id} value={o.id}>
                {o.id} · prevalence {Math.round(o.prevalence * 100)}%{used.length > 0 ? ` · used in round ${used.join(', ')}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        Budget (tests)
        <input type="number" min={1} max={preset?.maxBudget ?? 30} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
      </label>
      <label>
        Rank by
        <select value={metric} onChange={(e) => setMetric(e.target.value as RankMetric)}>
          {(Object.keys(METRIC_LABEL) as RankMetric[]).map((m) => (
            <option key={m} value={m}>{METRIC_LABEL[m]}{m === 'auc' ? ' (paper)' : ''}</option>
          ))}
        </select>
      </label>
      <div className="row">
        <button
          className="primary"
          disabled={busy || open !== null || !preset || !(Number.isInteger(budget) && budget >= 1 && budget <= preset.maxBudget)}
          onClick={() =>
            act(async (p) => {
              setOpened(await api.openRound(p, { presetId, outbreakId, budget, rankMetric: metric }));
              // Suggest the next outbreak for the following round.
              const k = roundOutbreaks.findIndex((o) => o.id === outbreakId);
              setOutbreakId(roundOutbreaks[(k + 1) % roundOutbreaks.length].id);
            })
          }
        >
          Open round {nextNumber}
        </button>
        <button disabled={busy || open === null} onClick={() => act((p) => api.closeRound(p, open!.id))}>
          Close round{open ? ` ${open.number}` : ''}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={showBots} onChange={(e) => onShowBots(e.target.checked)} /> Reveal bots
      </label>
      <p className="muted small">✕ on a leaderboard row hides that player.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={onClose}>Hide drawer</button>
        <button onClick={() => onPin(null)}>Lock</button>
      </div>
    </aside>
  );
}
