// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { files, playToEnd, stubData } from '../test/harness.ts';
import { App } from './App.tsx';

beforeEach(() => {
  localStorage.clear();
  stubData();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('plays a full game from start screen to results', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(screen.getByTestId('tests-left').textContent).toBe('10 / 10');
    fireEvent.click(screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') === '#e8e8e8')!);
    expect(screen.getByTestId('tests-left').textContent).toBe('9 / 10');

    playToEnd();
    expect(screen.getByText('AUC')).toBeTruthy();
    expect(screen.getByTestId('score-auc').textContent).toMatch(/^0\.\d{3}$|^–$/);
    const legend = screen.getByTestId('legend');
    for (const name of ['You', 'LE', 'NE', 'Random: average, and range of 90% of runs']) expect(within(legend).getByText(name)).toBeTruthy();
    expect(screen.getByTestId('verdict').textContent).toMatch(/On this outbreak you finished|undefined/);
  });

  it('starts a practice game with the chosen number of tests, and keeps it for the next outbreak', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Many · 20 tests' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByTestId('tests-left').textContent).toBe('20 / 20');
    playToEnd();
    fireEvent.click(screen.getByRole('button', { name: 'Play another outbreak' }));
    expect(screen.getByTestId('tests-left').textContent).toBe('20 / 20');
  });

  it('counts every click even when several land before a re-render, and ignores repeats', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const untested = screen.getAllByTestId(/^node-/).filter((el) => el.getAttribute('data-fill') === '#e8e8e8').slice(0, 3);
    act(() => {
      for (const el of untested) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      untested[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(screen.getByTestId('tests-left').textContent).toBe('7 / 10');
  });

  it('turning on uncertainty also turns on predictions and shades nodes', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByLabelText(/Uncertainty/));
    expect((screen.getByLabelText(/Predictions/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByTestId(/^node-/).some((el) => el.getAttribute('data-fill')!.startsWith('rgb('))).toBe(true);
  });

  it('resumes an in-progress game after a reload', async () => {
    const first = render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') === '#e8e8e8')!);
    first.unmount();

    render(<App />);
    expect((await screen.findByTestId('tests-left')).textContent).toBe('9 / 10');
  });

  it('discards a stored session that no longer matches the data, instead of crashing', async () => {
    const preset = JSON.parse(files['presets.json']).presets[0];
    const ob = preset.outbreaks[0];
    const stale = { presetId: preset.id, outbreakId: ob.id, budget: 10, seedNode: (ob.seedNode + 1) % preset.n, picks: [], usedPredictions: false, usedUncertainty: false };
    localStorage.setItem('sg.session', JSON.stringify(stale));
    render(<App />);
    expect(await screen.findByPlaceholderText('e.g. ada')).toBeTruthy();
  });

  it('hover box only reveals what the switched-on overlays show', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const node = screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') === '#e8e8e8')!;
    fireEvent.mouseEnter(node);
    const box = screen.getByTestId('hover-box');
    expect(box.textContent).not.toMatch(/P\(infected\)/);
    fireEvent.click(screen.getByLabelText(/Predictions/));
    expect(box.textContent).toMatch(/P\(infected\) ≈ \d\.\d\d/);
    expect(box.textContent).not.toMatch(/±|rank/);
    fireEvent.click(screen.getByLabelText(/Uncertainty/));
    expect(box.textContent).toMatch(/±/);
    expect(box.textContent).toMatch(/Uncertainty rank/);
  });

  it('keeps the colour explainer closed until asked for', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.queryByTestId('explainer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'What do the colours mean?' }));
    expect(screen.getByTestId('explainer').textContent).toMatch(/Orange rings/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('explainer')).toBeNull();
  });

  it('never mentions the paper in the interface', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    expect(document.body.textContent).not.toMatch(/paper|Tsui/i);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    playToEnd();
    expect(document.body.textContent).not.toMatch(/paper|Tsui/i);
  });

  it('starts the game when Enter is pressed in the nickname field', async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText('e.g. ada');
    fireEvent.change(input, { target: { value: 'ada' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByTestId('tests-left')).toBeTruthy();
  });

  it('shows an error if the data cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    render(<App />);
    expect(await screen.findByText(/Could not load the game/)).toBeTruthy();
  });
});
