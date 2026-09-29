/**
 * Retries a bookkeeping write that follows a send the provider has already
 * accepted.
 *
 * Only for that case. Before the send, a failed write should simply fail the
 * send. After it, the message is out - a write that loses to a momentary
 * database fault (2026-09-28: the cluster ran out of connection slots mid-
 * Notice) must not end with the row saying "failed", because reside reads that
 * row and offers to send the email again.
 */
export async function recordWithRetry<T>(
  write: () => Promise<T>,
  delaysMs: readonly number[] = [250, 1_000, 3_000],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= delaysMs.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/**
 * An error as a short, useful line.
 *
 * Drizzle wraps every driver error as "Failed query: <the whole statement>
 * params: ..." and keeps the actual reason on `cause`, so the message alone is
 * several hundred characters that never say what went wrong.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : undefined;
  if (!cause) return error.message;
  const summary = error.message.split("\n")[0].slice(0, 120);
  return `${cause} (${summary})`;
}
