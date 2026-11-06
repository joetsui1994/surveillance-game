import { useEffect, useMemo, useState } from 'react';
import { presetModel, type PresetModel } from '../core/presets.ts';
import { chooseOutbreak, loadGameData, type GameData } from './data.ts';
import type { Round, RoundsApi } from './net/types.ts';
import { joinableRound, newSubmission, playerView, shouldAutoJoin } from './player/flow.ts';
import { useRoundPlays } from './net/hooks.ts';
import { usePresence, useSubmitter } from './player/hooks.ts';
import { RoundNotice } from './player/RoundNotice.tsx';
import { isFinished, isValidFor, startSession, type Session } from './session.ts';
import {
  loadLastOutbreak, loadLastRound, loadNickname, loadPlayerId, loadSession, loadSubmission,
  saveLastOutbreak, saveLastRound, saveNickname, saveSession, saveSubmission,
} from './storage.ts';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { ResultsScreen } from './screens/ResultsScreen.tsx';
import { StartScreen } from './screens/StartScreen.tsx';

export interface AppProps {
  /** Live backend for presenter-led rounds; null (the default) is single-player only. */
  api?: RoundsApi | null;
}

export function App({ api = null }: AppProps) {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(loadNickname);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [playerId] = useState(loadPlayerId);
  const [rounds, setRounds] = useState<Round[] | null>(api ? null : []);
  const [lastRound, setLastRound] = useState(loadLastRound);
  const [submission, setSubmission] = useState(loadSubmission);

  useEffect(() => {
    loadGameData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => saveSession(session), [session]);
  useEffect(() => saveSubmission(submission), [submission]);
  useEffect(() => api?.onRounds(setRounds), [api]);

  // Building K is ~ms per preset; cache one model per preset.
  const model = useMemo(() => {
    const cache = new Map<string, PresetModel>();
    return (presetId: string) => {
      const preset = data?.presets.presets.find((p) => p.id === presetId);
      if (!preset) return null;
      if (!cache.has(presetId)) cache.set(presetId, presetModel(preset));
      return cache.get(presetId)!;
    };
  }, [data]);

  const view = playerView(session, rounds, lastRound);
  const joinable = joinableRound(rounds, lastRound);

  const joinRound = (round: Round) => {
    const m = model(round.presetId);
    const outbreak = m?.preset.outbreaks.find((o) => o.id === round.outbreakId);
    if (!m || !outbreak) return;
    saveLastRound(round.id);
    setLastRound(round.id);
    setSession(startSession(m.preset, outbreak, round.budget, round.id));
  };

  // Drop a stored session that no longer fits the data (e.g. presets regenerated) or whose round is gone.
  useEffect(() => {
    if (!data || !session) return;
    const m = model(session.presetId);
    const ob = m?.preset.outbreaks.find((o) => o.id === session.outbreakId);
    if (!m || !ob || !isValidFor(session, m.preset, ob) || view.kind === 'stale') setSession(null);
  }, [data, session, model, view.kind]);

  // In the lobby, or just after a practice game, a newly opened round starts straight away.
  useEffect(() => {
    if (data && joinable && shouldAutoJoin(session, joinable, nickname)) joinRound(joinable);
  }, [data, joinable?.id, session, nickname]);

  // A finished round game is queued for submission (once per round).
  useEffect(() => {
    if (!api || !session || session.roundId === null || !isFinished(session)) return;
    if (submission?.play.roundId === session.roundId && submission.play.playerId === playerId) return;
    setSubmission(newSubmission(session, playerId, nickname));
  }, [api, session, submission, playerId, nickname]);

  const failures = useSubmitter(api, submission, setSubmission);
  usePresence(api, playerId, nickname, session);
  const resultsRound = view.kind === 'round-results' && view.round.status === 'closed' ? view.round : null;
  const roomPlays = useRoundPlays(api, resultsRound?.id ?? null);

  if (error) return <main className="message">Could not load the game: {error}</main>;
  if (!data) return <main className="message">Loading…</main>;

  const begin = (presetId: string, previousId: string | null, budget: number) => {
    const preset = data.presets.presets.find((p) => p.id === presetId)!;
    const outbreak = chooseOutbreak(preset, previousId);
    saveLastOutbreak(outbreak.id);
    setSession(startSession(preset, outbreak, budget));
  };
  const remember = (name: string) => {
    setNickname(name);
    saveNickname(name);
  };
  const backToLobby = () => setSession(null);
  const banner = (round: Round | null) =>
    round && (
      <div className="banner" data-testid="round-banner">
        <b>Round {round.number} has started.</b> Finish this game or
        <button className="primary" onClick={() => joinRound(round)}>Join now</button>
      </div>
    );

  const current = session && model(session.presetId);
  const outbreak = current?.preset.outbreaks.find((o) => o.id === session?.outbreakId);
  if (!session || !current || !outbreak || !isValidFor(session, current.preset, outbreak) || view.kind === 'start' || view.kind === 'stale') {
    const status = rounds === null ? 'Connecting to the game…' : 'Waiting for the presenter to start a round. Meanwhile, play a practice game.';
    return (
      <StartScreen
        presets={data.presets.presets}
        initialNickname={nickname}
        onStart={(name, presetId, budget) => {
          remember(name);
          begin(presetId, loadLastOutbreak(), budget);
        }}
        {...(api && {
          round: joinable,
          status,
          onJoin: (name: string) => {
            remember(name);
            if (joinable) joinRound(joinable);
          },
        })}
      />
    );
  }

  if (view.kind === 'round-missed') {
    return (
      <main className="message">
        <p>Round {view.round.number} has closed. Your game wasn't counted.</p>
        <button className="primary" onClick={backToLobby}>Back to the lobby</button>
      </main>
    );
  }
  if (view.kind === 'play') {
    const title = view.round ? `Round ${view.round.number}` : session.roundId !== null ? 'Round' : undefined;
    return (
      <PlayScreen
        key={`${session.roundId}/${session.presetId}/${session.outbreakId}`}
        model={current}
        outbreak={outbreak}
        session={session}
        nickname={nickname}
        title={title}
        banner={banner(view.banner)}
        onSessionChange={(update) => setSession((s) => (s ? update(s) : s))}
      />
    );
  }
  if (view.kind === 'round-results') {
    const closed = view.round.status === 'closed';
    return (
      <ResultsScreen
        model={current}
        outbreak={outbreak}
        session={session}
        bots={data.bots}
        title={`Round ${view.round.number} results`}
        showComparison={closed}
        notice={<RoundNotice round={view.round} model={current} outbreak={outbreak} playerId={playerId} submission={submission} failures={failures} plays={roomPlays} />}
        actions={closed && <button className="primary" onClick={backToLobby}>Back to the lobby</button>}
      />
    );
  }
  return (
    <ResultsScreen
      model={current}
      outbreak={outbreak}
      session={session}
      bots={data.bots}
      banner={banner(view.banner)}
      actions={
        <>
          <button className="primary" onClick={() => begin(session.presetId, session.outbreakId, session.budget)}>Play another outbreak</button>
          <button onClick={backToLobby}>{api ? 'Back to the lobby' : 'Change network or nickname'}</button>
        </>
      }
    />
  );
}
