import { useState } from 'react';
import type { Preset } from '../../core/presets.ts';

export interface StartScreenProps {
  presets: Preset[];
  initialNickname: string;
  onStart: (nickname: string, presetId: string) => void;
}

export function StartScreen({ presets, initialNickname, onStart }: StartScreenProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === presetId);
  const name = nickname.trim();
  return (
    <main className="start">
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
      <div className="presets" role="radiogroup" aria-label="Network">
        {presets.map((p) => (
          <button key={p.id} role="radio" aria-checked={p.id === presetId} className={`preset-card${p.id === presetId ? ' selected' : ''}`} onClick={() => setPresetId(p.id)}>
            <b>{p.name}</b>
            <span className="muted">{p.n} locations · {p.defaultBudget} tests</span>
          </button>
        ))}
      </div>
      <button className="primary" disabled={name === '' || !preset} onClick={() => onStart(name, presetId)}>
        Play
      </button>
    </main>
  );
}
