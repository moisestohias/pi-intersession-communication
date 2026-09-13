/**
 * config.ts — fresh config reads with a lightweight cache invalidated on
 * session_start. Tool paths use strict `getPeerConfig()` (loud on schema
 * errors); timer/widget paths use non-throwing `getSafePeerConfig()`
 * (last-good-or-defaults).
 */
import { DEFAULT_PEER_CONFIG, loadPeerConfig, type PeerConfig } from "./peer-config.ts";

let cached: PeerConfig | null = null;
let lastGood: PeerConfig | null = null;

function defaults(): PeerConfig {
  return { ...DEFAULT_PEER_CONFIG, peers: [...DEFAULT_PEER_CONFIG.peers] };
}

export function getPeerConfig(forceReload = false): PeerConfig {
  if (cached && !forceReload) return cached;
  try {
    cached = loadPeerConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Missing peer config")) {
      cached = defaults();
    } else {
      throw err;
    }
  }
  return cached;
}

export function getSafePeerConfig(): PeerConfig {
  try {
    lastGood = getPeerConfig();
    return lastGood;
  } catch (err) {
    try {
      console.error(`[peer] invalid config, degrading to last-good until fixed: ${(err as Error)?.message ?? err}`);
    } catch {}
    return lastGood ?? defaults();
  }
}

export function invalidatePeerConfigCache(): void {
  cached = null;
}
