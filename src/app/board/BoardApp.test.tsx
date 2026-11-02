// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presetFile, stubData } from '../../test/harness.ts';
import { FakeRoundsApi } from '../net/fake.ts';
import type { NewPlay, PresenceState, Round } from '../net/types.ts';
import { isBoardRoute } from '../Root.tsx';
import { BoardApp, boardPhase, joinUrl } from './BoardApp.tsx';

const preset = presetFile.presets[0];
const roundOutbreaks = preset.outbreaks.filter((o) => o.split === 'round');
const ob = roundOutbreaks[0];
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== ob.seedNode);

let api: FakeRoundsApi;
beforeEach(() => {
  sessionStorage.clear();
  stubData();
  api = new FakeRoundsApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const play = (id: string, nickname: string, picks: number[]): NewPlay => ({
  roundId: api.rounds.at(-1)!.id, presetId: preset.id, outbreakId: ob.id, budget: preset.defaultBudget, playerId: id, nickname, picks,
  usedPredictions: id === 'p1', usedUncertainty: false,
});

describe('helpers', () => {
  it('routes, join URL and phases', () => {
    expect(isBoardRoute('#/board')).toBe(true);
    expect(isBoardRoute('#/board/')).toBe(true);
    expect(isBoardRoute('#/')).toBe(false);
    expect(joinUrl('https://x.github.io/surveillance-game/#/board')).toBe('https://x.github.io/surveillance-game/');
    const r = { id: 3, number: 3, presetId: 'g', outbreakId: 'o', budget: 1, rankMetric: 'auc' as const, openedAt: '', closedAt: null };
    expect(boardPhase(null, null)).toBe('lobby');
    expect(boardPhase({ ...r, status: 'open' }, null)).toBe('live');
    expect(boardPhase({ ...r, status: 'closed' }, null)).toBe('results');
    expect(boardPhase({ ...r, status: 'closed' }, 3)).toBe('lobby');
  });
});

describe('BoardApp', () => {
  it('says so when multiplayer is not configured', () => {
    render(<BoardApp api={null} />);
    expect(screen.getByText(/Multiplayer is not configured/)).toBeTruthy();
  });

  it('runs a round: lobby → presenter opens → live count → close → leaderboard, bots, replay, hide', async () => {
    render(<BoardApp api={api} />);
    await screen.findByTestId('qr');
    act(() => void api.joinPresence({ playerId: 'p1', nickname: 'ada', status: 'lobby', roundId: null }));
    act(() => void api.joinPresence({ playerId: 'p2', nickname: 'bob', status: 'lobby', roundId: null }));
    expect(screen.getByTestId('joined-count').textContent).toBe('2');

    // Presenter unlocks the drawer with P and opens round 1 on the first round outbreak.
    fireEvent.keyDown(window, { key: 'p' });
    const drawer = screen.getByTestId('drawer');
    fireEvent.change(within(drawer).getByLabelText('PIN'), { target: { value: '0000' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Unlock' }));
    expect(await within(drawer).findByText('Wrong PIN')).toBeTruthy();
    fireEvent.change(within(drawer).getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Unlock' }));
    const open = await within(drawer).findByRole('button', { name: 'Open round 1' });
    expect((within(drawer).getByLabelText('Outbreak') as HTMLSelectElement).value).toBe(ob.id);
    await act(async () => fireEvent.click(open));
    expect(api.rounds).toMatchObject([{ number: 1, outbreakId: ob.id, budget: preset.defaultBudget, status: 'open' }]);
    expect((within(drawer).getByLabelText('Outbreak') as HTMLSelectElement).value).toBe(roundOutbreaks[1].id);

    act(() => {
      api.joinPresence({ playerId: 'p1', nickname: 'ada', status: 'playing', roundId: 1 });
      api.joinPresence({ playerId: 'p2', nickname: 'bob', status: 'playing', roundId: 1 });
    });
    expect(screen.getByTestId('finished-count').textContent).toBe('0 / 2 finished');
    await act(() => api.submitPlay(play('p1', 'ada', others.slice(0, preset.defaultBudget))));
    expect(screen.getByTestId('finished-count').textContent).toBe('1 / 2 finished');
    expect(screen.queryByTestId('leaderboard')).toBeNull();
    await act(() => api.submitPlay(play('p2', 'ada', others.slice(50, 50 + preset.defaultBudget))));
    expect(screen.getByTestId('finished-count').textContent).toBe('2 / 2 finished');

    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Close round 1' })));
    const board = screen.getByTestId('leaderboard');
    expect(within(board).getByText('ada')).toBeTruthy();
    expect(within(board).getByText('ada (2)')).toBeTruthy();
    expect(within(board).queryByText('LE')).toBeNull();
    expect(within(board).getByText('Looked at')).toBeTruthy();
    expect(within(board).getAllByText('predictions')).toHaveLength(1); // only ada used predictions
    expect(document.body.textContent).not.toMatch(/🎨|◎|🤖/);
    expect(screen.queryByRole('tab')).toBeNull(); // no "First tests" switch: curves only

    fireEvent.click(within(drawer).getByLabelText('Reveal bots'));
    expect(within(screen.getByTestId('leaderboard')).getByText('LE')).toBeTruthy();
    expect(within(screen.getByTestId('leaderboard')).getByText('Random (mean)')).toBeTruthy();
    expect(within(screen.getByTestId('row-bot-LE')).getByText('bot')).toBeTruthy();

    // Replay ada's game.
    fireEvent.click(within(screen.getByTestId('leaderboard')).getByText('ada'));
    expect(screen.getByTestId('replay-step').textContent).toBe(`Test 0 of ${preset.defaultBudget}`);
    expect(screen.getByTestId('commentary').textContent).toMatch(/^Start:/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('commentary').textContent).toMatch(/^Test 1: location \d+/);
    expect(screen.getByTestId(`order-${others[0]}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(screen.getByTestId('replay-step').textContent).toBe(`Test ${preset.defaultBudget} of ${preset.defaultBudget}`);
    fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));

    // Moderation: ✕ buttons only while the drawer is open; hide "ada (2)".
    fireEvent.click(within(drawer).getByRole('button', { name: 'Hide drawer' }));
    expect(screen.queryByRole('button', { name: 'Hide ada (2)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Presenter controls (P)' }));
    // A failed request (not a wrong PIN) keeps the drawer unlocked so the presenter can try again.
    const hidePlay = api.hidePlay.bind(api);
    api.hidePlay = () => Promise.reject(new Error('Failed to fetch'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Hide ada (2)' })));
    expect(within(drawer).getByRole('button', { name: 'Lock' })).toBeTruthy();
    api.hidePlay = hidePlay;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Hide ada (2)' })));
    expect(api.plays.find((p) => p.playerId === 'p2')?.hidden).toBe(true);
    expect(within(screen.getByTestId('leaderboard')).queryByText('ada (2)')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to lobby' }));
    expect(screen.getByTestId('qr')).toBeTruthy();
    expect(within(screen.getByTestId('drawer')).getByRole('button', { name: 'Open round 2' })).toBeTruthy();
  });

  const unlock = async () => {
    fireEvent.keyDown(window, { key: 'p' });
    const drawer = screen.getByTestId('drawer');
    fireEvent.change(within(drawer).getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Unlock' }));
    await within(drawer).findByRole('button', { name: 'Open round 1' });
    return drawer;
  };

  it('keeps the drawer settings while it is hidden', async () => {
    render(<BoardApp api={api} />);
    await screen.findByTestId('qr');
    const drawer = await unlock();
    fireEvent.change(within(drawer).getByLabelText('Budget (tests)'), { target: { value: '7' } });
    fireEvent.change(within(drawer).getByLabelText('Rank by'), { target: { value: 'accuracy' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Hide drawer' }));
    expect(screen.queryByRole('button', { name: 'Open round 1' })).toBeNull();
    fireEvent.keyDown(window, { key: 'p' });
    expect((within(screen.getByTestId('drawer')).getByLabelText('Budget (tests)') as HTMLInputElement).value).toBe('7');
    expect((within(screen.getByTestId('drawer')).getByLabelText('Rank by') as HTMLSelectElement).value).toBe('accuracy');
  });

  it('treats a round it opened as open before the live list catches up, and reports round_open inline', async () => {
    // Freeze the board's view of the rounds after the first load (a slow or dropped connection).
    let frozen = false;
    const onRounds = api.onRounds.bind(api);
    api.onRounds = (cb: (r: Round[]) => void) => onRounds((r) => !frozen && cb(r));
    render(<BoardApp api={api} />);
    await screen.findByTestId('qr');
    const drawer = await unlock();
    frozen = true;
    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Open round 1' })));
    expect(api.rounds).toHaveLength(1);
    expect((within(drawer).getByRole('button', { name: 'Open round 2' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Close round 1' })));
    expect(api.rounds[0].status).toBe('closed');

    // Someone else opened a round the board hasn't seen yet: the database refuses, and the drawer says why.
    frozen = false;
    await act(() => api.closeRound('1234', 1));
    frozen = true;
    await act(() => api.openRound('1234', { presetId: preset.id, outbreakId: ob.id, budget: 3, rankMetric: 'auc' }).then(() => undefined));
    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Open round 2' })));
    expect(within(drawer).getByText(/already open/)).toBeTruthy();
    expect(api.rounds).toHaveLength(2);
  });

  it('reloads the plays when the round closes', async () => {
    const onPlays = vi.spyOn(api, 'onPlays');
    render(<BoardApp api={api} />);
    await act(() => api.openRound('1234', { presetId: preset.id, outbreakId: ob.id, budget: 3, rankMetric: 'auc' }).then(() => undefined));
    const before = onPlays.mock.calls.length;
    await act(() => api.closeRound('1234', 1));
    expect(onPlays.mock.calls.length).toBeGreaterThan(before);
    expect(onPlays.mock.calls.at(-1)?.[0]).toBe(1);
  });

  it('shows only well-formed presence entries, with nicknames clamped to 24 characters', async () => {
    render(<BoardApp api={api} />);
    await screen.findByTestId('qr');
    act(() => {
      api.joinPresence({ playerId: 'p1', nickname: `  ${'x'.repeat(30)}  `, status: 'lobby', roundId: null });
      api.joinPresence({ playerId: 'p2', nickname: 'eve', status: 'admin', roundId: null } as unknown as PresenceState);
    });
    expect(screen.getByTestId('joined-count').textContent).toBe('1');
    expect(screen.getByText('x'.repeat(24))).toBeTruthy();
    expect(screen.queryByText('eve')).toBeNull();
  });
});
