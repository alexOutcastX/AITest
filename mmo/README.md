# Thornvale Online

A small, original browser MMO: a top-down pixel-art island with a walled
starter town, monsters that get tougher the further you roam, shared XP,
gold, levels, chat, and persistent characters. No build step and **zero npm
dependencies**. Even the WebSocket server is hand-rolled.

## Play

```sh
cd mmo
npm start            # or: node server.js
# open http://localhost:8080 in several tabs/devices
```

| Env var       | Default             | Meaning                                  |
| ------------- | ------------------- | ---------------------------------------- |
| `PORT`        | `8080`              | HTTP + WebSocket port                    |
| `BOTS`        | `4`                 | AI adventurers that roam the world       |
| `SEED`        | `1337`              | World seed (same seed → same map)        |
| `DATA_FILE`   | `data/players.json` | Where characters are saved               |
| `MAX_PLAYERS` | `200`               | Connection cap                           |

**Offline mode:** if the page is served without the game server (e.g. GitHub
Pages or `python3 -m http.server` from the repo root → `/mmo/client/`), the
client runs the same simulation in the browser with 8 AI adventurers and
saves your character to `localStorage`. Use `?offline` to force it, or
`?server=wss://your-host/ws` to point a static copy at a hosted server.

## Controls

| Input                         | Action                             |
| ----------------------------- | ---------------------------------- |
| WASD / arrows                 | Move                               |
| Click / tap ground            | Walk there (pathfinds around walls)|
| Click / tap monster, `Tab`    | Target + auto-attack               |
| `1`                           | Heal (35% HP, 12 s cooldown)       |
| `2`                           | Power Strike (2.2× damage, 6 s)    |
| `Enter`                       | Chat                               |
| Touch: drag on left half      | Virtual joystick                   |

## Game rules

- **Zones** ring the town: Slimes (Lv 1, passive) → Wolves (Lv 4) →
  Skeletons (Lv 8) → Ogres (Lv 13) in the dark woods at the island's edge.
  Aggressive monsters chase you, but give up and run home if pulled too far.
- **Town** is a safe zone: monsters can't enter, and you regenerate fast.
- **Grouping pays:** everyone who damages a monster gets full XP (scaled by
  level difference); the top damage dealer gets the gold.
- **Death** sends you back to town and costs 20% of your current-level XP.

## Architecture

```
mmo/
  server.js        HTTP static host + RFC 6455 WebSocket + 20 Hz game loop
  game/world.js    seeded island generator, collision, A* pathfinding (shared)
  game/sim.js      authoritative simulation: players, monsters, combat, bots
  client/          canvas renderer, input, HUD, net (online or offline)
  test/smoke.js    end-to-end test: boots the server, connects 2 clients
```

- The map is never sent: client and server generate it from the seed.
- The server is authoritative. Clients send intents (move direction, walk-to,
  target, ability, chat) and get a 10 Hz snapshot of entities within view,
  plus events (damage, XP, chat). The client predicts its own movement with
  the shared collision code and interpolates everyone else.
- Inputs are validated and rate-limited; chat is rendered as text, never HTML.
- Characters are keyed by name with no password. Fine for friends, not for
  the public internet. Add auth before exposing it.

```sh
npm test   # end-to-end smoke test
```
