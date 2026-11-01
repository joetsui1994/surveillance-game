import { useEffect, useMemo, useState } from 'react';
import { presetModel, type PresetModel } from '../core/presets.ts';
import { chooseOutbreak, loadGameData, type GameData } from './data.ts';
import { isFinished, isValidFor, startSession, type Session } from './session.ts';
import { loadLastOutbreak, loadNickname, loadSession, saveLastOutbreak, saveNickname, saveSession } from './storage.ts';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { ResultsScreen } from './screens/ResultsScreen.tsx';
import { StartScreen } from './screens/StartScreen.tsx';

export function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(loadNickname);
  const [session, setSession] = useState<Session | null>(loadSession);

  useEffect(() => {
    loadGameData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => saveSession(session), [session]);

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

  // Drop a stored session that no longer fits the data (e.g. presets regenerated since it was saved).
  useEffect(() => {
    if (!data || !session) return;
    const m = model(session.presetId);
    const ob = m?.preset.outbreaks.find((o) => o.id === session.outbreakId);
    if (!m || !ob || !isValidFor(session, m.preset, ob)) setSession(null);
  }, [data, session, model]);

  if (error) return <main className="message">Could not load the game: {error}</main>;
  if (!data) return <main className="message">Loading…</main>;

  const begin = (presetId: string, previousId: string | null) => {
    const preset = data.presets.presets.find((p) => p.id === presetId)!;
    const outbreak = chooseOutbreak(preset, previousId);
    saveLastOutbreak(outbreak.id);
    setSession(startSession(preset, outbreak));
  };

  const current = session && model(session.presetId);
  const outbreak = current?.preset.outbreaks.find((o) => o.id === session?.outbreakId);
  if (!session || !current || !outbreak || !isValidFor(session, current.preset, outbreak)) {
    return (
      <StartScreen
        presets={data.presets.presets}
        initialNickname={nickname}
        onStart={(name, presetId) => {
          setNickname(name);
          saveNickname(name);
          begin(presetId, loadLastOutbreak());
        }}
      />
    );
  }
  if (!isFinished(session)) {
    return <PlayScreen key={`${session.presetId}/${session.outbreakId}`} model={current} outbreak={outbreak} session={session} nickname={nickname} onSessionChange={(update) => setSession((s) => (s ? update(s) : s))} />;
  }
  return (
    <ResultsScreen
      model={current}
      outbreak={outbreak}
      session={session}
      bots={data.bots}
      onPlayAgain={() => begin(session.presetId, session.outbreakId)}
      onChangeSettings={() => setSession(null)}
    />
  );
}
