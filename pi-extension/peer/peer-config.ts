/**
 * peer-config.ts — parse + validate the `peer` config section.
 * Pure functions, directly unit-tested. No IO except the load* helpers.
 *
 * Policy (mirrors pi-interactive-subagents rule 5):
 * - Wrong *types* on known keys throw (loud, fixable).
 * - Unknown keys warn-and-ignore (forward compat).
 * - Absent `peer` section means defaults.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSessionId } from "./paths.ts";

export type PeerMode = "notify" | "wait";

export interface PeerConfig {
  enabled: boolean;
  peers: string[];
  mode: PeerMode;
  poll_ms: number;
  wait_timeout_ms: number;
  presence_ttl_ms: number;
}

export const DEFAULT_PEER_CONFIG: PeerConfig = {
  enabled: true,
  peers: [],
  mode: "notify",
  poll_ms: 1500,
  wait_timeout_ms: 120000,
  presence_ttl_ms: 10000,
};

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_CONFIG_PATH = join(PACKAGE_ROOT, "config.json");
const EXAMPLE_CONFIG_PATH = join(PACKAGE_ROOT, "config.json.example");

function invalid(source: string, message: string): never {
  throw new Error(`Invalid peer config in ${source}: ${message}`);
}

function requireObject(value: unknown, source: string, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    invalid(source, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, source: string, field: string): boolean {
  if (typeof value !== "boolean") invalid(source, `${field} must be a boolean`);
  return value as boolean;
}

function requirePositiveInt(value: unknown, source: string, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    invalid(source, `${field} must be a positive integer`);
  }
  return value as number;
}

function warnUnknown(source: string, field: string, keys: string[]): void {
  if (keys.length === 0) return;
  try {
    console.warn(`[peer] ${source}: ${field} has unsupported key(s) (ignored): ${keys.join(", ")}`);
  } catch {}
}

export function parsePeerConfig(rawConfig: unknown, source = "config.json"): PeerConfig {
  const root = requireObject(rawConfig, source, "root");
  if (root.peer === undefined) return { ...DEFAULT_PEER_CONFIG, peers: [] };
  const peer = requireObject(root.peer, source, "peer");
  warnUnknown(
    source,
    "peer",
    Object.keys(peer).filter(
      (k) => !["enabled", "peers", "mode", "poll_ms", "wait_timeout_ms", "presence_ttl_ms"].includes(k),
    ),
  );

  const enabled = peer.enabled === undefined ? true : requireBoolean(peer.enabled, source, "peer.enabled");

  let peers: string[] = [];
  if (peer.peers !== undefined) {
    if (!Array.isArray(peer.peers)) invalid(source, "peer.peers must be an array of session-ids");
    for (const entry of peer.peers) {
      if (!isValidSessionId(entry)) {
        invalid(source, `peer.peers contains an invalid session-id: ${JSON.stringify(entry)}`);
      }
      if (!peers.includes(entry as string)) peers.push(entry as string);
    }
  }

  const mode = peer.mode === undefined ? "notify" : peer.mode;
  if (mode !== "notify" && mode !== "wait") {
    invalid(source, `peer.mode must be "notify" or "wait"`);
  }

  const poll_ms = peer.poll_ms === undefined ? DEFAULT_PEER_CONFIG.poll_ms : requirePositiveInt(peer.poll_ms, source, "peer.poll_ms");
  const wait_timeout_ms =
    peer.wait_timeout_ms === undefined
      ? DEFAULT_PEER_CONFIG.wait_timeout_ms
      : requirePositiveInt(peer.wait_timeout_ms, source, "peer.wait_timeout_ms");
  const presence_ttl_ms =
    peer.presence_ttl_ms === undefined
      ? DEFAULT_PEER_CONFIG.presence_ttl_ms
      : requirePositiveInt(peer.presence_ttl_ms, source, "peer.presence_ttl_ms");

  if (presence_ttl_ms <= poll_ms) {
    invalid(source, `peer.presence_ttl_ms (${presence_ttl_ms}) must be greater than peer.poll_ms (${poll_ms})`);
  }

  return { enabled, peers, mode: mode as PeerMode, poll_ms, wait_timeout_ms, presence_ttl_ms };
}

function readRawConfig(configPath: string, examplePath: string): { sourcePath: string; parsed: unknown } {
  let sourcePath = configPath;
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    try {
      raw = readFileSync(examplePath, "utf8");
      sourcePath = examplePath;
    } catch (err2) {
      if ((err2 as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Missing peer config. Expected ${configPath} or ${examplePath}.`);
      }
      throw err2;
    }
  }
  try {
    return { sourcePath, parsed: JSON.parse(raw) as unknown };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in peer config ${sourcePath}: ${detail}`);
  }
}

export function loadPeerConfig(
  configPath = DEFAULT_CONFIG_PATH,
  examplePath = EXAMPLE_CONFIG_PATH,
): PeerConfig {
  const { sourcePath, parsed } = readRawConfig(configPath, examplePath);
  return parsePeerConfig(parsed, sourcePath);
}
