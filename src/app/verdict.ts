export interface BotFinal {
  name: string;
  auc: number | null;
}

const r3 = (v: number) => Math.round(v * 1000);

function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** One-line comparison of the player's final AUC with the bots, at the 3 dp shown on screen. */
export function verdictText(you: number | null, bots: BotFinal[]): string {
  if (you === null) return 'AUC is undefined for this game (all untested locations had the same status).';
  const defined = bots.filter((b): b is { name: string; auc: number } => b.auc !== null && b.auc !== undefined);
  if (defined.length === 0) return 'No bot results to compare with on this outbreak.';
  const list = (bs: typeof defined) => joinWithAnd(bs.map((b) => `${b.name} (${b.auc.toFixed(3)})`));
  const level = defined.filter((b) => r3(b.auc) === r3(you));
  const above = defined.filter((b) => r3(you) > r3(b.auc));
  const below = defined.filter((b) => r3(you) < r3(b.auc));
  const parts = [
    level.length > 0 ? `level with ${list(level)}` : '',
    above.length > 0 ? `above ${list(above)}` : '',
    below.length > 0 ? `below ${list(below)}` : '',
  ].filter((p) => p !== '');
  return `On this outbreak you finished ${joinWithAnd(parts)}.`;
}
