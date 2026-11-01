import { describe, expect, it } from 'vitest';
import { verdictText } from './verdict.ts';

const bots = [
  { name: 'LE', auc: 0.944 },
  { name: 'NE', auc: 0.955 },
  { name: 'Random', auc: 0.897 },
];

describe('verdictText', () => {
  it('groups bots into above / below', () => {
    expect(verdictText(0.925, bots)).toBe('On this outbreak you finished above Random (0.897) and below LE (0.944) and NE (0.955).');
  });

  it('compares at the displayed precision, so equal-looking scores are "level with"', () => {
    expect(verdictText(0.94449, bots)).toBe('On this outbreak you finished level with LE (0.944), above Random (0.897) and below NE (0.955).');
  });

  it('lists three or more names with commas and "and"', () => {
    expect(verdictText(0.99, bots)).toBe('On this outbreak you finished above LE (0.944), NE (0.955) and Random (0.897).');
  });

  it('handles an undefined player AUC and missing bot values', () => {
    expect(verdictText(null, bots)).toMatch(/AUC is undefined/);
    expect(verdictText(0.9, [{ name: 'LE', auc: null }])).toBe('No bot results to compare with on this outbreak.');
  });
});
