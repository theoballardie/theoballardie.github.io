import { create, step, STEP, W, H, BALL, PADDLE_H, PADDLE_W, PADDLE_X, WIN } from "./engine.js";
import * as api from "./api.js";

const $ = (id) => document.getElementById(id);
const canvas = $("court");
const ctx = canvas.getContext("2d");

// Draw at the screen's real pixel density so lines stay sharp on phones.
function fit() {
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = W * scale;
  canvas.height = H * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}
fit();
window.addEventListener("resize", fit);

let game = null;
let input = {};
const keys = new Set();

// Input: drag or move over the court, or use the arrow keys or W and S.
function pointer(e) {
  const r = canvas.getBoundingClientRect();
  input.y = ((e.clientY - r.top) / r.height) * H;
}
canvas.addEventListener("pointermove", pointer);
canvas.addEventListener("pointerdown", (e) => {
  pointer(e);
  if (!game || game.over) start();
});
canvas.addEventListener("pointerleave", () => { input.y = undefined; });
window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "w", "s", "W", "S"].includes(e.key)) {
    keys.add(e.key.toLowerCase());
    input.y = undefined;
    e.preventDefault();
  }
  if ((e.key === " " || e.key === "Enter") && document.activeElement === canvas && (!game || game.over)) {
    e.preventDefault();
    start();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
const keyDir = () => (keys.has("arrowdown") || keys.has("s") ? 1 : 0) - (keys.has("arrowup") || keys.has("w") ? 1 : 0);

// Game loop: physics runs at a fixed rate, drawing runs at the screen's rate.
let last = 0, spare = 0;
function frame(now) {
  if (game && !game.over) {
    spare = Math.min(spare + (now - last) / 1000, 0.25);
    while (spare >= STEP) {
      step(game, { y: input.y, dir: keyDir() });
      spare -= STEP;
    }
    if (game.over) finish();
    game.events.length = 0;
  }
  last = now;
  draw();
  requestAnimationFrame(frame);
}

function draw() {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  for (let y = 4; y < H; y += 12) ctx.fillRect(W / 2 - 0.5, y, 1, 6);
  if (!game) {
    text("Tap or click to play", H / 2);
    return;
  }
  ctx.fillRect(PADDLE_X.visitor, game.visitor, PADDLE_W, PADDLE_H);
  ctx.fillRect(PADDLE_X.theo, game.theo, PADDLE_W, PADDLE_H);
  if (!game.over) ctx.fillRect(game.ball.x, game.ball.y, BALL, BALL);
  ctx.font = "bold 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(game.score.visitor, W / 2 - 30, 26);
  ctx.fillText(game.score.theo, W / 2 + 30, 26);
  if (game.over) text("Theo wins. Tap to play again", H / 2 + 30);
}

function text(message, y) {
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  const w = ctx.measureText(message).width + 16;
  ctx.fillStyle = "#000";
  ctx.fillRect(W / 2 - w / 2, y - 14, w, 22);
  ctx.fillStyle = "#fff";
  ctx.fillText(message, W / 2, y + 2);
  ctx.fillStyle = "#000";
}

function start() {
  game = create((Math.random() * 2 ** 32) >>> 0);
  spare = 0;
  $("result").hidden = true;
  $("status").textContent = `First to ${WIN}. You are on the left.`;
}

// After a game

let lastResult = null;

function finish() {
  lastResult = { visitor: game.score.visitor, theo: game.score.theo, rallies: game.rallies, seconds: Math.round(game.time) };
  const p = lastResult.visitor;
  $("status").textContent = p === 0 ? `Theo won ${WIN} to 0.` : `You took ${p} point${p === 1 ? "" : "s"} off Theo. He still won.`;
  $("result").hidden = false;
  const player = api.player();
  $("signup").hidden = !!player;
  $("saved").textContent = "";
  if (player) save();
}

async function save() {
  try {
    await api.submit(lastResult);
    $("saved").textContent = "Score saved.";
    refresh();
  } catch (err) {
    $("saved").textContent = err.message;
  }
}

$("signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    await api.register($("name").value);
    $("signup").hidden = true;
    await save();
  } catch (err) {
    $("saved").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

async function refresh() {
  const [board, mine] = await Promise.allSettled([api.leaderboard(), api.history()]);
  const list = $("board");
  list.textContent = "";
  if (board.status === "fulfilled") {
    for (const row of board.value) {
      const li = document.createElement("li");
      li.textContent = `${row.name}: ${row.best} point${row.best === 1 ? "" : "s"} (${row.games} game${row.games === 1 ? "" : "s"})`;
      list.append(li);
    }
    if (!board.value.length) list.innerHTML = '<li class="note">No one yet. Be the first.</li>';
  } else {
    list.innerHTML = '<li class="note">The scoreboard is offline right now.</li>';
  }
  const history = $("history");
  history.hidden = !(mine.status === "fulfilled" && mine.value);
  if (!history.hidden) {
    const { name, games } = mine.value;
    $("me").textContent = name;
    const rows = $("games");
    rows.textContent = "";
    for (const g of games) {
      const tr = rows.insertRow();
      tr.insertCell().textContent = new Date(g.played_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      tr.insertCell().textContent = `${g.visitor} to ${g.theo}`;
      tr.insertCell().textContent = g.rallies;
    }
  }
}

refresh();
requestAnimationFrame(frame);
