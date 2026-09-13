# pi-intersession-communication

Peer-to-peer messaging between **any** Pi sessions by `session-id` — no
parent/child spawn relationship required.

## Setup

1. Copy the example config (applies on `/reload`, no restart needed):

```bash
cp config.json.example config.json
```

2. Load the extension in pi (package is auto-discovered when placed where
   pi looks for packages, or linked via your pi config).

## Manual pairing (required)

There is no auto-discovery. Exchange ids by hand:

- Session A runs `/peer whoami` → copies its id to Session B's user.
- Session B runs `/peer allow <that-id>` (a dialog pops up if the id is omitted).
- Repeat in the other direction. Both sides must allow each other.

## Use

```typescript
session_ask({ to_session_id: "abc123", text: "Is the auth module ready?" });
```

- Your own session-id is attached automatically.
- Target must be **allowed and online** — offline targets are an immediate
  error, never queued.
- `notify` mode (default): returns once delivered; the reply arrives later
  as a new turn. `wait` mode (`peer.mode: "wait"` in `config.json`): blocks
  until the peer replies or `peer.wait_timeout_ms` hits.

Reply to a received message with the sender's id (shown in the
notification):

```typescript
session_ask({ to_session_id: "<sender-id>", text: "Yes — merged.", in_reply_to: "<message-id>" });
```

## Commands

| Command | What it does |
|---|---|
| `/peer whoami` | Print this session's full id |
| `/peer list` | Peers + online/offline + mode |
| `/peer allow [<id>]` | Allow a peer (prompts via dialog when omitted), saved to this session's own peer list |
| `/peer block <id>` | Remove a peer, saved to this session's own peer list |

## Config (`config.json`)

| Key | Default | Description |
|---|---|---|
| `peer.enabled` | `true` | Master switch |
| `peer.peers` | `[]` | Template allowlist for sessions that have never saved their own list (both directions enforced) |
| `peer.mode` | `"notify"` | `"notify"` fire-and-forget, `"wait"` blocking |
| `peer.poll_ms` | `1500` | Inbox + heartbeat tick |
| `peer.wait_timeout_ms` | `120000` | `wait`-mode reply timeout |
| `peer.presence_ttl_ms` | `10000` | Heartbeat freshness (must exceed `poll_ms`) |

Wrong types on known keys throw loudly on tool paths; unknown keys
warn-and-ignore. Timer/widget paths degrade to last-good config.

## Trust model (internal use)

- Sender ids are **asserted, not authenticated**: any local process that can
  write to the inbox dir can forge `from`. Single-user local machine only —
  do not put the inbox dir on shared storage.
- Strangers' messages are dropped without waking you (counted in the
  widget as `ignored N from unknown`), but a stranger can still write inbox
  files (disk noise).

## How it works

- Transport root: `$PI_PEER_INBOX_DIR` or `~/.pi/agent/peer-inbox/`.
- `inbox/<id>/msg-*.json` — one atomic file per message (tmp+rename write,
  rename-before-read claim, delete-on-read, each fires once).
- `presence/<id>.json` — heartbeat rewritten every tick; missing/stale =
  offline error on send; deleted on `session_shutdown`.
- `peerlists/<id>.json` — this session's allowlist (tied to session-id, not
  to `config.json`, so sessions never clobber each other; kept on shutdown
  so a resumed session inherits peers; swept 7 days after the owner goes
  away). `peer.peers` in `config.json` only seeds sessions that have never
  saved a list.
- Reserved suffixes: `.msg-*.json`, `.pending-*`, `.consuming-*`,
  `.tmp-*`, `presence.json`. Never reuse them for other files.
