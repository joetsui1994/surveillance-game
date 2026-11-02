import { useState } from 'react';
import type { Preset } from '../../core/presets.ts';
import type { Round } from '../net/types.ts';

export interface StartScreenProps {
  presets: Preset[];
  initialNickname: string;
  onStart: (nickname: string, presetId: string) => void;
  /** Multiplayer: a round the player can join now. */
  round?: Round | null;
  onJoin?: (nickname: string) => void;
  /** Multiplayer: a line about the live session, e.g. "Waiting for the presenter…". */
  status?: string;
}

export function StartScreen({ presets, initialNickname, onStart, round = null, onJoin, status }: StartScreenProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === presetId);
  const name = nickname.trim();
  const multiplayer = onJoin !== undefined;
  return (
    <form
      className="start"
      onSubmit={(e) => {
        e.preventDefault();
        if (name === '') return;
        if (round && onJoin) onJoin(name);
        else if (preset) onStart(name, presetId);
      }}
    >
      <h1>Surveillance Game</h1>
      <p className="lead">
        An outbreak is spreading across a network of locations. You have <b>{preset?.defaultBudget ?? 'a few'} tests</b>. One
        starting location is already tested. Choose where to test next, and a model maps the rest. Your score is the model's
        AUC on the locations you didn't test, as in Tsui et al. (2024).
      </p>
      <label className="field">
        Nickname
        <input value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. ada" />
      </label>
      {round ? (
        <div className="lobby-status live" data-testid="lobby-status">
          <b>Round {round.number} is open.</b>
          <button type="submit" className="primary" disabled={name === ''}>
            Join round {round.number}
          </button>
        </div>
      ) : (
        status && <div className="lobby-status" data-testid="lobby-status">{status}</div>
      )}
      <div className="presets" role="radiogroup" aria-label="Network">
        {presets.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === presetId} className={`preset-card${p.id === presetId ? ' selected' : ''}`} onClick={() => setPresetId(p.id)}>
            <b>{p.name}</b>
            <span className="muted">{p.n} locations · {p.defaultBudget} tests</span>
          </button>
        ))}
      </div>
      {multiplayer ? (
        <button type="button" className={round ? '' : 'primary'} disabled={name === '' || !preset} onClick={() => preset && onStart(name, presetId)}>
          Play a practice game
        </button>
      ) : (
        <button type="submit" className="primary" disabled={name === '' || !preset}>
          Play
        </button>
      )}
    </form>
  );
}
