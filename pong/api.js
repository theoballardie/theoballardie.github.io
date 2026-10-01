// Talks to the scoreboard on Cloudflare. A player is just a display name and a
// random key kept in this browser; there are no passwords.

const BASE = "https://api.theoballardie.com";
const KEY = "pong-player";

export function player() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

async function call(path, options = {}) {
  let res;
  try {
    res = await fetch(BASE + path, { ...options, headers: { "content-type": "application/json", ...options.headers } });
  } catch {
    throw new Error("Couldn't reach the scoreboard. Check your connection.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong. Try again.");
  return body;
}

export async function register(name) {
  const body = await call("/players", { method: "POST", body: JSON.stringify({ name }) });
  try {
    localStorage.setItem(KEY, JSON.stringify(body));
  } catch {
    // Private browsing: the score still saves, but history won't follow them.
  }
  return body;
}

export function submit(result) {
  const p = player();
  return call("/games", { method: "POST", headers: { authorization: `Bearer ${p.key}` }, body: JSON.stringify(result) });
}

export const leaderboard = () => call("/leaderboard");

export function history() {
  const p = player();
  if (!p) return Promise.resolve(null);
  return call("/me", { headers: { authorization: `Bearer ${p.key}` } });
}
