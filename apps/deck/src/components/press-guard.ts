/**
 * Stops a drag from also counting as a tap.
 * When a swipe (page swipe or value-key adjust) takes over a touch, React Native
 * normally cancels the key's press, but the browser preview can still deliver a
 * click on release. Gestures call `blockPresses()`; Keycap checks `pressesBlocked()`.
 */
let blockedUntil = 0;

const AFTER_DRAG_MS = 350;

/** Call while a drag is active and again when it ends. */
export function blockPresses(): void {
  blockedUntil = Date.now() + AFTER_DRAG_MS;
}

export function pressesBlocked(): boolean {
  return Date.now() < blockedUntil;
}
