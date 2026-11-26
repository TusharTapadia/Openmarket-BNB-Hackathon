/**
 * When the keeper pushes a feed on-chain: once its on-chain price is 24 hours
 * old, or sooner when the live price has moved 0.5% from it. It checks every
 * 5 minutes. The contract's heartbeat is the schedule plus an hour (25h).
 * contracts/scripts/assets.js (POLICY) carries the same numbers; keep them in
 * step. Client-safe: no server imports.
 */
export const UPDATE_POLICY = { pushEverySeconds: 24 * 60 * 60, deviationBps: 50, checkEverySeconds: 5 * 60 } as const;
