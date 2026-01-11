// @file packages/vfs-sync/src/utils/vectorClock.ts

import { VectorClock } from '../types';

export type ClockRelation = 'equal' | 'concurrent' | 'descendant' | 'ancestor';

export function incrementClock(clock: VectorClock, peerId: string): VectorClock {
  return {
    ...clock,
    [peerId]: (clock[peerId] || 0) + 1
  };
}

export function mergeClock(local: VectorClock, remote: VectorClock): VectorClock {
  const merged: VectorClock = { ...local };
  for (const [peer, counter] of Object.entries(remote)) {
    merged[peer] = Math.max(merged[peer] || 0, counter);
  }
  return merged;
}

export function compareClock(clock1: VectorClock, clock2: VectorClock): ClockRelation {
  const allPeers = new Set([...Object.keys(clock1), ...Object.keys(clock2)]);
  let hasGreater = false;
  let hasLess = false;

  for (const peer of allPeers) {
    const c1 = clock1[peer] || 0;
    const c2 = clock2[peer] || 0;
    if (c1 > c2) hasGreater = true;
    if (c1 < c2) hasLess = true;
  }

  if (!hasGreater && !hasLess) return 'equal';
  if (hasGreater && !hasLess) return 'descendant'; // clock1 is newer
  if (!hasGreater && hasLess) return 'ancestor';   // clock1 is older
  return 'concurrent';
}
