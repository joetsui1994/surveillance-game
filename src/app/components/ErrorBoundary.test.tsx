// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.tsx';

afterEach(cleanup);

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('replaces a crashed tree with a message and a Start over button', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs caught errors
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong: kaboom/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });
});
