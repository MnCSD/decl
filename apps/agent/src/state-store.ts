import type { DeckState } from '@deck/protocol';

type Listener = (state: DeckState) => void;

/** Holds the current DeckState and notifies listeners when it actually changes. */
export class StateStore {
  private state: DeckState;
  private listeners = new Set<Listener>();

  constructor(initial: DeckState) {
    this.state = initial;
  }

  get(): DeckState {
    return this.state;
  }

  set<K extends keyof DeckState>(key: K, value: DeckState[K]): void {
    // Skip no-op updates so we don't spam the tablet with identical snapshots.
    if (JSON.stringify(this.state[key]) === JSON.stringify(value)) return;
    this.state = { ...this.state, [key]: value };
    for (const listener of this.listeners) listener(this.state);
  }

  update<K extends keyof DeckState>(key: K, fn: (current: DeckState[K]) => DeckState[K]): void {
    this.set(key, fn(this.state[key]));
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
