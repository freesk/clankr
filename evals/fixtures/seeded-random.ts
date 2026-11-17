// A small seeded random source (mulberry32), so generated sample data is the
// same on every machine and every run.

export interface SeededRandom {
  /** A number in [0, 1). */
  next(): number;
  /** An integer in [minimum, maximum], both included. */
  integer(minimum: number, maximum: number): number;
  pick<T>(choices: readonly T[]): T;
  /** True with the given probability. */
  chance(probability: number): boolean;
}

export function seededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    integer: (minimum, maximum) => minimum + Math.floor(next() * (maximum - minimum + 1)),
    pick<T>(choices: readonly T[]): T {
      const choice = choices[Math.floor(next() * choices.length)];
      if (choice === undefined) throw new Error("pick needs at least one choice");
      return choice;
    },
    chance: (probability) => next() < probability,
  };
}

/** Rounds to cents, so currency values print without floating-point noise. */
export function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
