/** The single clock seam used by GroupGuard's expiry and rate checks. */
let currentNow = () => Date.now();

export function now(): number {
  return currentNow();
}

/** Test-only override. Production code always uses the system clock. */
export function _setNowForTests(clock: () => number): void {
  currentNow = clock;
}

