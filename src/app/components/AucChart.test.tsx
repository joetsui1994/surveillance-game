// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AucChart, type ChartSeries } from './AucChart.tsx';

afterEach(cleanup);

const series: ChartSeries[] = [
  { key: 'le', name: 'LE', short: 'LE', color: '#008300', width: 2, values: [0.5, 0.7, 0.9] },
  { key: 'you', name: 'You', short: 'You', color: '#0b0b0b', width: 3, values: [0.5, 0.6, 0.8] },
];
const opacity = (key: string) => screen.getByTestId(`series-${key}`).getAttribute('opacity');

describe('AucChart', () => {
  it('highlights a line while its legend entry or end label is hovered', () => {
    render(<AucChart series={series} background={[[0.5, 0.55, 0.6]]} />);
    expect(opacity('le')).toBe('1');
    expect(opacity('you')).toBe('1');

    fireEvent.mouseEnter(screen.getByTestId('legend-le'));
    expect(opacity('le')).toBe('1');
    expect(opacity('you')).toBe('0.2');
    fireEvent.mouseLeave(screen.getByTestId('legend-le'));
    expect(opacity('you')).toBe('1');

    fireEvent.mouseEnter(screen.getByTestId('label-you'));
    expect(opacity('le')).toBe('0.2');
    expect(opacity('you')).toBe('1');
  });
});
