// Runs the Worker against a real SQLite database with Cloudflare's D1 interface faked on top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../api/src/index.js";

function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../api/schema.sql", import.meta.url), "utf8"));
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind: (...a) => ((args = a), stmt),
        first: async () => db.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
        run: async () => {
          try { return db.prepare(sql).run(...args); } catch (e) { throw new Error(`D1_ERROR: ${e.message}`); }
        },
      };
      return stmt;
    },
  };
}

function setup() {
  const env = { DB: d1(), ALLOWED_ORIGINS: "https://theoballardie.com" };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const call = async (method, path, body, key) => {
    const headers = { origin: "https://theoballardie.com", "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await worker.fetch(new Request(`https://api.theoballardie.com${path}`, { method, headers, body: body && JSON.stringify(body) }), env, ctx);
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return { call, env };
}

test("sign up, play, see the leaderboard and your history", async () => {
  const { call } = setup();
  const me = await call("POST", "/players", { name: "Ada" });
  assert.equal(me.status, 200);
  assert.match(me.body.key, /^[0-9a-f]{64}$/);
  assert.equal(me.headers.get("access-control-allow-origin"), "https://theoballardie.com");

  assert.equal((await call("POST", "/games", { visitor: 2, theo: 3, rallies: 30, seconds: 50 }, me.body.key)).status, 200);
  const board = await call("GET", "/leaderboard");
  assert.deepEqual(board.body, [{ name: "Ada", best: 2, games: 1 }]);
  const mine = await call("GET", "/me", null, me.body.key);
  assert.equal(mine.body.name, "Ada");
  assert.equal(mine.body.games[0].visitor, 2);
});

test("names are unique regardless of case", async () => {
  const { call } = setup();
  await call("POST", "/players", { name: "Ada" });
  const again = await call("POST", "/players", { name: "ada" });
  assert.equal(again.status, 409);
});

test("bad keys, fake scores and odd requests are refused", async () => {
  const { call } = setup();
  const me = await call("POST", "/players", { name: "Grace" });
  assert.equal((await call("POST", "/games", { visitor: 2, theo: 3, rallies: 30, seconds: 50 }, "f".repeat(64))).status, 401);
  assert.equal((await call("POST", "/games", { visitor: 5, theo: 2, rallies: 30, seconds: 50 }, me.body.key)).status, 400);
  assert.equal((await call("GET", "/players")).status, 404);
  assert.equal((await call("POST", "/players", { name: "<b>hi</b>" })).status, 400);
});

test("a second result can't arrive faster than the game takes", async () => {
  const { call } = setup();
  const me = await call("POST", "/players", { name: "Linus" });
  const game = { visitor: 1, theo: 3, rallies: 10, seconds: 60 };
  assert.equal((await call("POST", "/games", game, me.body.key)).status, 200);
  assert.equal((await call("POST", "/games", game, me.body.key)).status, 429);
});

test("other websites can't use the API from a browser", async () => {
  const { env } = setup();
  const res = await worker.fetch(new Request("https://api.theoballardie.com/leaderboard", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env, {});
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("the key is stored hashed, never as given", async () => {
  const { call, env } = setup();
  const me = await call("POST", "/players", { name: "Alan" });
  const row = await env.DB.prepare("SELECT key_hash FROM players").first();
  assert.notEqual(row.key_hash, me.body.key);
  assert.match(row.key_hash, /^[0-9a-f]{64}$/);
});
