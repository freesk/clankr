// Stops waiting on an event stream the moment a signal aborts, even if the producer is
// slow to notice. Ctrl+C must return to the prompt at once (CLI-5).

export async function* untilAborted<Item>(
  source: AsyncIterable<Item>,
  signal: AbortSignal,
): AsyncGenerator<Item> {
  const iterator = source[Symbol.asyncIterator]();
  const aborted = new Promise<"aborted">((resolve) => {
    if (signal.aborted) resolve("aborted");
    else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next === "aborted" || next.done) return;
      yield next.value;
    }
  } finally {
    // Let the producer clean up in the background; a stuck producer must not block the prompt.
    void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}
