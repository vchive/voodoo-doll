import type { SessionResponse } from './play-api';

export type ConfirmedView = Pick<SessionResponse, 'snapshot' | 'profile'>;

/** A retried confirmation can return an older, durable receipt. Never rewind
 * a newer state already known for that world, even if refreshing it fails. */
export function latestConfirmedView(
  receipt: ConfirmedView,
  known?: ConfirmedView | null,
  refreshed?: ConfirmedView | null,
): ConfirmedView {
  let latest = receipt;
  for (const candidate of [known, refreshed]) {
    if (candidate && candidate.snapshot.worldId === receipt.snapshot.worldId
      && candidate.snapshot.worldVersion >= latest.snapshot.worldVersion) latest = candidate;
  }
  return latest;
}
