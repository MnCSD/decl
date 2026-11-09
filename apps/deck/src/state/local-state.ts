/** State that lives only on the tablet (the focus timer runs here, not on the PC; M5). */
export interface LocalState {
  focus: { remainingSec: number; totalSec: number; running: boolean };
}

export const INITIAL_LOCAL: LocalState = {
  focus: { remainingSec: 25 * 60, totalSec: 25 * 60, running: false },
};
