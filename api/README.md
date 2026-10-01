# Scoreboard API

Cloudflare Worker and D1 database behind [theoballardie.com/pong](https://theoballardie.com/pong/).

| Route | Does |
|---|---|
| `POST /players` | Registers a display name and returns a random key. Emails me. |
| `POST /games` | Saves a result for the key's player, after checking it's one the game can produce. |
| `GET /leaderboard` | Top ten by most points taken off me. |
| `GET /me` | The key holder's last 20 games. |

Keys are stored only as SHA-256 hashes. Sign-ups and results are rate limited per IP in Cloudflare's memory, and IP addresses are never written to the database. Only `https://theoballardie.com` may call it from a browser.

## Deploy

```bash
cd api
npx wrangler login
npx wrangler d1 execute pong --remote --file schema.sql
npx wrangler deploy
npx wrangler secret put NOTIFY_TO      # the address sign-up emails go to
```

Email Routing must be on for theoballardie.com, with the `NOTIFY_TO` address verified as a destination.

## Tests

`npm test` at the repo root runs the Worker against an in-memory SQLite database, alongside the game engine tests.
