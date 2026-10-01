import { PROFILES, buildCues, tidy, check, lines, toSRT, toVTT, parse, clock } from "./captions.js";

const $ = (id) => document.getElementById(id);
const video = $("video"), rows = $("rows"), timeline = $("timeline"), overlay = $("overlay");

let cues = [];
let profile = PROFILES.broadcast;
let baseName = "captions";
let videoURL = null;
let worker = null;

for (const [key, p] of Object.entries(PROFILES)) $("profile").add(new Option(`${p.label} (${p.maxChars} characters, ${p.maxCps}/s)`, key));
$("profile").onchange = () => {
  profile = PROFILES[$("profile").value];
  if (cues.length) render();
};

// Choosing files

$("pick").onclick = (e) => { e.preventDefault(); $("file").click(); };
$("file").onchange = () => open([...$("file").files]);
const drop = $("drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); open([...e.dataTransfer.files]); };

async function open(files) {
  const media = files.find((f) => /^(video|audio)\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|mp3|m4a|wav|ogg)$/i.test(f.name));
  const subs = files.find((f) => /\.(srt|vtt)$/i.test(f.name));
  if (!media && !subs) return say("That file type isn't supported. Try an MP4, MOV, WebM, MP3 or WAV.");
  if (media) {
    baseName = media.name.replace(/\.[^.]+$/, "");
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(media);
    video.src = videoURL;
  }
  if (subs) {
    cues = parse(await subs.text());
    if (!media) baseName = subs.name.replace(/\.[^.]+$/, "");
    return showEditor();
  }
  transcribe(media);
}

// Speech recognition

function say(text, percent) {
  $("work").hidden = false;
  $("status").textContent = text;
  $("bar").hidden = percent === undefined;
  if (percent !== undefined) $("bar").value = percent;
}

async function decode(file) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    // Mix down to mono so a voice on one channel isn't lost.
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
    }
    return mono;
  } finally {
    ctx.close();
  }
}

async function transcribe(file) {
  $("start").hidden = true;
  $("editor").hidden = true;
  say("Reading the audio");
  let audio;
  try {
    audio = await decode(file);
  } catch {
    $("start").hidden = false;
    return say("Your browser couldn't read the sound in that file. Try exporting it as MP4 or MP3.");
  }
  const audioSeconds = audio.length / 16000;
  const minutes = audioSeconds / 60;
  worker ||= new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const files = {};
  let ticker = null;
  worker.onmessage = ({ data }) => {
    if (data.type === "progress" && data.status === "progress" && data.total > 1e6) {
      files[data.file] = [data.loaded, data.total];
      const [got, total] = Object.values(files).reduce((s, [l, t]) => [s[0] + l, s[1] + t], [0, 0]);
      say(`Downloading the speech model (${(got / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB, only needed once)`, (got / total) * 100);
    } else if (data.type === "status") {
      const listening = performance.now();
      ticker = setInterval(() => {
        const s = Math.round((performance.now() - listening) / 1000);
        say(`${data.text}: ${minutes.toFixed(1)} minutes of audio, ${s}s so far`);
      }, 500);
    } else if (data.type === "done") {
      clearInterval(ticker);
      cues = buildCues(data.words, profile);
      const end = audioSeconds;
      cues = cues.filter((c) => c.start < end).map((c) => ({ ...c, end: Math.min(c.end, end) }));
      if (!cues.length) {
        $("start").hidden = false;
        return say("No speech was found in that file.");
      }
      showEditor();
    } else if (data.type === "error") {
      clearInterval(ticker);
      $("start").hidden = false;
      say(`Something went wrong: ${data.text}`);
    }
  };
  worker.onerror = (e) => {
    clearInterval(ticker);
    $("start").hidden = false;
    say(`The speech model couldn't start in this browser${e.message ? ` (${e.message})` : ""}. Try Chrome or Edge on a laptop.`);
  };
  say("Loading the speech model");
  worker.postMessage({ audio, size: $("size").value }, [audio.buffer]);
}

// Editor

function showEditor() {
  $("work").hidden = true;
  $("start").hidden = true;
  $("editor").hidden = false;
  render();
}

function duration() {
  const last = cues.length ? cues[cues.length - 1].end : 0;
  return Math.max(Number.isFinite(video.duration) ? video.duration : 0, last, 1);
}

function render() {
  const total = duration();
  let bad = 0;
  rows.textContent = "";
  timeline.textContent = "";
  cues.forEach((c, i) => {
    const { cps, issues } = check(cues, i, profile);
    if (issues.length) bad++;

    const block = document.createElement("i");
    block.style.left = `${(c.start / total) * 100}%`;
    block.style.width = `${Math.max(((c.end - c.start) / total) * 100, 0.2)}%`;
    if (issues.length) block.className = "bad";
    timeline.append(block);

    const tr = rows.insertRow();
    tr.dataset.i = i;
    if (issues.length) tr.className = "bad";
    tr.insertCell().textContent = i + 1;

    const time = tr.insertCell();
    time.className = "time";
    time.append(nudger(i, "start"), document.createElement("br"), nudger(i, "end"));

    const text = tr.insertCell();
    const box = document.createElement("textarea");
    box.value = lines(c, profile).join("\n");
    box.rows = 2;
    box.setAttribute("aria-label", `Caption ${i + 1} text`);
    box.onfocus = () => seek(c.start);
    box.onchange = () => { c.text = box.value.replace(/\s+/g, " ").trim(); render(); };
    text.append(box);
    if (issues.length) {
      const p = document.createElement("p");
      p.className = "issues";
      p.textContent = issues.join(". ") + ".";
      text.append(p);
    }

    const speed = tr.insertCell();
    speed.className = "hide small";
    speed.textContent = `${cps.toFixed(1)}/s`;

    const actions = tr.insertCell();
    actions.append(
      button("Join", `Join caption ${i + 1} with the next`, () => join(i), i === cues.length - 1),
      " ",
      button("Delete", `Delete caption ${i + 1}`, () => { cues.splice(i, 1); render(); }),
    );
  });
  const head = document.createElement("b");
  head.id = "head";
  timeline.append(head);
  $("summary").textContent = `${cues.length} captions, ${bad ? `${bad} with problems` : "no problems"}.`;
  $("fixall").disabled = !bad;
  update();
}

function button(label, title, action, disabled = false) {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = title;
  b.disabled = disabled;
  b.onclick = action;
  return b;
}

function nudger(i, edge) {
  const span = document.createElement("span");
  const shift = (d) => () => {
    const c = cues[i];
    c[edge] = Math.max(0, Math.round((c[edge] + d) * 1000) / 1000);
    if (c.end <= c.start) c.end = c.start + 0.1;
    render();
    seek(c.start);
  };
  const label = document.createElement("a");
  label.href = "#";
  label.textContent = clock(cues[i][edge]);
  label.onclick = (e) => { e.preventDefault(); seek(cues[i][edge]); };
  span.append(button("−", `Move ${edge} 0.1s earlier`, shift(-0.1)), " ", label, " ", button("+", `Move ${edge} 0.1s later`, shift(0.1)));
  return span;
}

function join(i) {
  const [a, b] = [cues[i], cues[i + 1]];
  cues.splice(i, 2, { start: a.start, end: b.end, text: `${a.text} ${b.text}` });
  render();
}

function seek(t) {
  if (video.src) video.currentTime = t;
  update();
}

// Playback: show the current caption over the video and follow it in the list.
function update() {
  const t = video.currentTime || 0;
  const i = cues.findIndex((c) => t >= c.start && t < c.end);
  overlay.innerHTML = "";
  if (i >= 0) {
    const span = document.createElement("span");
    span.textContent = lines(cues[i], profile).join("\n");
    overlay.append(span);
  }
  for (const tr of rows.querySelectorAll("tr.now")) tr.classList.remove("now");
  const row = rows.querySelector(`tr[data-i="${i}"]`);
  if (row) {
    row.classList.add("now");
    if (!video.paused && !row.contains(document.activeElement)) row.scrollIntoView({ block: "nearest" });
  }
  const head = $("head");
  if (head) head.style.left = `${(t / duration()) * 100}%`;
}
video.ontimeupdate = update;
video.onseeked = update;
video.onloadedmetadata = () => cues.length && render();
timeline.onclick = (e) => {
  const r = timeline.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * duration());
};

$("fixall").onclick = () => { cues = tidy(cues, profile); render(); };
$("again").onclick = () => {
  cues = [];
  video.removeAttribute("src");
  video.load();
  $("editor").hidden = true;
  $("work").hidden = true;
  $("start").hidden = false;
};

function download(text, ext, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = `${baseName}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("srt").onclick = () => download(toSRT(cues, profile), "srt", "application/x-subrip");
$("vtt").onclick = () => download(toVTT(cues, profile), "vtt", "text/vtt");
