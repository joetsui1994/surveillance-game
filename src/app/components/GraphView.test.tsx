// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridEdges, makeGraph } from '../../core/graph.ts';
import { COLORS, predictionColor } from '../scales.ts';
import { GraphView } from './GraphView.tsx';

afterEach(cleanup);

const graph = makeGraph(9, gridEdges(3, 3));
const layout = Array.from({ length: 9 }, (_, i) => [(i % 3) / 2, Math.floor(i / 3) / 2] as [number, number]);
const base = { graph, layout, tested: new Map<number, 0 | 1>([[4, 1]]), predictions: null, uncertainty: null, hovered: null, onHover: () => {} };

describe('GraphView', () => {
  it('draws every node, colouring tested nodes by result and others neutral', () => {
    render(<GraphView {...base} />);
    expect(screen.getByTestId('node-4').getAttribute('data-fill')).toBe(COLORS.infected);
    expect(screen.getByTestId('node-0').getAttribute('data-fill')).toBe(COLORS.unknown);
    expect(screen.getAllByTestId(/^node-/)).toHaveLength(9);
  });

  it('shades untested nodes by prediction when predictions are on', () => {
    const p = [0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.4];
    render(<GraphView {...base} predictions={p} />);
    expect(screen.getByTestId('node-0').getAttribute('data-fill')).toBe(predictionColor(0.6));
    expect(screen.getByTestId('node-8').getAttribute('data-fill')).toBe(predictionColor(0.4));
  });

  it('calls onPick for untested nodes only', () => {
    const onPick = vi.fn();
    render(<GraphView {...base} onPick={onPick} />);
    fireEvent.click(screen.getByTestId('node-0'));
    fireEvent.click(screen.getByTestId('node-4'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it('reports hover and shows ✕ on wrongly predicted nodes in results mode', () => {
    const onHover = vi.fn();
    render(<GraphView {...base} onHover={onHover} truth={[0, 0, 0, 0, 1, 0, 0, 0, 1]} wrong={new Set([8])} />);
    fireEvent.mouseEnter(screen.getByTestId('node-2'));
    expect(onHover).toHaveBeenCalledWith(2);
    expect(screen.getByTestId('wrong-8')).toBeTruthy();
    expect(screen.getByTestId('node-8').getAttribute('data-fill')).toBe(COLORS.truthInfected);
  });

  it('on hover, highlights only the node and its own edges, and fades nothing', () => {
    render(<GraphView {...base} hovered={0} />);
    const edge = (a: number, b: number) => screen.getByTestId(`edge-${a}-${b}`);
    expect(edge(0, 1).getAttribute('stroke')).toBe(COLORS.ink);
    expect(edge(0, 3).getAttribute('stroke')).toBe(COLORS.ink);
    expect(edge(4, 5).getAttribute('stroke')).toBe(COLORS.edge);
    expect(screen.getByTestId('node-0').getAttribute('stroke-width')).toBe('3.5');
    expect(screen.getByTestId('node-1').getAttribute('stroke-width')).toBe('0.8');
    expect(document.querySelector('[opacity="0.25"]')).toBeNull();
  });
});
