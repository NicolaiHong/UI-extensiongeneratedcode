/**
 * Extract a human-readable message from Axios errors or generic exceptions.
 * Checks for backend `{ error: { message } }` shape first, then falls back to Error.message.
 */
export function extractApiError(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (error && typeof error === "object") {
    const e = error as Record<string, any>;
    const apiMsg = e.response?.data?.error?.message;
    if (typeof apiMsg === "string" && apiMsg) {
      return apiMsg;
    }
    if (typeof e.message === "string" && e.message) {
      return e.message;
    }
  }
  return fallback;
}
