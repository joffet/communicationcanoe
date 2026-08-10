export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
};

function defaultIsRetryable(error: unknown): boolean {
  const status = (error as { status?: number; $metadata?: { httpStatusCode?: number } })?.status
    ?? (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return typeof status === "number" && (status === 429 || status >= 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential-backoff retry wrapper for outbound provider calls (Twilio, SES).
 * Throws the last error once retries are exhausted or isRetryable returns false.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries;
      if (isLastAttempt || !isRetryable(error)) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Twilio: rate-limit (20429) and network/5xx are retryable; invalid-number (21211 etc.) is not. */
export function isRetryableTwilioError(error: unknown): boolean {
  const code = (error as { code?: number }).code;
  if (code === 20429) return true;
  if (typeof code === "number") return false;
  return defaultIsRetryable(error);
}

/** SES: throttling and 5xx are retryable; validation/permanent-bounce-type errors are not. */
export function isRetryableSesError(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  if (name === "ThrottlingException" || name === "TooManyRequestsException") return true;
  if (name === "MessageRejected" || name === "MailFromDomainNotVerifiedException") return false;
  return defaultIsRetryable(error);
}
