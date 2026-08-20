/**
 * Stable four-digit display code for a puzzle identity.
 * Replay actions carry the full seed/id, so the short code is a friendly
 * label rather than the lookup boundary.
 */
export function puzzleCode(identity) {
  let hash = 2166136261;
  for (const char of String(identity ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % 10000).padStart(4, '0');
}
