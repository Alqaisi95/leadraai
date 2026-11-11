/**
 * Run work after the response has been sent.
 *
 * A thin wrapper over Next's `after`, for one reason: `after` throws when
 * there is no request scope, which is exactly the situation in the API tests —
 * they call route handlers directly. Callers here use background work as an
 * accelerator, never as the only path (the queue's cron drain is the
 * guarantee), so "could not schedule" is a result to report, not an error.
 *
 * Returns whether the task was scheduled.
 */
import { after } from "next/server";

export function afterResponse(task: () => Promise<unknown>): boolean {
  try {
    after(task);
    return true;
  } catch {
    return false;
  }
}
