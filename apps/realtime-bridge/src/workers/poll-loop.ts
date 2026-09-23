/**
 * Shared poll loop for the workers in this directory.
 *
 * Every worker here was a bare `setInterval` at a fixed interval chosen for
 * the worst case - how fast it must react when there IS work. Nothing chose
 * the interval for the case that actually holds essentially always: no work
 * at all. Between them that was 46k queries a day against `messages`, whose
 * pending set has been empty for all but a handful of rows in the table's
 * history.
 *
 * So: poll at the fast interval while there is work, and back off toward a
 * ceiling while there is not. A worker under load behaves exactly as before;
 * an idle one collapses to its ceiling. The ceiling is the real knob - it is
 * the worst-case latency for the first item to arrive after a quiet stretch,
 * so each caller sets it against its own deadline rather than sharing one.
 *
 * Chained `setTimeout` rather than `setInterval`, which also fixes something
 * the old shape allowed: a tick slower than the interval used to overlap the
 * next one. The atomic claims made that safe but never useful - the second
 * tick just spent a round trip per row losing claims. Here the next tick is
 * scheduled when the previous one finishes, so ticks cannot overlap at all.
 */
export type PollTick = () => Promise<boolean>;

export interface PollLoopOptions {
  /** Log prefix, matching the worker's existing `[name]` convention. */
  name: string;
  /** Interval while a tick is finding work. The old fixed interval. */
  activeIntervalMs: number;
  /** Ceiling to back off to while ticks come back empty. */
  idleIntervalMs: number;
  /** Returns true when it found work, which holds the loop at the fast
   * interval. Returning false is what lets it back off. */
  tick: PollTick;
}

export function startPollLoop({
  name,
  activeIntervalMs,
  idleIntervalMs,
  tick,
}: PollLoopOptions): void {
  let delay = activeIntervalMs;

  const run = async (): Promise<void> => {
    try {
      // An empty tick and a failed one both back off. Backing off on failure
      // is deliberate: the failure modes here are a database that is down or
      // an AI provider that is refusing, and neither is helped by retrying at
      // full rate for as long as it lasts.
      const foundWork = await tick();
      delay = foundWork ? activeIntervalMs : Math.min(delay * 2, idleIntervalMs);
    } catch (err) {
      console.error(`[${name}] tick failed:`, err);
      delay = Math.min(delay * 2, idleIntervalMs);
    }
    setTimeout(() => void run(), delay);
  };

  console.log(
    `[${name}] polling every ${activeIntervalMs}ms, backing off to ${idleIntervalMs}ms when idle`,
  );
  setTimeout(() => void run(), activeIntervalMs);
}
