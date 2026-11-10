// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickUntested, playToEnd, presetFile, stubData } from '../test/harness.ts';
import { App } from './App.tsx';
import { FakeRoundsApi } from './net/fake.ts';
import type { NewPlay, PresenceState } from './net/types.ts';
import type { Submission } from './player/flow.ts';
import { useSubmitter } from './player/hooks.ts';

const preset = presetFile.presets[0];
const roundOutbreak = preset.outbreaks.find((o) => o.split === 'round')!;
const cfg = { presetId: preset.id, outbreakId: roundOutbreak.id, budget: 3, rankMetric: 'auc' as const };
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== roundOutbreak.seedNode);

let api: FakeRoundsApi;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('sg.nickname', 'ada');
  stubData();
  api = new FakeRoundsApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = () => act(() => api.openRound('1234', cfg).then(() => undefined));
const close = (id = api.rounds.at(-1)!.id) => act(() => api.closeRound('1234', id));

describe('player in a presenter-led round', () => {
  it('waits in the lobby, joins when the round opens, submits, then sees their rank after close', async () => {
    let presence: PresenceState[] = [];
    api.onPresence((p) => (presence = p));
    render(<App api={api} />);
    expect((await screen.findByTestId('lobby-status')).textContent).toMatch(/Waiting for the presenter/);
    expect(presence).toMatchObject([{ nickname: 'ada', status: 'lobby' }]);

    await open();
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.getByTestId('tests-left').textContent).toBe('3 / 3');
    expect(presence).toMatchObject([{ status: 'playing', roundId: 1 }]);

    playToEnd();
    expect((await screen.findByText(/Result received/)).textContent).toMatch(/Waiting for the presenter/);
    expect(api.plays).toHaveLength(1);
    expect(api.plays[0]).toMatchObject({ nickname: 'ada', budget: 3, outbreakId: roundOutbreak.id });
    expect(presence).toMatchObject([{ status: 'finished', roundId: 1 }]);
    expect(within(screen.getByTestId('legend')).queryByText('LE')).toBeNull();

    await act(() => api.submitPlay({ ...api.plays[0], playerId: 'other', nickname: 'bob', picks: others.slice(10, 13) }));
    await close();
    expect(screen.getByTestId('round-notice').textContent).toMatch(/^#[12] of 2 · ranked by AUC$/);
    expect(within(screen.getByTestId('legend')).getByText('LE')).toBeTruthy();
    expect(within(screen.getByTestId('legend')).getByText('DC (degree, mean)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the lobby' }));
    expect(screen.getByTestId('lobby-status').textContent).toMatch(/Waiting for the presenter/);
  });

  it('offers to join from a practice game, and joining switches to the round', async () => {
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play a practice game' }));
    clickUntested();
    await open();
    expect(screen.getByTestId('round-banner').textContent).toMatch(/Round 1 has started/);
    fireEvent.click(screen.getByRole('button', { name: 'Join now' }));
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.queryByTestId('round-banner')).toBeNull();
  });

  it('a player without a nickname can join from the start screen', async () => {
    localStorage.removeItem('sg.nickname');
    render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    fireEvent.change(screen.getByPlaceholderText('e.g. ada'), { target: { value: 'cy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join round 1' }));
    expect(screen.getByText('Round 1')).toBeTruthy();
  });

  it('closing the round mid-game tells the player it was not counted', async () => {
    render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    clickUntested();
    await close();
    expect(screen.getByText(/Round 1 has closed. Your game wasn't counted./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the lobby' }));
    expect(screen.getByTestId('lobby-status')).toBeTruthy();
  });

  it('keeps retrying a submission while offline and delivers it when back online', async () => {
    render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    api.offline = true;
    playToEnd();
    expect(await screen.findByText(/Connection problem, retrying/)).toBeTruthy();
    api.offline = false;
    expect(await screen.findByText(/Result received/, undefined, { timeout: 4000 })).toBeTruthy();
    expect(api.plays).toHaveLength(1);
  });

  it('resumes a finished round game after a reload without submitting twice', async () => {
    const first = render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    playToEnd();
    await screen.findByText(/Result received/);
    first.unmount();
    render(<App api={api} />);
    expect(await screen.findByText(/Result received/)).toBeTruthy();
    expect(api.plays).toHaveLength(1);
  });
});

describe('useSubmitter', () => {
  it('starts a new submission without the previous one\'s backoff', async () => {
    const sent: number[] = [];
    api.offline = true;
    const submit = api.submitPlay.bind(api);
    api.submitPlay = (p: NewPlay) => (sent.push(p.roundId), submit(p));
    const sub = (roundId: number): Submission => ({
      state: 'pending',
      play: { ...cfg, roundId, playerId: 'p1', nickname: 'ada', picks: [1, 2, 3], usedPredictions: false, usedUncertainty: false },
    });
    const { result, rerender } = renderHook(({ s }) => useSubmitter(api, s, () => {}), { initialProps: { s: sub(1) } });
    await waitFor(() => expect(result.current).toBe(1));
    rerender({ s: sub(2) });
    expect(result.current).toBe(0);
    await waitFor(() => expect(sent).toContain(2), { timeout: 500 });
  });
});
