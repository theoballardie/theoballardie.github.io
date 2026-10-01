// Scoreboard API for theoballardie.com/pong, running on Cloudflare Workers with D1.
//
//   POST /players      { name }                        -> { name, key }   (emails Theo)
//   POST /games        { visitor, theo, rallies, seconds }  with "Authorization: Bearer <key>"
//   GET  /leaderboard                                  -> top ten
//   GET  /me           with "Authorization: Bearer <key>"   -> your last 20 games

import { cleanName, cleanGame, Problem } from "./rules.js";

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").includes(origin);
    const cors = allowed
      ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST", "access-control-max-age": "86400", vary: "origin" }
      : {};
    if (request.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });

    try {
      const { pathname } = new URL(request.url);
      const route = `${request.method} ${pathname}`;
      let body;
      if (route === "POST /players") body = await register(request, env, ctx);
      else if (route === "POST /games") body = await saveGame(request, env);
      else if (route === "GET /leaderboard") body = await leaderboard(env);
      else if (route === "GET /me") body = await history(request, env);
      else throw new Problem(404, "Not found.");
      return json(body, 200, cors);
    } catch (err) {
      if (err instanceof Problem) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: "Something went wrong on the server." }, 500, cors);
    }
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

async function readJSON(request) {
  if (Number(request.headers.get("content-length") || 0) > 1024) throw new Problem(413, "Too much data.");
  try {
    return await request.json();
  } catch {
    throw new Problem(400, "Send JSON.");
  }
}

// Rate limits are keyed on the visitor's IP address in Cloudflare's memory. It's never written to the database.
async function limit(binding, request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (binding && !(await binding.limit({ key: ip })).success) throw new Problem(429, "Slow down a little and try again in a minute.");
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function playerFrom(request, env) {
  const key = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Problem(401, "Put your name on the scoreboard first.");
  const player = await env.DB.prepare("SELECT id, name FROM players WHERE key_hash = ?").bind(await sha256(key)).first();
  if (!player) throw new Problem(401, "We don't recognise this browser. Sign up again with a new name.");
  return player;
}

async function register(request, env, ctx) {
  await limit(env.SIGNUPS, request);
  const name = cleanName((await readJSON(request)).name);
  const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    await env.DB.prepare("INSERT INTO players (name, key_hash) VALUES (?, ?)").bind(name, await sha256(key)).run();
  } catch (err) {
    if (/UNIQUE/.test(String(err))) throw new Problem(409, "That name is taken. Try another.");
    throw err;
  }
  ctx.waitUntil(notify(env, name).catch((err) => console.error("email failed", err)));
  return { name, key };
}

async function saveGame(request, env) {
  await limit(env.GAMES, request);
  const player = await playerFrom(request, env);
  const game = cleanGame(await readJSON(request));
  // A real game takes at least as long as it says it did.
  const recent = await env.DB.prepare("SELECT played_at FROM games WHERE player_id = ? ORDER BY played_at DESC LIMIT 1").bind(player.id).first();
  if (recent && Date.now() - Date.parse(recent.played_at) < game.seconds * 1000 - 2000) throw new Problem(429, "That was quicker than the game you played.");
  await env.DB.prepare("INSERT INTO games (player_id, visitor, theo, rallies, seconds) VALUES (?, ?, ?, ?, ?)")
    .bind(player.id, game.visitor, game.theo, game.rallies, game.seconds).run();
  return { saved: true };
}

async function leaderboard(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.name, MAX(g.visitor) AS best, COUNT(*) AS games
       FROM games g JOIN players p ON p.id = g.player_id
      GROUP BY p.id
      ORDER BY best DESC, games DESC, MIN(g.played_at)
      LIMIT 10`,
  ).all();
  return results;
}

async function history(request, env) {
  const player = await playerFrom(request, env);
  const { results } = await env.DB.prepare(
    "SELECT visitor, theo, rallies, seconds, played_at FROM games WHERE player_id = ? ORDER BY played_at DESC LIMIT 20",
  ).bind(player.id).all();
  return { name: player.name, games: results };
}

// An email to Theo for every new player. The address lives in a Worker secret, not in this code.
async function notify(env, name) {
  if (!env.MAILER || !env.NOTIFY_TO || !env.NOTIFY_FROM) return;
  const when = new Date().toUTCString();
  const raw = [
    `From: Pong <${env.NOTIFY_FROM}>`,
    `To: ${env.NOTIFY_TO}`,
    `Subject: New Pong player: ${name}`,
    `Date: ${when}`,
    `Message-ID: <${crypto.randomUUID()}@theoballardie.com>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `${name} just put their name on the scoreboard at https://theoballardie.com/pong/`,
    "",
  ].join("\r\n");
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAILER.send(new EmailMessage(env.NOTIFY_FROM, env.NOTIFY_TO, raw));
}
