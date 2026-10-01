// Caption rules: turning timed words into readable captions, checking them and
// reading and writing SRT and WebVTT. A port of the rules in autocaptions.

export const PROFILES = {
  broadcast: { label: "Broadcast", maxChars: 42, maxLines: 2, maxCps: 17, minDur: 5 / 6, maxDur: 7, minGap: 2 / 24 },
  bbc: { label: "BBC", maxChars: 37, maxLines: 2, maxCps: 15, minDur: 1, maxDur: 7, minGap: 2 / 25 },
  relaxed: { label: "Relaxed", maxChars: 42, maxLines: 2, maxCps: 21, minDur: 0.7, maxDur: 8, minGap: 0.04 },
};

const ARTICLES = new Set(["a", "an", "the"]);
const PREPOSITIONS = new Set(["of", "in", "on", "at", "to", "for", "with", "from", "by", "as", "into", "under",
  "over", "about", "between", "through", "during", "against", "within", "without", "upon", "across", "per"]);
const CONJUNCTIONS = new Set(["and", "but", "or", "so", "yet", "nor"]);
const SUBORDINATORS = new Set(["which", "that", "because", "if", "when", "while", "although", "though",
  "whether", "since", "unless", "after", "before", "where", "who", "whose"]);
const BAD_BREAK = -40;
const PAUSE = 1.5; // seconds of silence that always end a caption
const LONGEST_WORD = 1.2; // Whisper sometimes stretches a word across a silence

const bare = (w) => w.toLowerCase().replace(/^[.,;:!?()"']+|[.,;:!?()"']+$/g, "");
const join = (words) => words.join(" ");

// How good a break is between words[k-1] and words[k]. Higher is better.
export function breakScore(words, k) {
  if (k <= 0 || k >= words.length) return -1e9;
  const before = words[k - 1], after = words[k];
  const b = bare(before), a = bare(after);
  let score = 0;
  if (/[,;:]$/.test(before)) score += 60;
  else if (/[.!?]$/.test(before)) score += 80;
  if (CONJUNCTIONS.has(a)) score += 34;
  else if (SUBORDINATORS.has(a)) score += 26;
  else if (PREPOSITIONS.has(a)) score += 16;
  else if (ARTICLES.has(a)) score += 8;
  if (ARTICLES.has(b)) score -= 100;
  if (PREPOSITIONS.has(b)) score -= 55;
  if (CONJUNCTIONS.has(b)) score -= 45;
  if (before.endsWith("(")) score -= 120;
  if (after.startsWith(")")) score -= 120;
  if (/^\(?\d{4}\)?[.,)]?$/.test(after)) score -= 70;
  return score;
}

// One or two balanced lines, or null if the text cannot fit without a bad break.
export function layout(text, maxChars = 42) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  let best = -1e9, bestK = -1;
  for (let k = 1; k < words.length; k++) {
    const top = join(words.slice(0, k)).length, bottom = join(words.slice(k)).length;
    if (top > maxChars || bottom > maxChars) continue;
    let score = breakScore(words, k) - Math.abs(top - bottom) * 0.55;
    if (Math.min(top, bottom) < 12) score -= 30;
    if (score > best) [best, bestK] = [score, k];
  }
  if (bestK < 0 || breakScore(words, bestK) < BAD_BREAK) return null;
  return [join(words.slice(0, bestK)), join(words.slice(bestK))];
}

// Split a run of words into cue-sized groups, returning [start, end) index pairs.
function splitWords(words, from, to, maxChars, gaps = []) {
  const fits = (a, b) => layout(join(words.slice(a, b)), maxChars) !== null;
  if (fits(from, to)) return [[from, to]];
  const options = [];
  for (let k = from + 1; k < to; k++) if (fits(from, k)) options.push(k);
  if (!options.length) options.push(from + 1);
  const longest = Math.max(...options) - from;
  let best = -1e9, bestK = options[options.length - 1];
  for (const k of options) {
    if (k - from < longest * 0.55) continue;
    const score = breakScore(words, k) + (k - from) * 1.2 + Math.min(gaps[k] || 0, 1) * 50;
    if (score > best) [best, bestK] = [score, k];
  }
  return [[from, bestK], ...splitWords(words, bestK, to, maxChars, gaps)];
}

// Turn timed words ({text, start, end}) into cues ({start, end, text}).
export function buildCues(timedWords, profile = PROFILES.broadcast) {
  const words = timedWords.filter((w) => w.text && Number.isFinite(w.start));
  words.forEach((w, i) => {
    if (!Number.isFinite(w.end) || w.end <= w.start) w.end = words[i + 1] ? words[i + 1].start : w.start + 0.3;
    w.end = Math.min(w.end, w.start + LONGEST_WORD);
  });
  // Silence before each word, so captions prefer to break where the speaker pauses.
  const gaps = words.map((w, i) => (i ? Math.max(0, w.start - words[i - 1].end) : 0));

  // Phrases end at a full stop or a pause, so a cue never straddles a silence.
  const phrases = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const sentenceEnd = /[.!?]["')\]]?$/.test(words[i].text);
    if (!next || sentenceEnd || next.start - words[i].end > PAUSE) {
      phrases.push([start, i + 1]);
      start = i + 1;
    }
  }

  const texts = words.map((w) => w.text);
  const cues = [];
  for (const [a, b] of phrases) {
    for (const [from, to] of splitWords(texts, a, b, profile.maxChars, gaps)) {
      // A cue that runs too long is halved at its best break.
      const queue = [[from, to]];
      while (queue.length) {
        const [x, y] = queue.shift();
        if (words[y - 1].end - words[x].start > profile.maxDur && y - x > 1) {
          let best = -1e9, k = x + 1;
          for (let j = x + 1; j < y; j++) {
            const s = breakScore(texts, j) - Math.abs(j - (x + y) / 2) * 4;
            if (s > best) [best, k] = [s, j];
          }
          queue.unshift([x, k], [k, y]);
          continue;
        }
        cues.push({ start: words[x].start, end: words[y - 1].end, text: join(texts.slice(x, y)) });
      }
    }
  }
  return tidy(cues, profile);
}

// Stretch short cues into free time and keep the minimum gap between cues.
export function tidy(cues, profile = PROFILES.broadcast) {
  const out = cues.map((c) => ({ ...c })).sort((p, q) => p.start - q.start);
  out.forEach((c, i) => {
    const next = out[i + 1];
    const room = next ? next.start - profile.minGap : Infinity;
    const wanted = Math.max(c.start + profile.minDur, c.start + c.text.length / profile.maxCps);
    if (c.end < wanted) c.end = Math.min(wanted, room);
    if (next && c.end > room) c.end = Math.max(c.start + 0.1, room);
    c.end = Math.ceil(c.end * 1000 - 1e-6) / 1000;
    c.start = Math.round(c.start * 1000) / 1000;
  });
  return out;
}

export const lines = (cue, profile) => layout(cue.text, profile.maxChars) || cue.text.split("\n");

// Problems with one cue, as short plain sentences.
export function check(cues, i, profile) {
  const c = cues[i], next = cues[i + 1], issues = [];
  const dur = c.end - c.start;
  const ls = layout(c.text, profile.maxChars);
  const cps = c.text.replace(/\s+/g, " ").length / Math.max(dur, 0.001);
  if (!ls) issues.push(`Too long for ${profile.maxLines} lines of ${profile.maxChars}`);
  if (cps > profile.maxCps) issues.push(`Too fast to read (${cps.toFixed(1)} characters a second)`);
  if (dur < profile.minDur - 0.001) issues.push(`On screen too briefly (${dur.toFixed(2)}s)`);
  if (dur > profile.maxDur + 0.001) issues.push(`On screen too long (${dur.toFixed(1)}s)`);
  if (next && next.start < c.end) issues.push("Overlaps the next caption");
  else if (next && next.start - c.end < profile.minGap - 0.001) issues.push("Too close to the next caption");
  return { cps, issues };
}

// Formats

function stamp(t, sep) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSRT(cues, profile) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${lines(c, profile).join("\n")}\n`).join("\n");
}

export function toVTT(cues, profile) {
  return "WEBVTT\n\n" + cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${lines(c, profile).join("\n")}\n`).join("\n");
}

const seconds = (s) => {
  const parts = s.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((total, p) => total * 60 + p, 0);
};

export function parse(text) {
  const cues = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const rows = block.split("\n").filter(Boolean);
    const at = rows.findIndex((r) => r.includes("-->"));
    if (at < 0) continue;
    const [a, b] = rows[at].split("-->");
    const words = rows.slice(at + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (words) cues.push({ start: seconds(a), end: seconds(b.trim().split(/\s+/)[0]), text: words });
  }
  return cues;
}

export const clock = (t) => stamp(t, ".").replace(/^00:/, "").slice(0, -2);
