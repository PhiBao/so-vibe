/**
 * Sanitize errors returned from API routes.
 *
 * Validation errors can include the original message.
 * Unexpected/internal errors are logged and replaced with a generic message.
 */

export function sanitizeError(err: unknown, isValidation = false): string {
  if (isValidation && err instanceof Error) {
    return err.message;
  }
  if (err instanceof Error) {
    // eslint-disable-next-line no-console
    console.error("[API Error]", err);
  }
  return "Internal server error";
}
