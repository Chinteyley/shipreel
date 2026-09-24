// Editor: writes a HyperFrames project (index.html + local assets) from the
// storyboard and the rendered media. Generative footage sits underneath;
// every word and mark on screen is real HTML type or a real logo, timed to
// the voiceover. Motion is critically damped (no bounce): blur-to-sharp
// reveals, masked lines, soft crossfades between plates.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Brand } from "./brand.ts";
import type { Storyboard } from "./director.ts";

export interface SceneMedia {
  plate: string; // local path relative to project dir
  plateIsVideo: boolean;
  plateSeconds: number; // source length for video plates
  vo: string;
  voSeconds: number;
}

export interface Cut { start: number; duration: number; voStart: number; rate: number }

export interface Proof { stars: number | null; license: string | null }

const XF = 0.6; // plate crossfade
const r2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const words = (s: string, cls: string) =>
  s.split(/\s+/).filter(Boolean).map((w) => `<span class="${cls}">${esc(w)}</span>`).join(" ");
const masked = (cls: string, text: string, tag = "p") =>
  `<${tag} class="${cls} mask"><span class="line">${esc(text)}</span></${tag}>`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

// Static film grain: a fixed-seed turbulence tile, so every render is identical.
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;

/** Lay scenes end to end, each long enough for its voiceover line plus breathing room. */
export function cutList(sb: Storyboard, media: SceneMedia[]): Cut[] {
  let t = 0;
  const last = sb.scenes.length - 1;
  return sb.scenes.map((s, i) => {
    const m = media[i]!;
    const lead = i === 0 ? 0.8 : 0.45;
    const tail = s.layout === "end" ? 2.4 : s.layout === "title" ? 1.3 : 0.9;
    const duration = r2(Math.min(Math.max(lead + m.voSeconds + tail, 3.6), 8.5));
    // A plate keeps playing under the next one while it crossfades in.
    const slot = duration + (i < last ? XF : 0);
    const rate = m.plateIsVideo ? r2(Math.min(1, (m.plateSeconds - 0.05) / slot)) : 1;
    const cut = { start: r2(t), duration, voStart: r2(t + lead), rate };
    t += duration;
    return cut;
  });
}

function logoMark(brand: Brand, cls: string) {
  if (!brand.logo) return "";
  return `<img class="mark ${cls}${brand.logoIsRaster ? " raster" : ""}" src="${brand.logo}" alt="" />`;
}

function proofChips(brand: Brand, proof: Proof) {
  const chips: string[] = [];
  if (proof.stars !== null && brand.githubSvg) {
    chips.push(`<span class="chip">${brand.githubSvg}<b>${compact(proof.stars)}</b> stars</span>`);
  }
  if (brand.language) chips.push(`<span class="chip">${brand.language.svg ?? ""}${esc(brand.language.name)}</span>`);
  if (proof.license) chips.push(`<span class="chip">${esc(proof.license)} license</span>`);
  return chips.length ? `<div class="chips">${chips.join("")}</div>` : "";
}

function overlay(sb: Storyboard, i: number, repoLabel: string, brand: Brand, proof: Proof) {
  const s = sb.scenes[i]!;
  const n = String(i).padStart(2, "0");
  switch (s.layout) {
    case "open":
      return `<div class="ov ov-open"><h2 class="serif">${words(s.headline, "w")}</h2>${s.subline ? masked("sub", s.subline) : ""}</div>`;
    case "title":
      return `<div class="ov ov-title">${logoMark(brand, "mark-title")}<h1 class="mega">${words(sb.title, "w")}</h1>${masked("tag", sb.tagline)}</div>`;
    case "code":
      return `<div class="ov ov-code"><p class="kicker mono"><i class="rule"></i>${n}  ${esc(s.headline)}</p><div class="term glass"><div class="dots"><i></i><i></i><i></i></div><pre>${s.code
        .split("\n")
        .map((l) => `<span class="ln"><span class="pr">$</span> ${esc(l.replace(/^\$\s*/, ""))}</span>`)
        .join("")}</pre></div>${s.subline ? masked("sub", s.subline) : ""}</div>`;
    case "end":
      return `<div class="ov ov-end"><div class="scrim"></div>${logoMark(brand, "mark-end")}<h1 class="mega end-title">${words(sb.title, "w")}</h1>${masked("tag", sb.tagline)}${proofChips(brand, proof)}<p class="url mono">${brand.githubSvg && repoLabel.startsWith("github.com") ? `<span class="gh">${brand.githubSvg}</span>` : ""}${esc(repoLabel)}</p><p class="credit mono">directed by shipreel · shot on the livepeer network · typeset with hyperframes</p></div>`;
    default:
      return `<div class="ov ov-feature"><p class="kicker mono"><i class="rule"></i>${n}</p><h2 class="head">${words(s.headline, "w")}</h2>${s.subline ? masked("sub", s.subline) : ""}</div>`;
  }
}

function sceneTimeline(sb: Storyboard, i: number, c: Cut, m: SceneMedia, total: number) {
  const s = sb.scenes[i]!;
  const at = (x: number) => r2(c.start + x);
  const S = `#s${i}`;
  const slot = r2(c.duration + (i < sb.scenes.length - 1 ? XF : 0));
  const lines = [
    // Plate: fade up over the previous one, with a slow, even push.
    `tl.fromTo("#pw${i}", {opacity:0}, {opacity:1, duration:${i === 0 ? 0.9 : XF}, ease:"power1.inOut"}, ${at(0)});`,
    `tl.fromTo("#pw${i} .pz", {scale:${i % 2 ? 1.05 : 1}}, {scale:${i % 2 ? 1 : 1.05}, duration:${slot}, ease:"none"}, ${at(0)});`,
    // Words resolve from blur, one after another.
    `tl.fromTo("${S} .w", {y:34, opacity:0, filter:"blur(14px)"}, {y:0, opacity:1, filter:"blur(0px)", duration:${s.layout === "open" ? 1.2 : 1.0}, stagger:${s.layout === "open" ? 0.1 : 0.06}, ease:"power3.out"}, ${at(s.layout === "title" || s.layout === "end" ? 0.45 : 0.3)});`,
    `tl.fromTo("${S} .mask .line", {yPercent:110}, {yPercent:0, duration:0.9, ease:"power4.out"}, ${at(0.85)});`,
    `tl.fromTo("${S} .kicker", {opacity:0, x:-12}, {opacity:1, x:0, duration:0.7, ease:"power3.out"}, ${at(0.2)});`,
    `tl.fromTo("${S} .rule", {scaleX:0}, {scaleX:1, duration:0.8, ease:"expo.out"}, ${at(0.2)});`,
  ];
  if (s.layout !== "end") {
    lines.push(`tl.fromTo("${S} .ov", {opacity:1, y:0, filter:"blur(0px)"}, {opacity:0, y:-10, filter:"blur(10px)", duration:0.45, ease:"power2.in", immediateRender:false}, ${at(c.duration - 0.45)});`);
  }
  if (s.layout === "title" || s.layout === "end") {
    // The mark materializes: scale and blur resolve together.
    lines.push(`tl.fromTo("${S} .mark", {opacity:0, scale:0.9, filter:"blur(18px)"}, {opacity:1, scale:1, filter:"blur(0px)", duration:1.2, ease:"expo.out"}, ${at(0.1)});`);
  }
  if (s.layout === "end") {
    lines.push(`tl.fromTo("${S} .scrim", {opacity:0}, {opacity:1, duration:1.0, ease:"power1.out"}, ${at(0)});`);
    lines.push(`tl.fromTo("${S} .chip", {y:18, opacity:0, filter:"blur(8px)"}, {y:0, opacity:1, filter:"blur(0px)", duration:0.8, stagger:0.12, ease:"power3.out"}, ${at(1.25)});`);
    lines.push(`tl.fromTo("${S} .url, ${S} .credit", {opacity:0, y:10}, {opacity:1, y:0, duration:0.8, stagger:0.2, ease:"power3.out"}, ${at(1.6)});`);
    lines.push(`tl.to("#fade", {opacity:1, duration:0.8, ease:"power1.in"}, ${r2(total - 0.8)});`);
  }
  if (s.layout === "code") {
    lines.push(`tl.fromTo("${S} .term", {opacity:0, scale:0.95, filter:"blur(16px)"}, {opacity:1, scale:1, filter:"blur(0px)", duration:1.0, ease:"expo.out"}, ${at(0.3)});`);
    lines.push(`tl.fromTo("${S} .ln", {clipPath:"inset(0 100% 0 0)"}, {clipPath:"inset(0 0% 0 0)", duration:0.9, stagger:0.55, ease:"steps(28)"}, ${at(0.9)});`);
  }
  // Captions: each word resolves as it is spoken.
  const count = s.narration.split(/\s+/).filter(Boolean).length;
  const per = r2(Math.max(m.voSeconds - 0.2, 0.5) / count);
  lines.push(`tl.fromTo("#cap${i} .cw", {opacity:0, filter:"blur(6px)"}, {opacity:1, filter:"blur(0px)", duration:0.25, stagger:${per}, ease:"power2.out"}, ${r2(c.voStart)});`);
  return lines.join("\n      ");
}

function musicLane(cuts: Cut[], media: SceneMedia[], total: number) {
  const hi = 0.6, lo = 0.24;
  const pts: { t: number; v: number }[] = [{ t: 0, v: 0 }, { t: 1.2, v: hi }];
  cuts.forEach((c, i) => {
    const a = c.voStart, b = c.voStart + media[i]!.voSeconds;
    pts.push({ t: a - 0.3, v: hi }, { t: a, v: lo }, { t: b, v: lo }, { t: b + 0.4, v: hi });
  });
  pts.push({ t: total - 2.2, v: hi }, { t: total, v: 0 });
  const clean = pts
    .map((p) => ({ t: r2(Math.max(0, Math.min(total, p.t))), v: p.v }))
    .sort((x, y) => x.t - y.t)
    .filter((p, i, arr) => i === 0 || p.t > arr[i - 1]!.t);
  return JSON.stringify({ version: 1, lanes: [{ target: "volume", points: clean }] });
}

export function compose(opts: {
  dir: string;
  sb: Storyboard;
  media: SceneMedia[];
  music: string | null;
  repoLabel: string;
  fontsDir: string;
  brand: Brand;
  proof: Proof;
}) {
  const { dir, sb, media, brand, proof } = opts;
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  for (const f of ["SpaceGrotesk.woff2", "JetBrainsMono.woff2", "InstrumentSerif-Italic.woff2"]) {
    copyFileSync(join(opts.fontsDir, f), join(dir, "assets", "fonts", f));
  }
  const cuts = cutList(sb, media);
  const last = cuts.at(-1)!;
  const total = r2(last.start + last.duration);
  const lastIndex = sb.scenes.length - 1;

  const plates = sb.scenes.map((_, i) => {
    const m = media[i]!, c = cuts[i]!;
    const slot = r2(c.duration + (i < lastIndex ? XF : 0));
    const timed = `data-start="${c.start}" data-duration="${slot}" data-track-index="0"`;
    const el = m.plateIsVideo
      ? `<video id="v${i}" class="clip plate" src="${m.plate}" ${timed}${c.rate < 1 ? ` data-playback-rate="${c.rate}"` : ""} muted playsinline></video>`
      : `<img id="v${i}" class="clip plate" src="${m.plate}" ${timed} alt="" />`;
    return `<div class="pw" id="pw${i}"><div class="pz">${el}</div></div>`;
  }).join("\n      ");

  const overlays = sb.scenes.map((_, i) => {
    const c = cuts[i]!;
    return `<section id="s${i}" class="clip scene" data-start="${c.start}" data-duration="${c.duration}" data-track-index="2">${overlay(sb, i, opts.repoLabel, brand, proof)}</section>`;
  }).join("\n      ");

  const captions = sb.scenes.map((s, i) => {
    const c = cuts[i]!, m = media[i]!;
    return `<div id="cap${i}" class="clip cap" data-start="${c.voStart}" data-duration="${r2(Math.min(m.voSeconds + 0.5, c.start + c.duration - c.voStart))}" data-track-index="3">${words(s.narration, "cw")}</div>`;
  }).join("\n      ");

  const vo = media.map((m, i) =>
    `<audio id="vo${i}" src="${m.vo}" data-start="${cuts[i]!.voStart}" data-duration="${m.voSeconds}" data-track-index="10" data-volume="1"></audio>`,
  ).join("\n      ");

  const music = opts.music
    ? `<audio id="score" src="${opts.music}" data-start="0" data-duration="${total}" data-track-index="11" data-volume="1" data-automation='${musicLane(cuts, media, total)}'></audio>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${esc(sb.title)} — trailer</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Space Grotesk"; src: url("assets/fonts/SpaceGrotesk.woff2") format("woff2"); font-weight: 300 700; }
      @font-face { font-family: "JetBrains Mono"; src: url("assets/fonts/JetBrainsMono.woff2") format("woff2"); font-weight: 500; }
      @font-face { font-family: "Instrument Serif"; src: url("assets/fonts/InstrumentSerif-Italic.woff2") format("woff2"); font-style: italic; }
      :root { --accent: ${sb.accent}; --ink: #f7f8fa; --soft: rgba(247,248,250,.86); --bg: #030405; }
      body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Space Grotesk", sans-serif; -webkit-font-smoothing: antialiased; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--bg); }
      .pw, .pz { position: absolute; inset: 0; }
      .plate { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .shade { position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(125% 95% at 50% 45%, transparent 40%, rgba(0,0,0,.66) 100%),
                    linear-gradient(180deg, rgba(0,0,0,.28) 0%, transparent 28%, transparent 58%, rgba(0,0,0,.7) 100%); }
      .grain { position: absolute; inset: 0; pointer-events: none; background-image: ${GRAIN}; opacity: .06; mix-blend-mode: overlay; }
      .scene { position: absolute; inset: 0; }
      .ov { position: absolute; inset: 0; display: flex; flex-direction: column; }
      .w { display: inline-block; }
      .mask { overflow: hidden; }
      .line { display: block; }
      .mono { font-family: "JetBrains Mono", monospace; }
      .serif { font-family: "Instrument Serif", serif; font-style: italic; font-weight: 400; }
      .sub { margin: 26px 0 0; font-size: 38px; line-height: 1.3; max-width: 1100px; color: var(--ink); text-wrap: balance; text-shadow: 0 2px 24px rgba(0,0,0,.85); }
      .ov-open { align-items: center; justify-content: center; text-align: center; padding: 0 200px; }
      .ov-open h2 { margin: 0; font-size: 136px; line-height: 1.02; letter-spacing: -0.01em; text-wrap: balance; text-shadow: 0 6px 44px rgba(0,0,0,.65); }
      .ov-title, .ov-end { align-items: center; justify-content: center; text-align: center; }
      .mark { display: block; object-fit: contain; filter: drop-shadow(0 18px 40px rgba(0,0,0,.55)); }
      .mark.raster { border-radius: 24%; }
      .mark-title { width: 148px; height: 148px; margin-bottom: 44px; }
      .mark-end { width: 112px; height: 112px; margin-bottom: 34px; }
      .mega { margin: 0; font-size: 196px; font-weight: 700; letter-spacing: -0.05em; line-height: .95; text-shadow: 0 10px 60px rgba(0,0,0,.55); }
      .end-title { font-size: 168px; }
      .tag { margin: 30px 0 0; font-size: 44px; font-weight: 500; letter-spacing: -0.01em; color: var(--ink); text-wrap: balance; max-width: 1300px; text-shadow: 0 2px 24px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6); }
      .ov-feature { justify-content: flex-end; padding: 0 140px 230px; }
      .kicker { display: flex; align-items: center; gap: 18px; margin: 0 0 22px; font-size: 24px; letter-spacing: .14em; color: var(--ink); text-transform: uppercase; font-weight: 500; text-shadow: 0 2px 18px rgba(0,0,0,.8), 0 0 4px rgba(0,0,0,.5); }
      .rule { display: block; width: 56px; height: 3px; background: var(--accent); transform-origin: left center; }
      .head { margin: 0; font-size: 116px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; max-width: 1400px; text-shadow: 0 6px 40px rgba(0,0,0,.6); }
      .ov-code { align-items: center; justify-content: center; background: radial-gradient(55% 55% at 50% 50%, rgba(0,0,0,.5) 0%, rgba(0,0,0,.18) 70%, transparent 100%); }
      .ov-code .kicker { margin-bottom: 34px; font-size: 26px; }
      .glass { background: rgba(12,14,18,.58); border: 1px solid rgba(255,255,255,.16); backdrop-filter: blur(24px) saturate(140%);
        box-shadow: 0 40px 120px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.12); }
      .term { width: 1180px; border-radius: 26px; padding: 28px 44px 40px; }
      .dots { display: flex; gap: 12px; margin-bottom: 26px; }
      .dots i { width: 15px; height: 15px; border-radius: 50%; background: rgba(255,255,255,.28); }
      .dots i:first-child { background: var(--accent); }
      .term pre { margin: 0; font-family: "JetBrains Mono", monospace; font-size: 40px; line-height: 1.55; color: var(--ink); white-space: pre-wrap; }
      .ln { display: block; }
      .pr { color: var(--accent); }
      .ov-code .sub { text-align: center; }
      .scrim { position: absolute; inset: 0; background: radial-gradient(60% 60% at 50% 50%, rgba(0,0,0,.62) 0%, rgba(0,0,0,.35) 60%, rgba(0,0,0,.2) 100%); }
      .ov-end > *:not(.scrim) { position: relative; }
      .chips { display: flex; gap: 16px; margin-top: 44px; }
      .chip { display: inline-flex; align-items: center; gap: 12px; padding: 13px 24px; border-radius: 999px; font-size: 26px; font-weight: 500; color: var(--ink);
        background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.2); backdrop-filter: blur(18px) saturate(140%); }
      .chip svg { width: 30px; height: 30px; }
      .chip b { font-weight: 700; }
      .url { display: inline-flex; align-items: center; gap: 14px; margin: 36px 0 0; font-size: 30px; color: var(--ink); }
      .gh svg { width: 30px; height: 30px; display: block; }
      .credit { margin: 20px 0 0; font-size: 18px; letter-spacing: .14em; color: var(--soft); text-transform: uppercase; }
      .bars::before, .bars::after { content: ""; position: absolute; left: 0; right: 0; height: 96px; background: #000; }
      .bars::before { top: 0; } .bars::after { bottom: 0; }
      .bars { position: absolute; inset: 0; pointer-events: none; }
      .cap { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; display: flex; align-items: center; justify-content: center;
        font-size: 30px; font-weight: 500; color: #fff; letter-spacing: .005em; }
      .cw { display: inline-block; margin: 0 .15em; }
      #fade { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${total}">
      ${plates}
      <div class="shade"></div>
      <div class="grain"></div>
      ${overlays}
      <div class="bars"></div>
      ${captions}
      <div id="fade"></div>
      ${vo}
      ${music}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${sb.scenes.map((_, i) => sceneTimeline(sb, i, cuts[i]!, media[i]!, total)).join("\n      ")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  writeFileSync(join(dir, "index.html"), html);
  return { cuts, total };
}
