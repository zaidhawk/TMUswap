// Postgres error code for "duplicate key value violates unique constraint".
const UNIQUE_VIOLATION = "23505";

// Drizzle wraps database errors, so the Postgres code is on err.cause.
export function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === UNIQUE_VIOLATION;
}
