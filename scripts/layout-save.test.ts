import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLayoutFile, requestError, saveLayoutFile } from './layout-save.ts';

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

describe('readLayoutFile', () => {
  it('returns the saved file', () => {
    expect(readLayoutFile(dirWithLayout(), 'net1')).toEqual({ id: 'net1', edges: [[0, 1]], layout: [[0, 0], [1, 1]], source: 'search:kk' });
  });

  it('refuses bad and unknown ids', () => {
    const dir = dirWithLayout();
    expect(() => readLayoutFile(dir, '../net1')).toThrow(/bad id/);
    expect(() => readLayoutFile(dir, 'net2')).toThrow(/no layout/);
  });
});

describe('requestError', () => {
  const json = { 'content-type': 'application/json', host: 'localhost:5173' };
  it('accepts same-origin requests and JSON posts', () => {
    expect(requestError('GET', { host: 'localhost:5173' })).toBeNull();
    expect(requestError('POST', json)).toBeNull();
    expect(requestError('POST', { ...json, 'content-type': 'application/json; charset=utf-8', origin: 'http://localhost:5173' })).toBeNull();
    expect(requestError('GET', { host: 'localhost:5173', origin: 'https://localhost:5173' })).toBeNull();
  });

  it('refuses posts that are not JSON with 415', () => {
    expect(requestError('POST', { host: 'localhost:5173' })?.status).toBe(415);
    expect(requestError('POST', { ...json, 'content-type': 'text/plain' })?.status).toBe(415);
  });

  it('refuses other origins with 403', () => {
    expect(requestError('POST', { ...json, origin: 'http://evil.example' })?.status).toBe(403);
    expect(requestError('GET', { host: 'localhost:5173', origin: 'http://localhost:5174' })?.status).toBe(403);
  });
});
