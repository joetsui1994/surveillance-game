import { useEffect, useMemo, useState } from 'react';
import { presetModel, type Outbreak, type PresetModel } from '../../core/presets.ts';
import { AucChart } from '../components/AucChart.tsx';
import { botResult, loadGameData, type GameData } from '../data.ts';
import { usePresenceList, useRoundPlays, useRounds } from '../net/hooks.ts';
import { latestRound, PinError, type PresenceState, type Round, type RoundsApi } from '../net/types.ts';
import { Leaderboard } from './Leaderboard.tsx';
import { PresenterDrawer } from './PresenterDrawer.tsx';
import { Qr } from './Qr.tsx';
import { METRIC_LABEL } from './ranking.ts';
import { ReplayPanel } from './ReplayPanel.tsx';
import { leaderboardRows, roomMedian, type Row } from './rows.ts';

const PIN_KEY = 'sg.pin';

function loadPin(): string | null {
  try {
    return sessionStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

function savePin(pin: string | null): void {
  try {
    if (pin === null) sessionStorage.removeItem(PIN_KEY);
    else sessionStorage.setItem(PIN_KEY, pin);
  } catch {
    /* ignore */
  }
}

/** The join URL: this page's address without the #/board route. */
export const joinUrl = (href: string): string => href.split('#')[0];

export type BoardPhase = 'lobby' | 'live' | 'results';

/** Live while a round is open; results for the latest closed round until dismissed; otherwise the lobby. */
export function boardPhase(latest: Round | null, dismissed: number | null): BoardPhase {
  if (!latest) return 'lobby';
  if (latest.status === 'open') return 'live';
  return latest.id === dismissed ? 'lobby' : 'results';
}

export function BoardApp({ api }: { api: RoundsApi | null }) {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rounds = useRounds(api);
  const players = usePresenceList(api);
  const latest = rounds ? latestRound(rounds) : null;
  // Resubscribe when the round closes, so the results start from a fresh load of every play.
  const plays = useRoundPlays(api, latest?.id ?? null, latest?.status);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Once opened, the drawer stays mounted (hidden when closed) so its choices survive hiding it.
  const [drawerMounted, setDrawerMounted] = useState(false);
  if (drawerOpen && !drawerMounted) setDrawerMounted(true);
  const [pin, setPinState] = useState(loadPin);
  const [showBots, setShowBots] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);

  const setPin = (p: string | null) => {
    savePin(p);
    setPinState(p);
  };

  useEffect(() => {
    loadGameData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  // P toggles the presenter drawer (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if (e.key === 'p' || e.key === 'P') setDrawerOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // A new round starts with bots hidden and no replay open.
  useEffect(() => {
    setShowBots(false);
    setSelected(null);
  }, [latest?.id]);

  const models = useMemo(() => new Map((data?.presets.presets ?? []).map((p) => [p.id, presetModel(p)])), [data]);
  const model = latest ? (models.get(latest.presetId) ?? null) : null;
  const outbreak = model?.preset.outbreaks.find((o) => o.id === latest?.outbreakId) ?? null;
  // Scoring every play is the slow part of a render: only for results, and only when its inputs change.
  const rows = useMemo(
    () =>
      data && latest?.status === 'closed' && model && outbreak ? leaderboardRows(model, outbreak, latest, plays ?? [], data.bots, showBots) : [],
    [data, model, outbreak, latest, plays, showBots],
  );

  if (!api) return <main className="message">Multiplayer is not configured for this build (no Supabase settings).</main>;
  if (error) return <main className="message">Could not load the game: {error}</main>;
  if (!data || !rounds) return <main className="message">Connecting…</main>;

  const phase = boardPhase(latest, dismissed);

  return (
    <main className="board">
      <header className="bar">
        <div>
          <b>Surveillance Game</b> · ICID 2026
        </div>
        <div>
          {latest && phase !== 'lobby' && model && (
            <span>
              Round {latest.number} · {model.preset.name} · {latest.budget} tests · ranked by {METRIC_LABEL[latest.rankMetric]}
            </span>
          )}
          <button className="gear" aria-label="Presenter controls (P)" onClick={() => setDrawerOpen((o) => !o)}>⚙</button>
        </div>
      </header>

      {phase === 'lobby' && <Lobby players={players} nextNumber={(latest?.number ?? 0) + 1} />}
      {phase === 'live' && latest && <Live round={latest} players={players} submitted={(plays ?? []).filter((p) => !p.hidden).map((p) => p.playerId)} />}
      {phase === 'results' && latest && model && outbreak && (
        <Results
          round={latest}
          model={model}
          outbreak={outbreak}
          rows={rows}
          le={botResult(data.bots, latest.presetId, latest.outbreakId, 'LE').auc.mean.slice(0, latest.budget + 1)}
          showBots={showBots}
          selected={selected}
          onSelect={setSelected}
          onHide={
            pin && drawerOpen
              ? (row) =>
                  row.play &&
                  // Only a wrong PIN locks the drawer; any other failure can simply be retried.
                  void api.hidePlay(pin, row.play.id).catch((e: unknown) => e instanceof PinError && setPin(null))
              : undefined
          }
          onDismiss={() => setDismissed(latest.id)}
        />
      )}

      {drawerMounted && (
        <PresenterDrawer
          hidden={!drawerOpen}
          api={api}
          presets={data.presets.presets}
          rounds={rounds}
          showBots={showBots}
          onShowBots={setShowBots}
          pin={pin}
          onPin={setPin}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </main>
  );
}

function Lobby({ players, nextNumber }: { players: PresenceState[]; nextNumber: number }) {
  const url = joinUrl(location.href);
  return (
    <section className="board-lobby">
      <div className="join">
        <Qr text={url} size={260} />
        <div className="join-url">{url}</div>
        <div className="muted">Scan or type to join</div>
      </div>
      <div className="joined">
        <div className="big" data-testid="joined-count">{players.length}</div>
        <div className="label">players joined</div>
        <div className="chips">
          {players.map((p) => (
            <span key={p.playerId} className="chip">{p.nickname}</span>
          ))}
        </div>
        <p className="muted">Round {nextNumber} starts when the presenter opens it.</p>
      </div>
    </section>
  );
}

function Live({ round, players, submitted }: { round: Round; players: PresenceState[]; submitted: string[] }) {
  const done = new Set(submitted);
  const inRound = new Map(players.filter((p) => p.roundId === round.id).map((p) => [p.playerId, p.nickname]));
  const total = new Set([...inRound.keys(), ...done]).size;
  return (
    <section className="board-live">
      <div className="big" data-testid="finished-count">
        {done.size} / {total} finished
      </div>
      <div className="progress">
        <div style={{ width: `${total === 0 ? 0 : (100 * done.size) / total}%` }} />
      </div>
      <div className="chips">
        {[...inRound].map(([id, name]) => (
          <span key={id} className={`chip${done.has(id) ? ' done' : ''}`}>
            {done.has(id) ? '✓ ' : ''}
            {name}
          </span>
        ))}
      </div>
      <p className="muted">Playing now… results appear when the round closes. Scores stay hidden until then.</p>
    </section>
  );
}

interface ResultsProps {
  round: Round;
  model: PresetModel;
  outbreak: Outbreak;
  rows: Row[];
  le: (number | null)[];
  showBots: boolean;
  selected: Row | null;
  onSelect: (row: Row | null) => void;
  onHide?: (row: Row) => void;
  onDismiss: () => void;
}

function Results({ round, model, outbreak, rows, le, showBots, selected, onSelect, onHide, onDismiss }: ResultsProps) {
  const median = roomMedian(rows);
  const humans = rows.filter((r) => !r.bot);
  const bot = (key: string) => rows.find((r) => r.key === key);
  if (selected) {
    return <ReplayPanel model={model} outbreak={outbreak} row={selected} le={le} median={median} onClose={() => onSelect(null)} />;
  }
  const series = [
    ...(showBots
      ? [
          { key: 'rand', name: 'Random (mean)', short: 'Random', color: '#8a8984', width: 1.5, dash: '4 3', values: bot('bot-RAND')?.curve ?? [] },
          { key: 'ne', name: 'NE', short: 'NE', color: '#6250d6', width: 2, values: bot('bot-NE')?.curve ?? [] },
          { key: 'le', name: 'LE', short: 'LE', color: '#008300', width: 2, values: bot('bot-LE')?.curve ?? [] },
        ]
      : []),
    { key: 'median', name: `Room median (${humans.length} players)`, short: 'Room', color: '#0b0b0b', width: 3, values: median },
  ];
  return (
    <section className="board-results">
      <div className="board-col">
        <div className="leaderboard-wrap">
          <Leaderboard rows={rows} metric={round.rankMetric} onSelect={onSelect} onHide={onHide} />
        </div>
        <p className="muted small">"Looked at": model overlays the player switched on during the game · click a row to replay</p>
        <button onClick={onDismiss}>Back to lobby</button>
      </div>
      <div className="board-col">
        <AucChart series={series} background={humans.map((r) => r.curve)} subtitle="Faint lines: each player · AUC on untested locations · higher is better" />
      </div>
    </section>
  );
}
