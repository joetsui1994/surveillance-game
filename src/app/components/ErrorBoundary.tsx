import { Component, type ReactNode } from 'react';
import { saveSession } from '../storage.ts';

/** Last line of defence during a live session: never leave a blank page; offer a clean restart. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="message">
        <p>Something went wrong: {this.state.error.message}</p>
        <button
          className="primary"
          onClick={() => {
            saveSession(null);
            location.reload();
          }}
        >
          Start over
        </button>
      </main>
    );
  }
}
