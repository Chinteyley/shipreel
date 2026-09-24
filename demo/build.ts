// Keynote-style demo, built as a HyperFrames composition from a real Shipreel run.
// Every number, frame, and verdict on screen comes from that run's report.
// Usage: bun demo/build.ts <self-run-dir> [other-run-dir]

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";

const runDir = resolve(process.argv[2] ?? "out/Chinteyley-shipreel");
const otherDir = process.argv[3] ? resolve(process.argv[3]) : null;
const demo = resolve(import.meta.dir);
const A = join(demo, "assets");
const V = join(A, "v2");
const L = join(A, "logos");
for (const d of [V, L, join(A, "fonts")]) mkdirSync(d, { recursive: true });

interface Note { scene: number; attempt: number; url: string; has_text: boolean; on_brief: number; issues: string; verdict: "keep" | "reshoot" }
interface Scene { layout: string; headline: string; narration: string; visual: string; code: string }
interface Report {
  repo: string; spend_usd: number; estimate_usd: number; calls: number; duration_s: number; wall_clock_s: number;
  spend_by_model: Record<string, number>; critic: Note[];
  storyboard: { title: string; tagline: string; accent: string; scenes: Scene[] };
}
const readReport = (dir: string) =>
  JSON.parse(readFileSync(join(dir, existsSync(join(dir, "report.shoot.json")) ? "report.shoot.json" : "report.json"), "utf8")) as Report;
const report = readReport(runDir);
const sb = report.storyboard;
const audio = JSON.parse(readFileSync(join(demo, "audio.json"), "utf8")) as {
  vo: Record<string, { file: string; seconds: number }>; sfx: Record<string, string>; bed: string;
};
const REPO_URL = "github.com/Chinteyley/shipreel";

// ---------- assets ----------
for (const f of ["Inter.woff2", "JetBrainsMono.woff2"]) copyFileSync(join(demo, "../fonts", f), join(A, "fonts", f));
copyFileSync(join(runDir, "trailer.mp4"), join(V, "trailer.mp4"));
const plates = [...Array(sb.scenes.length).keys()].filter((i) => existsSync(join(runDir, "video/assets", `plate${i}.mp4`)));
for (const i of plates) copyFileSync(join(runDir, "video/assets", `plate${i}.mp4`), join(V, `plate${i}.mp4`));
const takes = [...report.critic].sort((a, b) => a.scene - b.scene || a.attempt - b.attempt);
// Keyframes are cached by URL, so rebuilding from a different run never reuses stale frames.
const kfName = (n: Note) => `kf-${new Bun.CryptoHasher("sha1").update(n.url).digest("hex").slice(0, 12)}.jpg`;
await Promise.all(takes.map(async (n) => {
  const f = join(V, kfName(n));
  if (!existsSync(f)) await Bun.write(f, await fetch(n.url));
}));
const kept = (scene: number) => takes.filter((n) => n.scene === scene).sort((a, b) => Number(b.verdict === "keep") - Number(a.verdict === "keep") || b.on_brief - a.on_brief)[0]!;
if (otherDir && existsSync(join(otherDir, "trailer.mp4"))) copyFileSync(join(otherDir, "trailer.mp4"), join(V, "other.mp4"));
// The hook plays the projector dolly-in from the model bake-off (flux-pro → kling on Livepeer).
const hero = existsSync(join(V, "hero.mp4")) ? "assets/v2/hero.mp4" : existsSync(join(V, "plate0.mp4")) ? "assets/v2/plate0.mp4" : null;

async function fetchText(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`logo ${url}: HTTP ${r.status}`);
  return r.text();
}
async function cached(name: string, url: string) {
  const f = join(L, name);
  if (!existsSync(f)) await Bun.write(f, await fetchText(url));
  return readFileSync(f, "utf8");
}
const si = async (slug: string) => cached(`${slug}.svg`, `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`);
const paint = (svg: string, fill: string, cls: string) => svg.replace(/<title>.*?<\/title>/, "").replace("<svg ", `<svg class="${cls}" fill="${fill}" aria-hidden="true" `);
let gid = 0;
const geminiMark = (cls: string) => {
  const id = `gem${gid++}`;
  return paint(GEMINI, `url(#${id})`, cls).replace(/(<svg[^>]*>)/, `$1<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4c8bf5"/><stop offset=".55" stop-color="#9b72cb"/><stop offset="1" stop-color="#d96570"/></linearGradient></defs>`);
};
const GEMINI = await si("googlegemini");
const NVIDIA = await si("nvidia");
const GITHUB = await si("github");
const livepeerRaw = await cached("livepeer.svg", "https://livepeer.org/icon.svg");
const LIVEPEER = (cls: string) => livepeerRaw.replace(/<style>[\s\S]*?<\/style>/, "").replace(/class="glyph"/g, 'fill="#fff"').replace("<svg ", `<svg class="${cls}" aria-hidden="true" `);
const bflRaw = await cached("bfl.svg", "https://bfl.ai/icon0.svg");
const BFL = (cls: string) => `<svg class="${cls}" viewBox="28 56 204 148" aria-hidden="true"><path fill="#fff" d="${bflRaw.match(/<path d="([^"]+)"/)![1]}"/></svg>`;
const SHIPREEL = (cls: string) => readFileSync(join(demo, "../brand/shipreel.svg"), "utf8").replace("<svg ", `<svg class="${cls}" `).replace(/sr-g/g, `sr-g${gid++}`);
const img = (src: string, cls: string) => `<img class="${cls}" src="${src}" alt="" />`;

// Crew, derived from the models the run actually billed.
const used = Object.keys(report.spend_by_model);
const pick = (...ids: string[]) => ids.find((m) => used.includes(m)) ?? ids[0]!;
const crew = [
  { role: "Director", model: pick("gemini-text"), logo: (c: string) => geminiMark(c) },
  { role: "Camera", model: pick("flux-pro", "flux-dev"), logo: BFL },
  { role: "Critic", model: pick("nemotron-omni-vision"), logo: (c: string) => paint(NVIDIA, "#76B900", c) },
  { role: "Motion", model: pick("kling-v3-turbo-i2v", "pixverse-i2v"), logo: (c: string) => (pick("kling-v3-turbo-i2v", "pixverse-i2v").startsWith("kling") ? img("assets/logos/kling.png", c) : img("assets/logos/pixverse.svg", c)) },
  { role: "Voice", model: pick("gemini-tts", "inworld-tts"), logo: (c: string) => geminiMark(c) },
  { role: "Score", model: pick("sonilo-t2m"), logo: (c: string) => img("assets/logos/sonilo.png", c) },
];
const short = (m: string) => m.replace("-omni-vision", "-omni").replace("-i2v", "");

// Waveforms from the run's real audio.
async function envelope(file: string, bars: number) {
  const raw = await $`ffmpeg -v error -i ${file} -ac 1 -ar 2000 -f f32le -`.arrayBuffer();
  const pcm = new Float32Array(raw);
  const size = Math.max(1, Math.floor(pcm.length / bars));
  const rms = Array.from({ length: bars }, (_, b) => {
    let s = 0;
    for (let i = b * size; i < (b + 1) * size && i < pcm.length; i++) s += pcm[i]! * pcm[i]!;
    return Math.sqrt(s / size);
  });
  const max = Math.max(...rms, 1e-6);
  return rms.map((v) => Math.round((0.06 + 0.94 * (v / max)) * 100) / 100);
}
const runAssets = join(runDir, "video/assets");
const scoreFile = ["score.m4a", "score.mp3", "score.wav"].map((f) => join(runAssets, f)).find(existsSync)!;
const voFiles = sb.scenes.map((_, i) => ["mp3", "wav", "m4a"].map((e) => join(runAssets, `vo${i}.${e}`)).find(existsSync)!);
const voiceConcat = join(V, ".voice-concat.wav");
await $`ffmpeg -v error -y ${voFiles.flatMap((f) => ["-i", f])} -filter_complex ${`${voFiles.map((_, i) => `[${i}:a]`).join("")}concat=n=${voFiles.length}:v=0:a=1`} ${voiceConcat}`;
const voiceBars = await envelope(voiceConcat, 110);
const scoreBars = await envelope(scoreFile, 110);
const probe = async (f: string) => Number((await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${f}`.text()).trim());
const trailerSeconds = await probe(join(V, "trailer.mp4"));
const plateSeconds = plates.length ? await probe(join(V, `plate${plates[0]}.mp4`)) : 5;
const readme = readFileSync(join(demo, "../README.md"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("```") && !l.startsWith("|")).slice(0, 9);

// ---------- timing ----------
const r2 = (n: number) => Math.round(n * 100) / 100;
const X = 0.6; // crossfade overlap between scenes
interface Seg { start: number; dur: number; vo: number; voLen: number; end: number }
let t = 0;
function seg(key: string | null, min: number, lead = 0.7, tail = 0.9, fixed?: number): Seg {
  const voLen = key ? audio.vo[key]!.seconds : 0;
  const dur = r2(fixed ?? Math.max(min, lead + voLen + tail));
  const s = { start: r2(t), dur, vo: r2(t + lead), voLen, end: r2(t + dur) };
  t += dur;
  return s;
}
const S = {
  hook: seg("hook", 6.2, 0.8, 0.9),
  reveal: seg("reveal", 5.4, 0.7, 0.8),
  cmd: seg("cmd", 5.6, 0.4, 1.6),
  crew: seg("crew", 7.2, 1.2, 1.0),
  director: seg("director", 7.4, 0.5, 0.9),
  critic: seg("critic", 9.2, 0.4, 1.0),
  motion: seg("motion", 7.8, 0.5, 1.1),
  words: seg("words", 8.4, 0.5, 0.9),
  receipt: seg("receipt", 5.2, 0.4, 0.9),
  intro: seg("intro", 3.0, 0.2, 0.2),
  trailer: seg(null, 0, 0, 0, r2(trailerSeconds + 1.2)),
  other: existsSync(join(V, "other.mp4")) ? seg(null, 0, 0, 0, 5.4) : null,
  close: seg("close", 7.0, 0.9, 3.2),
};
const total = r2(t);
const at = (s: Seg, x: number) => r2(s.start + x);
const rate = (slot: number) => {
  const r = r2(Math.min(1, (plateSeconds - 0.05) / slot));
  return r < 1 ? ` data-playback-rate="${r}"` : "";
};

// ---------- helpers ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const words = (s: string, cls = "w") => s.split(/\s+/).filter(Boolean).map((w) => `<span class="${cls}">${esc(w)}</span>`).join(" ");
const money = (n: number) => `$${n.toFixed(2)}`;
const tl: string[] = [];
const push = (...lines: string[]) => tl.push(...lines);
/** A scene section that overlaps the next one by X seconds so scenes crossfade. */
const scene = (id: string, s: Seg, inner: string, track = 2) =>
  `<section id="${id}" class="clip scene" data-start="${s.start}" data-duration="${r2(s.dur + X)}" data-track-index="${track}"><div class="stage">${inner}</div></section>`;
/** Blur-to-sharp reveal: the house entrance. */
const rise = (sel: string, time: number, stagger = 0.06, dur = 1.1, y = 36) =>
  `tl.fromTo("${sel}", {opacity:0, y:${y}, filter:"blur(14px)"}, {opacity:1, y:0, filter:"blur(0px)", duration:${dur}, stagger:${stagger}, ease:"power4.out"}, ${r2(time)});`;
/** Exit: drift up, soften, fade — mirrors the entrance. */
const leave = (id: string, s: Seg) =>
  `tl.to("#${id} > .stage", {opacity:0, scale:1.035, filter:"blur(10px)", duration:0.5, ease:"power2.in"}, ${r2(s.end - 0.3)});`;
const drift = (id: string, s: Seg, from = 1, to = 1.035) =>
  `tl.fromTo("#${id} > .stage", {scale:${from}}, {scale:${to}, duration:${r2(s.dur - 0.35)}, ease:"none"}, ${s.start});`;

// ---------- 1 · hook ----------
const heroEl = hero
  ? `<div id="herow" class="fill"><video id="hero" class="clip" src="${hero}" data-start="0" data-duration="${r2(S.hook.dur + X)}"${rate(S.hook.dur + X)} data-track-index="0" muted playsinline></video><div class="fill hero-shade"></div></div>`
  : "";
const hook = scene("hook", S.hook, `
  <div class="center col">
    <h1 class="display h-hook">${words("Every repo deserves")}<br>${words("a launch trailer.")}</h1>
    <p class="lede h-sub">${words("Nobody has time to make one.", "w2")}</p>
  </div>`);
push(
  `tl.fromTo("#herow", {opacity:0, scale:1.12}, {opacity:0.62, scale:1, duration:${r2(S.hook.dur - 0.25)}, ease:"power2.out"}, 0);`,
  `tl.to("#herow", {opacity:0, duration:0.6, ease:"power2.in"}, ${r2(S.hook.end - 0.35)});`,
  rise("#hook .w", S.hook.vo - 0.2, 0.09, 1.2, 44),
  rise("#hook .w2", S.hook.vo + S.hook.voLen * 0.55, 0.05, 1, 20),
  `tl.to("#hook .h-hook", {opacity:0.55, y:-16, duration:1, ease:"power3.out"}, ${r2(S.hook.vo + S.hook.voLen * 0.55)});`,
  leave("hook", S.hook),
);

// ---------- 2 · reveal ----------
const reveal = scene("reveal", S.reveal, `
  <div class="glow" id="rv-glow"></div>
  <div class="center col">
    <div class="lockup"><div class="lk-mark">${SHIPREEL("mark-xl")}</div><div class="lk-word"><span class="wordmark">Shipreel</span></div></div>
    <p class="lede rv-tag">${words("An agent that directs your repo’s launch trailer.", "w2")}</p>
  </div>`);
push(
  `tl.fromTo("#rv-glow", {opacity:0, scale:0.6}, {opacity:1, scale:1, duration:2.2, ease:"power2.out"}, ${at(S.reveal, 0.3)});`,
  `tl.fromTo("#reveal .lk-mark svg", {opacity:0, scale:0.55, rotation:-10, filter:"blur(24px)"}, {opacity:1, scale:1, rotation:0, filter:"blur(0px)", duration:1.5, ease:"expo.out"}, ${at(S.reveal, 0.4)});`,
  `tl.fromTo("#reveal .lk-mark", {x:250}, {x:0, duration:1.3, ease:"power4.inOut"}, ${at(S.reveal, 1.25)});`,
  `tl.fromTo("#reveal .lk-word", {clipPath:"inset(0 100% 0 0)", x:250}, {clipPath:"inset(0 0% 0 0)", x:0, duration:1.3, ease:"power4.inOut"}, ${at(S.reveal, 1.25)});`,
  rise("#reveal .w2", at(S.reveal, 2.1), 0.05, 1, 20),
  leave("reveal", S.reveal),
);

// ---------- 3 · one command ----------
const cmdRepo = otherDir ? readReport(otherDir).repo : report.repo;
const cmdReport = otherDir ? readReport(otherDir) : report;
const logLines = [
  ["›", `reading ${cmdRepo}`],
  ["›", `storyboard · ${cmdReport.storyboard.scenes.length} scenes`],
  ["›", `estimate · ${money(cmdReport.estimate_usd)} before the first render`],
  ["✓", `trailer.mp4 · ${cmdReport.duration_s.toFixed(1)}s · ${money(cmdReport.spend_usd)}`],
];
const cmd = scene("cmd", S.cmd, `
  <div class="center col">
    <div class="glass term">
      <div class="term-bar"><i></i><i></i><i></i><span class="term-title mono">zsh — shipreel</span></div>
      <div class="term-body">
        <div class="prompt mono"><span class="grad">$</span> <span class="typed">bun shipreel ${esc(cmdRepo)}</span><span class="caret"></span></div>
        <div class="log mono">${logLines.map(([g, v]) => `<div class="ll"><span class="${g === "✓" ? "ok" : "dim"}">${g}</span> ${esc(v!)}</div>`).join("")}</div>
      </div>
    </div>
  </div>`);
const typeDur = 1.3;
push(
  `tl.fromTo("#cmd .term", {opacity:0, y:60, scale:0.96, filter:"blur(12px)"}, {opacity:1, y:0, scale:1, filter:"blur(0px)", duration:1.2, ease:"power4.out"}, ${at(S.cmd, 0)});`,
  `tl.fromTo("#cmd .typed", {clipPath:"inset(0 100% 0 0)"}, {clipPath:"inset(0 0% 0 0)", duration:${typeDur}, ease:"steps(${10 + cmdRepo.length})"}, ${at(S.cmd, 0.55)});`,
  `tl.fromTo("#cmd .caret", {opacity:1}, {opacity:0, duration:0.4, repeat:${Math.floor(S.cmd.dur / 0.8)}, yoyo:true, ease:"steps(1)"}, ${at(S.cmd, 0)});`,
  `tl.fromTo("#cmd .term", {scale:1}, {scale:0.985, duration:0.09, yoyo:true, repeat:1, ease:"power2.out", immediateRender:false}, ${at(S.cmd, 0.55 + typeDur + 0.25)});`,
  `tl.fromTo("#cmd .ll", {opacity:0, y:10}, {opacity:1, y:0, duration:0.5, stagger:0.42, ease:"power3.out"}, ${at(S.cmd, 0.55 + typeDur + 0.45)});`,
  leave("cmd", S.cmd),
);

// ---------- 4 · crew constellation ----------
const CX = 960, CY = 525, RX = 610, RY = 290;
const nodes = crew.map((c, i) => {
  const a = (-90 + i * 60) * (Math.PI / 180);
  return { ...c, x: Math.round(CX + RX * Math.cos(a)), y: Math.round(CY + RY * Math.sin(a)) };
});
// Spokes run hub edge → tile edge. Gradients use user-space coordinates: an objectBoundingBox
// gradient on a perfectly vertical line has a zero-width box and renders nothing.
const HUB_R = 130, TILE_HALF = 75, WIRE_GAP = 12;
const wires = nodes.map((n) => {
  const ox = n.x, oy = n.y - 11; // tile centre: the node box starts 86px above n.y, tile is 150px
  const dx = ox - CX, dy = oy - CY, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
  const toTileEdge = TILE_HALF / Math.max(Math.abs(ux), Math.abs(uy));
  const a = HUB_R + WIRE_GAP, b = d - toTileEdge - WIRE_GAP;
  return { x1: r2(CX + ux * a), y1: r2(CY + uy * a), x2: r2(CX + ux * b), y2: r2(CY + uy * b), len: Math.ceil(b - a) };
});
const crewEl = scene("crew", S.crew, `
  <svg class="fill wires" viewBox="0 0 1920 1080" aria-hidden="true">
    <defs>${wires.map((w, i) => `<linearGradient id="wire-g${i}" gradientUnits="userSpaceOnUse" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"><stop offset="0" stop-color="#ff9a2e" stop-opacity=".95"/><stop offset="1" stop-color="#ffffff" stop-opacity=".3"/></linearGradient>`).join("")}</defs>
    ${wires.map((w, i) => `<line id="wire${i}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="url(#wire-g${i})" stroke-width="2" stroke-linecap="round" stroke-dasharray="${w.len}" stroke-dashoffset="${w.len}"/>`).join("")}
  </svg>
  <div class="hub" style="left:${CX - 130}px; top:${CY - 130}px"><div class="hub-ring"></div>${LIVEPEER("lp-mark")}<span class="hub-name">Livepeer</span></div>
  ${nodes.map((n, i) => {
    const orb = `<div class="node-orb glass">${n.logo("node-logo")}</div>`;
    const labels = `<p class="node-role">${n.role}</p><p class="node-model mono">${esc(short(n.model))}</p>`;
    // The top node stacks its labels above the tile (90px of labels), so its spoke meets the tile directly.
    return i === 0
      ? `<div class="node node-top" id="node${i}" style="left:${n.x - 110}px; top:${n.y - 176}px">${labels}${orb}</div>`
      : `<div class="node" id="node${i}" style="left:${n.x - 110}px; top:${n.y - 86}px">${orb}${labels}</div>`;
  }).join("")}
  <p class="crew-line lede">${words("Six models. One network.", "w2")}</p>`);
push(
  `tl.fromTo("#crew .hub", {opacity:0, scale:0.5, filter:"blur(20px)"}, {opacity:1, scale:1, filter:"blur(0px)", duration:1.4, ease:"expo.out"}, ${at(S.crew, 0.1)});`,
  `tl.fromTo("#crew .hub-name", {opacity:0, y:12}, {opacity:1, y:0, duration:0.8, ease:"power3.out"}, ${at(S.crew, 0.6)});`,
  ...nodes.map((n, i) => `tl.fromTo("#node${i}", {opacity:0, x:${CX - n.x}, y:${CY - n.y}, scale:0.3, filter:"blur(16px)"}, {opacity:1, x:0, y:0, scale:1, filter:"blur(0px)", duration:1.25, ease:"power4.out"}, ${at(S.crew, 0.9 + i * 0.13)});`),
  ...nodes.map((_, i) => `tl.to("#wire${i}", {attr:{"stroke-dashoffset":0}, duration:1.0, ease:"power2.inOut"}, ${at(S.crew, 1.3 + i * 0.13)});`),
  `tl.fromTo("#crew .hub-ring", {scale:1, opacity:0.7}, {scale:1.5, opacity:0, duration:1.8, repeat:2, ease:"power2.out"}, ${at(S.crew, 1.2)});`,
  rise("#crew .w2", S.crew.vo + 0.1, 0.08, 1, 20),
  drift("crew", S.crew),
  `tl.to("#crew > .stage", {opacity:0, scale:1.6, filter:"blur(14px)", duration:${X + 0.3}, ease:"power3.in"}, ${r2(S.crew.end - 0.3)});`,
);

// ---------- 5 · director ----------
const cards = sb.scenes.map((s, i) => `
  <article class="card glass" id="card${i}">
    <div class="card-top"><span class="mono cn">${String(i + 1).padStart(2, "0")}</span><span class="ct">${esc(s.layout)}</span></div>
    <h3>${esc(s.headline)}</h3>
    <p class="cq">“${esc(s.narration)}”</p>
  </article>`).join("");
const director = scene("director", S.director, `
  <div class="glass readme" id="readme">
    <div class="readme-bar">${paint(GITHUB, "#fff", "gh-sm")}<span class="mono">README.md</span></div>
    <div class="readme-body mono">${readme.map((l) => `<p class="rl">${esc(l.replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 92))}</p>`).join("")}</div>
  </div>
  <div class="cards-wrap"><div class="cards" style="grid-template-columns:repeat(${sb.scenes.length}, 1fr)">${cards}</div></div>
  <div class="scene-head"><span class="sh-logo">${geminiMark("sh-mark")}</span><span class="sh-text">Director</span><span class="sh-sub mono">gemini-text on Livepeer</span></div>`);
const cardsAt = at(S.director, Math.min(2.6, S.director.dur * 0.34));
push(
  `tl.fromTo("#director .scene-head", {opacity:0, y:14}, {opacity:1, y:0, duration:0.9, ease:"power3.out"}, ${at(S.director, 0.2)});`,
  `tl.fromTo("#readme", {opacity:0, y:50, scale:0.96, filter:"blur(12px)"}, {opacity:1, y:0, scale:1, filter:"blur(0px)", duration:1.1, ease:"power4.out"}, ${at(S.director, 0.1)});`,
  `tl.fromTo("#readme .rl", {opacity:0}, {opacity:1, duration:0.3, stagger:0.1}, ${at(S.director, 0.5)});`,
  `tl.to("#readme", {y:-420, scale:0.72, opacity:0, filter:"blur(8px)", duration:1.1, ease:"power3.inOut"}, ${cardsAt});`,
  `tl.fromTo("#director .card", {opacity:0, y:120, rotationX:-28, filter:"blur(10px)"}, {opacity:1, y:0, rotationX:0, filter:"blur(0px)", duration:1.2, stagger:0.09, ease:"power4.out"}, ${r2(cardsAt + 0.35)});`,
  `tl.fromTo("#director .cards", {x:40}, {x:-40, duration:${r2(S.director.end - cardsAt + X)}, ease:"none"}, ${cardsAt});`,
  leave("director", S.director),
);

// ---------- 6 · critic: zoom out from one rejected take ----------
const cols = Math.min(6, Math.max(4, Math.ceil(takes.length / 2)));
const rows = Math.ceil(takes.length / cols);
const GAP = 22, TW = Math.floor((1720 - (cols - 1) * GAP) / cols), TH = Math.round(TW * 9 / 16);
const gridW = cols * TW + (cols - 1) * GAP, gridH = rows * (TH + 86) - 30;
const gx = Math.round((1920 - gridW) / 2), gy = Math.round(210 + (800 - gridH) / 2);
const tiles = takes.map((n, i) => {
  const x = gx + (i % cols) * (TW + GAP), y = gy + Math.floor(i / cols) * (TH + 86);
  const ok = n.verdict === "keep";
  const why = ok ? `on brief ${n.on_brief.toFixed(2)}` : n.issues && n.issues !== "none" ? n.issues : n.has_text ? "stray text" : "off brief";
  return { n, x, y, ok, html: `
  <figure class="tile ${ok ? "keep" : "bad"}" id="tile${i}" style="left:${x}px; top:${y}px; width:${TW}px">
    <div class="shot" style="height:${TH}px"><img src="assets/v2/${kfName(n)}" alt="" /></div>
    <figcaption><span class="mono tl">scene ${n.scene + 1} · take ${n.attempt}</span><span class="stamp">${ok ? "Keep" : "Reshoot"}</span></figcaption>
    <p class="why">${esc(why.slice(0, 40))}</p>
  </figure>` };
});
const focus = [...tiles].sort((a, b) => Number(b.n.has_text) - Number(a.n.has_text) || a.n.on_brief - b.n.on_brief)[0]!;
const FS = 2.7, fcx = focus.x + TW / 2, fcy = focus.y + TH / 2;
const critic = scene("critic", S.critic, `
  <div class="world" id="cworld">${tiles.map((x) => x.html).join("")}</div>
  <div class="scene-head">${paint(NVIDIA, "#76B900", "sh-mark")}<span class="sh-text">Critic</span><span class="sh-sub mono">nemotron-omni-vision on Livepeer</span></div>`);
const zoomOut = at(S.critic, Math.min(3.4, S.critic.dur * 0.36));
push(
  `tl.fromTo("#cworld", {scale:${FS}, x:${r2(960 - FS * fcx)}, y:${r2(560 - FS * fcy)}, opacity:0}, {opacity:1, duration:0.8, ease:"power2.out"}, ${at(S.critic, 0)});`,
  `tl.fromTo("#tile${tiles.indexOf(focus)} .stamp, #tile${tiles.indexOf(focus)} .why", {opacity:0, y:6}, {opacity:1, y:0, duration:0.5, stagger:0.15, ease:"power3.out"}, ${at(S.critic, 1.0)});`,
  `tl.to("#tile${tiles.indexOf(focus)} .shot", {opacity:0.45, duration:0.6}, ${at(S.critic, 1.8)});`,
  `tl.to("#cworld", {scale:1, x:0, y:0, duration:2.4, ease:"power3.inOut"}, ${zoomOut});`,
  `tl.fromTo("#critic .scene-head", {opacity:0, y:14}, {opacity:1, y:0, duration:0.9, ease:"power3.out"}, ${r2(zoomOut + 1.2)});`,
  `tl.fromTo("${tiles.filter((x) => x !== focus).map((x) => `#${"tile" + tiles.indexOf(x)} .stamp`).join(", ")}", {opacity:0, scale:0.7}, {opacity:1, scale:1, duration:0.45, stagger:0.14, ease:"power3.out"}, ${r2(zoomOut + 1.4)});`,
  `tl.fromTo("${tiles.filter((x) => x !== focus).map((x) => `#${"tile" + tiles.indexOf(x)} .why`).join(", ")}", {opacity:0}, {opacity:1, duration:0.4, stagger:0.14}, ${r2(zoomOut + 1.55)});`,
  `tl.to("${tiles.filter((x) => !x.ok && x !== focus).map((x) => `#${"tile" + tiles.indexOf(x)} .shot`).join(", ") || "#none"}", {opacity:0.45, duration:0.5, stagger:0.14}, ${r2(zoomOut + 1.7)});`,
  leave("critic", S.critic),
);

// ---------- 7 · motion: a still comes alive ----------
const mScene = plates.find((i) => i === 1) ?? plates[0] ?? 0;
const mKf = kept(mScene);
const FW = 1280, FH = 720, FX = 320, FY = 150;
const motionFrame = `<div id="mframe" style="left:${FX}px; top:${FY}px; width:${FW}px; height:${FH}px">
    <img class="fill cover" src="assets/v2/${kfName(mKf)}" alt="" />
    <div id="miris" class="fill"><video id="mvid" class="clip cover-v" src="assets/v2/plate${mScene}.mp4" data-start="${S.motion.start}" data-duration="${r2(S.motion.dur + X)}"${rate(S.motion.dur + X)} data-track-index="1" muted playsinline></video></div>
    <div class="chip glass" id="chip-still">${BFL("chip-logo")}<span>Keyframe</span><span class="mono chip-m">${esc(short(crew[1]!.model))}</span></div>
    <div class="chip glass" id="chip-live">${crew[3]!.logo("chip-logo")}<span>Motion</span><span class="mono chip-m">${esc(short(crew[3]!.model))}</span></div>
  </div>`;
const bars = (vals: number[], cls: string) => vals.map((v) => `<i class="${cls}" style="height:${Math.round(v * 56)}px"></i>`).join("");
const motion = scene("motion", S.motion, `
  <div class="waves">
    <div class="wave"><span class="wl">${geminiMark("wl-logo")}Voice</span><div class="bars">${bars(voiceBars, "vb")}</div></div>
    <div class="wave"><span class="wl">${img("assets/logos/sonilo.png", "wl-logo")}Score</span><div class="bars">${bars(scoreBars, "sb")}</div></div>
  </div>`);
const irisAt = at(S.motion, 1.5);
push(
  `tl.fromTo("#mframe", {opacity:0, y:50, scale:0.94, filter:"blur(14px)"}, {opacity:1, y:0, scale:1, filter:"blur(0px)", duration:1.2, ease:"power4.out"}, ${at(S.motion, 0)});`,
  `tl.fromTo("#chip-still", {opacity:0, y:10}, {opacity:1, y:0, duration:0.7, ease:"power3.out"}, ${at(S.motion, 0.5)});`,
  `tl.fromTo("#miris", {clipPath:"circle(0% at 50% 50%)"}, {clipPath:"circle(75% at 50% 50%)", duration:1.4, ease:"power3.inOut"}, ${irisAt});`,
  `tl.to("#chip-still", {opacity:0, y:-10, duration:0.4}, ${r2(irisAt + 0.3)});`,
  `tl.fromTo("#chip-live", {opacity:0, y:10}, {opacity:1, y:0, duration:0.7, ease:"power3.out"}, ${r2(irisAt + 0.6)});`,
  `tl.to("#mframe", {y:-70, scale:0.8, duration:1.3, ease:"power3.inOut"}, ${r2(irisAt + 2.2)});`,
  `tl.fromTo("#motion .wave", {opacity:0, y:20}, {opacity:1, y:0, duration:0.8, stagger:0.2, ease:"power3.out"}, ${r2(irisAt + 2.6)});`,
  `tl.fromTo("#motion .vb", {scaleY:0}, {scaleY:1, duration:0.5, stagger:0.01, ease:"power2.out"}, ${r2(irisAt + 2.8)});`,
  `tl.fromTo("#motion .sb", {scaleY:0}, {scaleY:1, duration:0.5, stagger:0.01, ease:"power2.out"}, ${r2(irisAt + 3.2)});`,
  `tl.to("#mframe", {opacity:0, scale:0.83, filter:"blur(10px)", duration:${X + 0.2}, ease:"power2.in"}, ${r2(S.motion.end - 0.2)});`,
  leave("motion", S.motion),
);

// ---------- 8 · words: glyph soup vs real type ----------
const soup = [...takes].sort((a, b) => Number(b.has_text) - Number(a.has_text) || a.on_brief - b.on_brief)[0]!;
copyFileSync(join(V, kfName(soup)), join(V, "soup.jpg"));
const tScene = plates.includes(1) ? 1 : plates[0] ?? 0;
const PW = 820, PH = 461, PY = 300;
const words8 = scene("words", S.words, `
  <div class="pane" id="pane-l" style="left:${960 - PW - 30}px; top:${PY}px; width:${PW}px; height:${PH}px"><img class="fill cover" id="soup-img" src="assets/v2/soup.jpg" alt="" /></div>
  <div class="cap-row" style="top:${PY + PH + 34}px">
    <div class="capx" style="left:${960 - PW - 30}px"><span class="pill bad-p">Model-drawn text</span><span class="cap-t">${esc(soup.issues.slice(0, 46))}</span></div>
    <div class="capx" style="left:990px"><span class="pill ok-p">Real type</span><span class="cap-t">set by ${img("assets/logos/hyperframes.svg", "hf-inline")}</span></div>
  </div>
  <h2 class="headline w-head">${words("AI video can’t spell.", "wa")} <span class="grad-t">${words("HTML can.", "wb")}</span></h2>`);
const wordsVideo = `<div id="wvw" style="left:990px; top:${PY}px; width:${PW}px; height:${PH}px"><video id="wv" class="clip cover-v" src="assets/v2/plate${tScene}.mp4" data-start="${S.words.start}" data-duration="${r2(S.words.dur + X)}"${rate(S.words.dur + X)} data-track-index="1" muted playsinline></video><div class="type-layer"><div class="tl-lock">${SHIPREEL("tl-mark")}<span class="tl-title">${esc(sb.title)}</span></div><p class="tl-tag">${esc(sb.tagline)}</p><div class="wire"><span class="mono">&lt;h1&gt; Inter 800 · HTML</span></div></div></div>`;
const typeAt = r2(S.words.vo + S.words.voLen * 0.42);
push(
  rise("#words .wa", at(S.words, 0.2), 0.07, 1.1, 30),
  // The type layer lives inside #wvw with its video, so both share one transform.
  `tl.fromTo("#pane-l", {opacity:0, x:-60, rotationY:14, transformPerspective:1800, filter:"blur(12px)"}, {opacity:1, x:0, rotationY:6, filter:"blur(0px)", duration:1.3, ease:"power4.out"}, ${at(S.words, 0.4)});`,
  `tl.fromTo("#wvw", {opacity:0, x:60, rotationY:-14, transformPerspective:1800, filter:"blur(12px)"}, {opacity:1, x:0, rotationY:-6, filter:"blur(0px)", duration:1.3, ease:"power4.out"}, ${at(S.words, 0.6)});`,
  `tl.fromTo("#words .capx", {opacity:0, y:10}, {opacity:1, y:0, duration:0.7, stagger:${r2(typeAt - at(S.words, 1.2))}, ease:"power3.out"}, ${at(S.words, 1.2)});`,
  // Push in on the model-drawn text until the scramble is legible.
  `tl.fromTo("#soup-img", {scale:1.1, transformOrigin:"55% 52%"}, {scale:1.85, duration:${r2(S.words.dur)}, ease:"power2.inOut"}, ${at(S.words, 0.4)});`,
  rise("#words .wb", typeAt, 0.08, 1, 24),
  `tl.fromTo("#wvw .tl-lock", {opacity:0, scale:0.9, filter:"blur(16px)"}, {opacity:1, scale:1, filter:"blur(0px)", duration:1.1, ease:"expo.out"}, ${typeAt});`,
  `tl.fromTo("#wvw .tl-tag, #wvw .wire", {opacity:0}, {opacity:1, duration:0.6, stagger:0.35}, ${r2(typeAt + 0.5)});`,
  `tl.to("#wvw", {opacity:0, scale:1.035, filter:"blur(10px)", duration:${X + 0.2}, ease:"power2.in"}, ${r2(S.words.end - 0.2)});`,
  leave("words", S.words),
);

// ---------- 9 · receipt: keynote stats ----------
const wall = `${Math.floor(report.wall_clock_s / 60)}:${String(report.wall_clock_s % 60).padStart(2, "0")}`;
const receipt = scene("receipt", S.receipt, `
  <div class="stats">
    <div class="stat"><p class="big grad-t" id="st-spend">$0.00</p><p class="st-l">spent on the network</p></div>
    <div class="stat"><p class="big" id="st-calls">0</p><p class="st-l">Livepeer calls</p></div>
    <div class="stat"><p class="big">${wall}</p><p class="st-l">start to finish</p></div>
  </div>
  <p class="st-foot">${words(`Estimated at ${money(report.estimate_usd)} before the first render.`, "w2")}</p>`);
push(
  rise("#receipt .stat", at(S.receipt, 0.2), 0.15, 1.1, 40),
  `(() => { const o = {v:0}; tl.to(o, {v:${report.spend_usd}, duration:1.6, ease:"power3.out", onUpdate(){ document.getElementById("st-spend").textContent = "$" + o.v.toFixed(2); }}, ${at(S.receipt, 0.4)}); })();`,
  `(() => { const o = {v:0}; tl.to(o, {v:${report.calls}, duration:1.6, ease:"power3.out", onUpdate(){ document.getElementById("st-calls").textContent = Math.round(o.v); }}, ${at(S.receipt, 0.55)}); })();`,
  rise("#receipt .w2", S.receipt.vo + S.receipt.voLen * 0.5, 0.05, 0.9, 16),
  leave("receipt", S.receipt),
);

// ---------- 10 · intro + trailer in a window that becomes the screen ----------
const intro = scene("intro", S.intro, `<div class="center"><p class="headline">${words("This is the trailer it made about itself.", "w3")}</p></div>`);
push(rise("#intro .w3", at(S.intro, 0.15), 0.06, 1, 24), `tl.to("#intro > .stage", {opacity:0, y:-40, filter:"blur(10px)", duration:0.6, ease:"power2.in"}, ${r2(S.intro.end - 0.45)});`);
const winAt = r2(S.trailer.start + 0.15); // after the intro line has cleared
const trailerEl = `<div id="tw"><video id="trailer" class="clip" src="assets/v2/trailer.mp4" data-start="${winAt}" data-duration="${r2(trailerSeconds)}" data-track-index="1" muted playsinline></video></div>
      <audio id="trailer-audio" src="assets/v2/trailer.mp4" data-start="${winAt}" data-duration="${r2(trailerSeconds)}" data-track-index="12" data-volume="1"></audio>`;
push(
  `tl.fromTo("#tw", {opacity:0, scale:0.56, rotationX:14, y:80, borderRadius:28}, {opacity:1, scale:0.66, rotationX:0, y:0, duration:1.1, ease:"power4.out"}, ${winAt});`,
  `tl.to("#tw", {scale:1, borderRadius:0, duration:1.3, ease:"power3.inOut"}, ${r2(winAt + 1.2)});`,
  `tl.to("#tw", {scale:0.66, borderRadius:28, duration:1.1, ease:"power3.inOut"}, ${r2(winAt + trailerSeconds - 1.2)});`,
  `tl.to("#tw", {opacity:0, scale:0.62, filter:"blur(10px)", duration:0.6, ease:"power2.in"}, ${r2(winAt + trailerSeconds - 0.1)});`,
);

// ---------- 11 · another repo ----------
let other = "";
if (S.other) {
  const o = readReport(otherDir!);
  const cuts = (o as Report & { cuts?: { start: number }[] }).cuts ?? [];
  const ti = o.storyboard.scenes.findIndex((x) => x.layout === "title");
  const oStart = r2(Math.max(0, Math.min(o.duration_s - S.other.dur, (cuts[ti]?.start ?? 4) + 0.2)));
  other = `<div id="ow"><video id="ov" class="clip" src="assets/v2/other.mp4" data-start="${S.other.start}" data-duration="${r2(S.other.dur + X)}" data-media-start="${oStart}" data-track-index="1" muted playsinline></video></div>
      <audio id="ov-audio" src="assets/v2/other.mp4" data-start="${S.other.start}" data-duration="${r2(S.other.dur + X)}" data-media-start="${oStart}" data-track-index="12" data-volume="0.9" data-automation='${JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: r2(S.other.dur - 0.2), v: 1 }, { t: r2(S.other.dur + X), v: 0 }] }] })}'></audio>
      ${scene("other", S.other, `<p class="headline o-head">${words("Point it at any repo.", "w4")}</p><p class="o-sub mono">${paint(GITHUB, "#fff", "gh-sm")} ${esc(o.repo)}</p>`)}`;
  push(
    `tl.fromTo("#ow", {opacity:0, scale:0.52, y:120, filter:"blur(12px)"}, {opacity:1, scale:0.6, y:70, filter:"blur(0px)", duration:1.2, ease:"power4.out"}, ${at(S.other, 0.1)});`,
    rise("#other .w4", at(S.other, 0.3), 0.07, 1, 24),
    `tl.fromTo("#other .o-sub", {opacity:0}, {opacity:1, duration:0.8}, ${at(S.other, 0.9)});`,
    `tl.to("#ow", {opacity:0, scale:0.64, filter:"blur(10px)", duration:${X + 0.2}, ease:"power2.in"}, ${r2(S.other.end - 0.2)});`,
    leave("other", S.other),
  );
}

// ---------- 12 · close ----------
const close = scene("close", S.close, `
  <div class="glow" id="cl-glow"></div>
  <div class="center col">
    <div class="lockup"><div class="lk-mark">${SHIPREEL("mark-xl")}</div><div class="lk-word"><span class="wordmark">Shipreel</span></div></div>
    <p class="lede cl-tag">${words("Every repo deserves a launch trailer.", "w2")}</p>
    <div class="cl-row">
      <span class="cl-chip">${paint(GITHUB, "#fff", "cl-logo")}<span class="mono">${REPO_URL}</span></span>
      <span class="cl-chip">${LIVEPEER("cl-logo")}<span>Built on Livepeer</span></span>
      <span class="cl-chip"><span>Cut with</span>${img("assets/logos/hyperframes.svg", "cl-hf")}</span>
    </div>
    <p class="cl-foot mono">Livepeer Agent Hackathon · Track 01 · Agent Builder</p>
  </div>`, 2);
push(
  `tl.fromTo("#cl-glow", {opacity:0, scale:0.6}, {opacity:1, scale:1, duration:2.4, ease:"power2.out"}, ${at(S.close, 0.2)});`,
  `tl.fromTo("#close .lk-mark svg", {opacity:0, scale:0.55, filter:"blur(24px)"}, {opacity:1, scale:1, filter:"blur(0px)", duration:1.4, ease:"expo.out"}, ${at(S.close, 0.3)});`,
  `tl.fromTo("#close .lk-mark", {x:250}, {x:0, duration:1.2, ease:"power4.inOut"}, ${at(S.close, 0.9)});`,
  `tl.fromTo("#close .lk-word", {clipPath:"inset(0 100% 0 0)", x:250}, {clipPath:"inset(0 0% 0 0)", x:0, duration:1.2, ease:"power4.inOut"}, ${at(S.close, 0.9)});`,
  rise("#close .w2", at(S.close, 1.4), 0.06, 1, 20),
  `tl.fromTo("#close .cl-chip", {opacity:0, y:18, filter:"blur(8px)"}, {opacity:1, y:0, filter:"blur(0px)", duration:0.9, stagger:0.16, ease:"power4.out"}, ${at(S.close, 2.2)});`,
  `tl.fromTo("#close .cl-foot", {opacity:0}, {opacity:1, duration:0.8}, ${at(S.close, 2.9)});`,
  `tl.to("#close > .stage", {opacity:0, duration:0.9, ease:"power2.in"}, ${r2(total - 0.9)});`,
);

// ---------- audio ----------
const voKeys = ["hook", "reveal", "cmd", "crew", "director", "critic", "motion", "words", "receipt", "intro", "close"] as const;
const segOf = (k: (typeof voKeys)[number]) => S[k] as Seg;
const voEls = voKeys.map((k) => `<audio id="vo-${k}" src="${audio.vo[k]!.file}" data-start="${segOf(k).vo}" data-duration="${audio.vo[k]!.seconds}" data-track-index="10" data-volume="1"></audio>`).join("\n      ");
const tStart = winAt, tEnd = r2(winAt + trailerSeconds);
// Volume lane: fade in, duck under each voice line, fade out; `t` is clip-local.
function lane(len: number, offset: number, keys: readonly (typeof voKeys)[number][], fadeOut: number) {
  const hi = 0.55, lo = 0.2;
  const pts: { t: number; v: number }[] = [{ t: 0, v: 0 }, { t: 1.2, v: hi }];
  for (const k of keys) {
    const s = segOf(k), a = s.vo - offset;
    pts.push({ t: a - 0.3, v: hi }, { t: a, v: lo }, { t: a + s.voLen, v: lo }, { t: a + s.voLen + 0.5, v: hi });
  }
  pts.push({ t: len - fadeOut, v: hi }, { t: len, v: 0 });
  const clean = pts.map((p) => ({ t: r2(Math.max(0, Math.min(len, p.t))), v: p.v })).sort((a, b) => a.t - b.t).filter((p, i, a) => i === 0 || p.t > a[i - 1]!.t);
  return JSON.stringify({ version: 1, lanes: [{ target: "volume", points: clean }] });
}
// The trailer brings its own score, so the bed stops for it and returns on its closing swell.
const bed1Len = r2(tStart + 0.5);
// After the trailer, the other repo's window plays its own sound; the bed returns for the close.
const bed2Start = r2((S.other ? S.close.start : tEnd) - 0.4), bed2Len = r2(total - bed2Start);
const bed = `<audio id="bed" src="${audio.bed}" data-start="0" data-duration="${bed1Len}" data-track-index="11" data-volume="1" data-automation='${lane(bed1Len, 0, voKeys.filter((k) => k !== "close"), 1.4)}'></audio>
      <audio id="bed-close" src="${audio.bed}" data-start="${bed2Start}" data-duration="${bed2Len}" data-media-start="${r2(Math.max(0, 111 - bed2Len))}" data-track-index="11" data-volume="1" data-automation='${lane(bed2Len, bed2Start, ["close"], 2.6)}'></audio>`;
const fx: string[] = [];
const fxLen: Record<string, number> = {};
for (const [k, f] of Object.entries(audio.sfx)) fxLen[k] = r2(await probe(join(demo, f)));
const sfx = (name: string, time: number, vol: number) => {
  if (!audio.sfx[name]) return;
  fx.push(`<audio id="fx${fx.length}" src="${audio.sfx[name]}" data-start="${r2(Math.max(0, time))}" data-duration="${fxLen[name]}" data-track-index="${13 + (fx.length % 2)}" data-volume="${vol}"></audio>`);
};
sfx("bloom", at(S.reveal, 0.15), 0.55);
sfx("key", at(S.cmd, 0.55 + typeDur + 0.2), 0.6);
sfx("whoosh", r2(S.crew.end - 0.35), 0.4);
sfx("whoosh", r2(zoomOut - 0.1), 0.35);
sfx("tick", r2(irisAt + 0.1), 0.4);
sfx("whoosh", r2(winAt + 1.1), 0.4);
sfx("bloom", at(S.close, 0.25), 0.5);

// ---------- page ----------
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Shipreel — Livepeer Agent Hackathon</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Inter"; src: url("assets/fonts/Inter.woff2") format("woff2"); font-weight: 300 800; }
      @font-face { font-family: "JetBrains Mono"; src: url("assets/fonts/JetBrainsMono.woff2") format("woff2"); font-weight: 500; }
      :root { --ink:#f5f5f7; --soft:#c9c9cf; --line:rgba(255,255,255,.14); --glass:rgba(255,255,255,.06); --o1:#ff9a2e; --o2:#ff4a00; --o3:#ff2d6f; --keep:#30d158; --bad:#ff453a; }
      body { margin:0; background:#000; color:var(--ink); font-family:"Inter", sans-serif; -webkit-font-smoothing:antialiased; }
      #root { position:relative; width:100%; height:100%; overflow:hidden; background:#000; perspective:1800px; }
      .fill { position:absolute; inset:0; }
      .mono { font-family:"JetBrains Mono", monospace; }
      .scene, .stage { position:absolute; inset:0; }
      .stage { transform-origin:50% 50%; }
      .center { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
      .col { flex-direction:column; text-align:center; }
      .w, .w2, .w3, .w4, .wa, .wb { display:inline-block; }
      .display { margin:0; font-size:132px; font-weight:700; letter-spacing:-0.045em; line-height:1.0; }
      .headline { margin:0; font-size:84px; font-weight:700; letter-spacing:-0.04em; line-height:1.05; text-align:center; }
      .lede { margin:0; font-size:46px; font-weight:500; letter-spacing:-0.015em; color:var(--soft); }
      .grad, .grad-t { background:linear-gradient(90deg, var(--o1), var(--o2) 55%, var(--o3)); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .glass { background:var(--glass); border:1px solid var(--line); backdrop-filter:blur(30px) saturate(160%); box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 40px 120px rgba(0,0,0,.55); }
      #herow video, .cover, .cover-v { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
      .hero-shade { background:radial-gradient(90% 80% at 50% 50%, rgba(0,0,0,.2), rgba(0,0,0,.85)); }
      .h-sub { margin-top:44px; }
      .glow { position:absolute; left:360px; top:40px; width:1200px; height:1000px; border-radius:50%; background:radial-gradient(closest-side, rgba(255,110,20,.28), rgba(255,60,0,.08) 55%, transparent); }
      .lockup { display:flex; align-items:center; gap:44px; } .lk-mark { position:relative; z-index:2; } .lk-word { position:relative; z-index:1; }
      .mark-xl { width:190px; height:190px; display:block; filter:drop-shadow(0 20px 60px rgba(255,90,0,.45)); }
      .wordmark { font-size:200px; font-weight:800; letter-spacing:-0.055em; line-height:1; display:block; }
      .rv-tag, .cl-tag { margin-top:48px; }
      .term { width:1180px; border-radius:26px; overflow:hidden; text-align:left; }
      .term-bar { display:flex; align-items:center; gap:12px; padding:20px 26px; border-bottom:1px solid var(--line); }
      .term-bar i { width:15px; height:15px; border-radius:50%; background:rgba(255,255,255,.22); }
      .term-bar i:nth-child(1) { background:#ff5f57; } .term-bar i:nth-child(2) { background:#febc2e; } .term-bar i:nth-child(3) { background:#28c840; }
      .term-title { margin-left:auto; margin-right:auto; font-size:19px; color:var(--soft); transform:translateX(-40px); }
      .term-body { padding:40px 48px 46px; }
      .prompt { font-size:44px; display:flex; align-items:center; gap:18px; }
      .typed { display:inline-block; white-space:pre; }
      .caret { display:inline-block; width:4px; height:48px; background:var(--o1); margin-left:-10px; }
      .log { margin-top:34px; font-size:27px; line-height:1.9; color:var(--ink); }
      .dim { color:var(--o1); } .ok { color:var(--keep); }
      .wires { width:100%; height:100%; }
      .hub { position:absolute; width:260px; height:260px; border-radius:50%; display:flex; align-items:center; justify-content:center;
        background:radial-gradient(circle at 50% 35%, rgba(255,255,255,.12), rgba(255,255,255,.03)); border:1px solid rgba(255,255,255,.2); box-shadow:0 0 120px rgba(255,120,30,.25), inset 0 1px 0 rgba(255,255,255,.2); }
      .hub-ring { position:absolute; inset:-2px; border-radius:50%; border:2px solid rgba(255,154,46,.6); }
      .hub { flex-direction:column; }
      .lp-mark { width:74px; height:auto; }
      .hub-name { margin-top:16px; font-size:30px; font-weight:700; letter-spacing:-0.02em; }
      .node { position:absolute; width:220px; display:flex; flex-direction:column; align-items:center; }
      .node-orb { width:150px; height:150px; border-radius:42px; display:flex; align-items:center; justify-content:center; }
      .node-logo { width:78px; height:78px; object-fit:contain; border-radius:12px; }
      .node-role { margin:18px 0 0; line-height:40px; font-size:32px; font-weight:700; letter-spacing:-0.02em; }
      .node-model { margin:6px 0 0; line-height:26px; font-size:21px; color:var(--soft); }
      .node-top .node-role { margin:0; } .node-top .node-orb { margin-top:18px; }
      .crew-line { position:absolute; left:0; right:0; bottom:28px; text-align:center; color:var(--ink); font-weight:600; }
      .scene-head { position:absolute; left:110px; top:78px; display:flex; align-items:center; gap:18px; }
      .sh-mark { width:40px; height:40px; }
      .sh-text { font-size:44px; font-weight:700; letter-spacing:-0.03em; }
      .sh-sub { font-size:20px; color:var(--soft); margin-left:10px; }
      .readme { position:absolute; left:360px; top:230px; width:1200px; border-radius:24px; overflow:hidden; }
      .readme-bar { display:flex; align-items:center; gap:14px; padding:20px 28px; border-bottom:1px solid var(--line); font-size:22px; }
      .gh-sm { width:26px; height:26px; }
      .readme-body { padding:26px 32px 30px; font-size:22px; line-height:1.75; }
      .rl { margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .rl:first-child { font-family:"Inter", sans-serif; font-size:40px; font-weight:800; margin-bottom:10px; }
      .cards-wrap { position:absolute; left:0; right:0; top:230px; perspective:1400px; }
      .cards { display:grid; gap:20px; padding:0 110px; }
      .card { border-radius:22px; padding:26px 22px 28px; min-height:560px; transform-origin:50% 100%; }
      .card-top { display:flex; justify-content:space-between; margin-bottom:26px; }
      .cn { font-size:20px; color:var(--soft); } .ct { font-size:16px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--o1); }
      .card h3 { margin:0 0 20px; font-size:38px; line-height:1.04; letter-spacing:-0.03em; font-weight:700; }
      .cq { margin:0; font-size:24px; line-height:1.38; color:var(--ink); }
      .world { position:absolute; left:0; top:0; width:1920px; height:1080px; transform-origin:0 0; }
      .tile { position:absolute; margin:0; }
      .shot { border-radius:14px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.5); outline:2px solid transparent; }
      .tile.bad .shot { outline-color:var(--bad); } .tile.keep .shot { outline-color:rgba(48,209,88,.8); }
      .shot img { width:100%; height:100%; object-fit:cover; display:block; }
      .tile figcaption { display:flex; justify-content:space-between; align-items:center; margin-top:14px; }
      .tl { font-size:15px; color:var(--soft); white-space:nowrap; }
      .stamp { font-size:14px; font-weight:700; padding:5px 11px; border-radius:999px; white-space:nowrap; }
      .tile.keep .stamp { background:var(--keep); color:#03170a; } .tile.bad .stamp { background:var(--bad); color:#fff; }
      .why { margin:8px 0 0; font-size:17px; font-weight:500; line-height:1.3; }
      #mframe, #wvw, #ow { position:absolute; border-radius:26px; overflow:hidden; box-shadow:0 50px 140px rgba(0,0,0,.7); }
      .chip { position:absolute; left:28px; bottom:28px; display:flex; align-items:center; gap:14px; padding:14px 22px; border-radius:999px; font-size:24px; font-weight:600; background:rgba(0,0,0,.45); }
      .chip-logo { width:30px; height:30px; object-fit:contain; border-radius:7px; }
      .chip-m { font-size:19px; color:var(--soft); font-weight:500; }
      .waves { position:absolute; left:250px; right:250px; bottom:70px; display:flex; flex-direction:column; gap:18px; }
      .wave { display:flex; align-items:center; gap:28px; height:56px; }
      .wl { width:170px; display:flex; align-items:center; gap:12px; font-size:24px; font-weight:600; }
      .wl-logo { width:30px; height:30px; object-fit:contain; border-radius:7px; }
      .bars { flex:1; display:flex; align-items:center; gap:4px; height:56px; }
      .bars i { flex:1; border-radius:3px; }
      .vb { background:var(--ink); } .sb { background:linear-gradient(180deg, var(--o1), var(--o2)); }
      .w-head { position:absolute; left:0; right:0; top:142px; }
      .pane, .pane-type { position:absolute; border-radius:24px; overflow:hidden; }
      .pane { box-shadow:0 50px 140px rgba(0,0,0,.7); }
      .type-layer { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,.3); }
      .tl-lock { display:flex; align-items:center; gap:22px; }
      .tl-mark { width:84px; height:84px; }
      .tl-title { font-size:108px; font-weight:800; letter-spacing:-0.05em; line-height:1; }
      .tl-tag { margin:22px 0 0; font-size:28px; font-weight:500; }
      .wire { position:absolute; left:11%; right:11%; top:27%; bottom:43%; border:1.5px dashed rgba(255,255,255,.75); border-radius:6px; }
      .wire span { position:absolute; left:-1px; top:-32px; font-size:15px; background:var(--ink); color:#000; padding:4px 9px; border-radius:4px; }
      .cap-row { position:absolute; left:0; right:0; }
      .capx { position:absolute; display:flex; align-items:center; gap:16px; }
      .pill { font-size:18px; font-weight:700; padding:7px 15px; border-radius:999px; }
      .bad-p { background:var(--bad); color:#fff; } .ok-p { background:var(--keep); color:#03170a; }
      .cap-t { font-size:22px; font-weight:500; display:flex; align-items:center; gap:12px; }
      .hf-inline { height:34px; }
      .stats { position:absolute; left:0; right:0; top:300px; display:flex; justify-content:center; gap:150px; }
      .stat { text-align:center; }
      .big { margin:0; font-size:190px; font-weight:800; letter-spacing:-0.06em; line-height:1; font-variant-numeric:tabular-nums; }
      .st-l { margin:22px 0 0; font-size:34px; font-weight:500; color:var(--soft); }
      .st-foot { position:absolute; left:0; right:0; top:760px; margin:0; text-align:center; font-size:34px; font-weight:500; color:var(--ink); }
      #tw { position:absolute; left:0; top:0; width:1920px; height:1080px; overflow:hidden; transform-origin:50% 50%; box-shadow:0 60px 160px rgba(0,0,0,.8); }
      #tw video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
      #ow { left:0; top:0; width:1920px; height:1080px; transform-origin:50% 50%; }
      .o-head { position:absolute; left:0; right:0; top:70px; }
      .o-sub { position:absolute; left:0; right:0; top:178px; margin:0; text-align:center; font-size:26px; color:var(--soft); display:flex; justify-content:center; align-items:center; gap:12px; }
      .cl-row { display:flex; gap:18px; margin-top:64px; }
      .cl-chip { display:flex; align-items:center; gap:14px; padding:16px 26px; border-radius:999px; border:1px solid var(--line); background:var(--glass); font-size:24px; font-weight:600; }
      .cl-logo { width:28px; height:28px; }
      .cl-hf { height:32px; }
      .cl-foot { margin:40px 0 0; font-size:20px; letter-spacing:.06em; color:var(--soft); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${total}">
      ${heroEl}
      ${hook}
      ${reveal}
      ${cmd}
      ${crewEl}
      ${director}
      ${critic}
      ${motionFrame}
      ${motion}
      ${wordsVideo}
      ${words8}
      ${receipt}
      ${intro}
      ${trailerEl}
      ${other}
      ${close}
      ${voEls}
      ${bed}
      ${fx.join("\n      ")}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${tl.join("\n      ")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
writeFileSync(join(demo, "index.html"), html);
console.log(`demo v2: ${total.toFixed(1)}s`, Object.fromEntries(Object.entries(S).filter(([, s]) => s).map(([k, s]) => [k, `${s!.start}+${s!.dur}`])));
