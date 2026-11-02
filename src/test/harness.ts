// Shared helpers for jsdom tests that render the app against the real data files.
import { readFileSync } from 'node:fs';
import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { parsePresetFile } from '../core/presets.ts';

export const files: Record<string, string> = {
  'presets.json': readFileSync('public/data/presets.json', 'utf8'),
  'bots.json': readFileSync('public/data/bots.json', 'utf8'),
};
export const presetFile = parsePresetFile(JSON.parse(files['presets.json']));

/** Serve public/data from disk through a stubbed fetch. */
export function stubData(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = files[url.split('/').pop()!];
    return { ok: body !== undefined, status: body ? 200 : 404, json: async () => JSON.parse(body) };
  }));
}

const isTestedFill = (el: Element) => el.getAttribute('data-fill') === '#c62828' || el.getAttribute('data-fill') === '#1565c0';

/** Click the first untested node. */
export function clickUntested(): void {
  fireEvent.click(screen.getAllByTestId(/^node-/).find((el) => !isTestedFill(el))!);
}

/** Click untested nodes (lowest index first) until the game ends. */
export function playToEnd(): void {
  while (screen.queryByTestId('tests-left')) clickUntested();
}
