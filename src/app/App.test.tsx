// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

const files: Record<string, string> = {
  'presets.json': readFileSync('public/data/presets.json', 'utf8'),
  'bots.json': readFileSync('public/data/bots.json', 'utf8'),
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = files[url.split('/').pop()!];
    return { ok: body !== undefined, status: body ? 200 : 404, json: async () => JSON.parse(body) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Click untested nodes (lowest index first) until the game ends. */
function playToEnd() {
  for (;;) {
    const left = screen.queryByTestId('tests-left');
    if (!left) return;
    const untested = screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') !== '#c62828' && el.getAttribute('data-fill') !== '#1565c0')!;
    fireEvent.click(untested);
  }
}

describe('App', () => {
  it('plays a full game from start screen to results', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(screen.getByTestId('tests-left').textContent).toBe('10 / 10');
    fireEvent.click(screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') === '#e8e8e8')!);
    expect(screen.getByTestId('tests-left').textContent).toBe('9 / 10');

    playToEnd();
    expect(screen.getByText('AUC (paper metric)')).toBeTruthy();
    expect(screen.getByTestId('score-auc').textContent).toMatch(/^0\.\d{3}$|^–$/);
    const legend = screen.getByTestId('legend');
    for (const name of ['You', 'LE (paper)', 'NE', 'Random (mean, 90% band)']) expect(within(legend).getByText(name)).toBeTruthy();
    expect(screen.getByTestId('verdict').textContent).toMatch(/On this outbreak you finished|undefined/);
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

  it('shows an error if the data cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    render(<App />);
    expect(await screen.findByText(/Could not load the game/)).toBeTruthy();
  });
});
