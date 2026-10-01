// Input checks, kept separate from the Worker so they can be unit tested.

import { WIN } from "../../pong/engine.js";

export const NAME = /^[A-Za-z0-9 _.\-]{2,20}$/;

export function cleanName(value) {
  const name = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!NAME.test(name)) throw new Problem(400, "Names are 2 to 20 letters, numbers, spaces, dots, dashes or underscores.");
  if (/^theo\b|ballardie/i.test(name)) throw new Problem(400, "Nice try. Pick another name.");
  return name;
}

// Theo always wins, first to WIN. Anything else didn't come from the game.
export function cleanGame(body) {
  const n = (v) => (Number.isInteger(v) ? v : NaN);
  const game = { visitor: n(body?.visitor), theo: n(body?.theo), rallies: n(body?.rallies), seconds: n(body?.seconds) };
  const ok =
    game.theo === WIN &&
    game.visitor >= 0 && game.visitor < WIN &&
    game.rallies >= 0 && game.rallies <= 5000 &&
    game.seconds >= 8 && game.seconds <= 3600 &&
    // every point the visitor wins needs at least one return from them
    game.rallies >= game.visitor;
  if (!ok) throw new Problem(400, "That score doesn't look like a real game.");
  return game;
}

export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
