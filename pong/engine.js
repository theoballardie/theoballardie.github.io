// Pong engine: pure game state and physics, with no drawing and no input.
// Fixed time step and a seeded random generator, so the same inputs always
// produce the same game. That makes it testable and lets the server sanity
// check a submitted result.

export const W = 320;            // court width
export const H = 200;            // court height
export const PADDLE_H = 36;
export const PADDLE_W = 5;
export const BALL = 5;
export const WIN = 3;            // first to three
export const STEP = 1 / 120;     // physics step in seconds

const PAD_X = { visitor: 10, theo: W - 10 - PADDLE_W };
const SERVE_SPEED = 150;
const MAX_SPEED = 340;
const MATCH_POINT_SPEED = 1400;
const MATCH_POINT_SPEEDUP = 1.25;
const MAX_ANGLE = 0.95;          // steepest return, in radians
const SPEEDUP = 1.05;
const VISITOR_SPEED = 260;       // keyboard paddle speed
const THEO_SPEED = 150;          // Theo's normal paddle speed

// Mulberry32: tiny, fast and good enough for games.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function create(seed = Date.now()) {
  const state = {
    random: rng(seed),
    score: { visitor: 0, theo: 0 },
    visitor: H / 2 - PADDLE_H / 2,
    theo: H / 2 - PADDLE_H / 2,
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    aim: 0,          // where on his paddle Theo means to hit the ball
    wait: 1,         // seconds until the next serve
    rallies: 0,      // total paddle hits, sent with the result
    time: 0,
    over: false,
    events: [],      // "hit", "wall", "point" and "end", for sound and effects
  };
  serve(state, state.random() < 0.5 ? -1 : 1);
  return state;
}

function serve(s, direction) {
  const angle = (s.random() - 0.5) * 0.9;
  s.ball = { x: W / 2 - BALL / 2, y: H / 2 - BALL / 2, vx: 0, vy: 0, dir: direction, angle };
  s.wait = 0.8;
}

// Where the ball will cross x, bouncing off the top and bottom walls.
export function predictY(ball, x) {
  if (ball.vx === 0) return ball.y;
  const t = (x - ball.x) / ball.vx;
  if (t < 0) return ball.y;
  const span = H - BALL;
  let y = (ball.y + ball.vy * t) % (2 * span);
  if (y < 0) y += 2 * span;
  return y > span ? 2 * span - y : y;
}

// Theo's paddle. Normally he plays like a decent human: a capped speed and a
// slightly imperfect aim, so a visitor can win points. He doesn't lose a match:
// on any point that could cost him the game he plays perfectly, moving as fast
// as he needs to.
function moveTheo(s, dt) {
  const b = s.ball;
  const centre = s.theo + PADDLE_H / 2;
  let target = H / 2, speed = THEO_SPEED;
  if (b.vx > 0) {
    const hitX = PAD_X.theo - BALL;
    const y = predictY(b, hitX) + BALL / 2;
    const mustWin = s.score.visitor >= WIN - 1;
    target = mustWin ? y - bestShot(s, hitX, y - BALL / 2) * (PADDLE_H / 2) : y + s.aim;
    if (mustWin) {
      const time = Math.max((hitX - b.x) / b.vx, dt);
      speed = Math.max(THEO_SPEED, Math.abs(target - centre) / time + 40);
    }
  }
  const move = clamp(target - centre, -speed * dt, speed * dt);
  s.theo = clamp(s.theo + move, 0, H - PADDLE_H);
}

// At match point Theo looks at every way he could hit the ball and picks the
// return that lands furthest from the visitor's paddle.
function bestShot(s, x, y) {
  const speed = Math.min(Math.hypot(s.ball.vx, s.ball.vy) * MATCH_POINT_SPEEDUP, MATCH_POINT_SPEED);
  const visitorCentre = s.visitor + PADDLE_H / 2;
  let best = 0, furthest = -1;
  for (let offset = -0.95; offset <= 0.951; offset += 0.05) {
    const angle = offset * MAX_ANGLE;
    const ball = { x, y, vx: -Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
    const lands = predictY(ball, PAD_X.visitor + PADDLE_W) + BALL / 2;
    const flight = (x - PAD_X.visitor) / Math.abs(ball.vx);
    const gap = Math.abs(lands - visitorCentre) - flight * VISITOR_SPEED * 1.6;
    if (gap > furthest) [best, furthest] = [offset, gap];
  }
  return best;
}

// Ball meets a paddle: it goes back faster, at an angle set by where it hit.
function bounce(s, paddleY, side) {
  const b = s.ball;
  const offset = (b.y + BALL / 2 - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2); // -1 to 1
  // The rally gets faster with every hit, and much faster at match point, so
  // the visitor can't keep it going forever.
  const matchPoint = s.score.visitor >= WIN - 1;
  const speed = matchPoint
    ? Math.min(Math.hypot(b.vx, b.vy) * MATCH_POINT_SPEEDUP, MATCH_POINT_SPEED)
    : Math.min(Math.hypot(b.vx, b.vy) * SPEEDUP, MAX_SPEED);
  const angle = clamp(offset, -1, 1) * MAX_ANGLE;
  b.vx = Math.cos(angle) * speed * (side === "visitor" ? 1 : -1);
  b.vy = Math.sin(angle) * speed;
  b.x = side === "visitor" ? PAD_X.visitor + PADDLE_W : PAD_X.theo - BALL;
  s.rallies++;
  s.events.push("hit");
  // Theo decides how he'll meet the next return: anywhere on the paddle,
  // sometimes just off the edge.
  if (side === "visitor") s.aim = (s.random() - 0.5) * (PADDLE_H + 14);
}

// Advance the game. input.y is a pointer target for the visitor's paddle centre;
// input.dir is -1, 0 or 1 for keys.
export function step(s, input = {}, dt = STEP) {
  if (s.over) return s;
  s.time += dt;

  if (Number.isFinite(input.y)) {
    const target = clamp(input.y - PADDLE_H / 2, 0, H - PADDLE_H);
    s.visitor += clamp(target - s.visitor, -VISITOR_SPEED * 1.6 * dt, VISITOR_SPEED * 1.6 * dt);
  } else if (input.dir) {
    s.visitor = clamp(s.visitor + input.dir * VISITOR_SPEED * dt, 0, H - PADDLE_H);
  }

  const b = s.ball;
  if (s.wait > 0) {
    s.wait -= dt;
    if (s.wait <= 0) {
      b.vx = Math.cos(b.angle) * SERVE_SPEED * b.dir;
      b.vy = Math.sin(b.angle) * SERVE_SPEED;
    }
    moveTheo(s, dt);
    return s;
  }

  moveTheo(s, dt);
  // Move the ball in small sub-steps so a fast ball can't pass through a paddle.
  const parts = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 2));
  for (let i = 0; i < parts && !s.over && s.wait <= 0; i++) moveBall(s, dt / parts);
  return s;
}

function moveBall(s, dt) {
  const b = s.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (b.y < 0) { b.y = -b.y; b.vy = Math.abs(b.vy); s.events.push("wall"); }
  if (b.y > H - BALL) { b.y = 2 * (H - BALL) - b.y; b.vy = -Math.abs(b.vy); s.events.push("wall"); }

  const meets = (paddleY) => b.y + BALL >= paddleY && b.y <= paddleY + PADDLE_H;
  if (b.vx < 0 && b.x <= PAD_X.visitor + PADDLE_W && b.x >= PAD_X.visitor - BALL && meets(s.visitor)) bounce(s, s.visitor, "visitor");
  if (b.vx > 0 && b.x + BALL >= PAD_X.theo && b.x <= PAD_X.theo + PADDLE_W && meets(s.theo)) bounce(s, s.theo, "theo");

  if (b.x + BALL < 0) point(s, "theo");
  else if (b.x > W) point(s, "visitor");
}

function point(s, winner) {
  s.score[winner]++;
  s.events.push("point");
  if (s.score[winner] >= WIN) {
    s.over = true;
    s.events.push("end");
    return;
  }
  serve(s, winner === "theo" ? -1 : 1); // serve towards whoever lost the point
}

export const PADDLE_X = PAD_X;
