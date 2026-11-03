import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveLayoutFile } from './layout-save.ts';

function dirWithLayout() {
  const dir = mkdtempSync(join(tmpdir(), 'layouts-'));
  writeFileSync(join(dir, 'net1.json'), JSON.stringify({ id: 'net1', edges: [[0, 1]], layout: [[0, 0], [1, 1]], source: 'search:kk' }));
  return dir;
}

describe('saveLayoutFile', () => {
  it('replaces positions, keeps edges and marks the file edited', () => {
    const dir = dirWithLayout();
    saveLayoutFile(dir, { id: 'net1', layout: [[0.123456, 0.5], [1, 0]] });
    expect(JSON.parse(readFileSync(join(dir, 'net1.json'), 'utf8'))).toEqual({ id: 'net1', edges: [[0, 1]], layout: [[0.1235, 0.5], [1, 0]], source: 'edited' });
  });

  it('refuses path tricks, unknown ids and malformed layouts', () => {
    const dir = dirWithLayout();
    expect(() => saveLayoutFile(dir, { id: '../net1', layout: [[0, 0], [1, 1]] })).toThrow(/bad id/);
    expect(() => saveLayoutFile(dir, { id: 'net2', layout: [[0, 0], [1, 1]] })).toThrow(/no layout/);
    expect(() => saveLayoutFile(dir, { id: 'net1', layout: [[0, 0]] })).toThrow(/one \[x, y\]/);
    expect(() => saveLayoutFile(dir, { id: 'net1', layout: [[0, 0], [1, 2]] })).toThrow(/one \[x, y\]/);
  });
});
