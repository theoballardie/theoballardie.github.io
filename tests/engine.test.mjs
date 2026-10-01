import { test } from "node:test";
import assert from "node:assert/strict";
import { create, step, predictY, rng, WIN, H, BALL, PADDLE_X, PADDLE_W } from "../pong/engine.js";

// A visitor bot. "skill" is how often it chases the ball rather than drifting.
function play(seed, skill, maxSeconds = 600) {
  const s = create(seed);
  const r = rng(seed ^ 0x9e3779b9);
  let drift = H / 2;
  while (!s.over && s.time < maxSeconds) {
    const b = s.ball;
    if (r() < 0.01) drift = r() * H;
    const y = b.vx < 0 && r() < skill ? predictY(b, PADDLE_X.visitor + PADDLE_W) + BALL / 2 : drift;
    step(s, { y });
    s.events.length = 0;
  }
  return s;
}

test("Theo wins every game, even against a perfect player", () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const skill of [0, 0.5, 0.97, 1]) {
      const s = play(seed, skill);
      assert.ok(s.over, `game ${seed} at skill ${skill} never finished`);
      assert.equal(s.score.theo, WIN);
      assert.ok(s.score.visitor < WIN);
    }
  }
});

test("good players can still win points, so it doesn't feel rigged", () => {
  let points = 0;
  for (let seed = 1; seed <= 100; seed++) points += play(seed, 1).score.visitor;
  assert.ok(points / 100 >= 1, `average visitor points ${points / 100}`);
});

test("the same seed and inputs replay identically", () => {
  const a = play(42, 0.8), b = play(42, 0.8);
  assert.deepEqual([a.score, a.rallies, a.time], [b.score, b.rallies, b.time]);
});

test("predictY follows bounces off the walls", () => {
  const ball = { x: 0, y: 10, vx: 100, vy: -100 };
  assert.ok(Math.abs(predictY(ball, 20) - 10) < 1e-9); // up 20, bounce at 0, back down to 10
});
