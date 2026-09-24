#!/usr/bin/env bun
// shipreel <github-url | local-dir>: plan → estimate → shoot → score → cut → render.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";
import { loadBrand } from "./brand.ts";
import { compose, type SceneMedia } from "./compose.ts";
import { parseStoryboard, plan, type Storyboard } from "./director.ts";
import { Livepeer } from "./livepeer.ts";
import { shoot } from "./shoot.ts";
import { score, voiceover } from "./sound.ts";
import { loadFacts } from "./source.ts";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scenes: { type: "string", default: "6" },
    budget: { type: "string", default: "5" },
    out: { type: "string", default: "out" },
    stills: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "no-render": { type: "boolean", default: false },
    draft: { type: "boolean", default: false },
    "image-model": { type: "string" },
    "video-model": { type: "string" },
    "tts-model": { type: "string" },
    voice: { type: "string" },
    storyboard: { type: "string" },
    takes: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (o.help || positionals.length !== 1) {
  console.log(`shipreel — turn a repo into a launch trailer on the Livepeer network

usage: bun shipreel <github-url | owner/repo | ./local-dir> [options]

  --scenes N          scenes in the trailer (default 6)
  --budget USD        abort if the pre-run estimate exceeds this (default 5)
  --draft             cheap stack for iterating: flux-dev, pixverse-i2v, inworld-tts
  --stills            skip image-to-video; animate keyframes in HyperFrames (~10x cheaper)
  --dry-run           plan + estimate only, spend nothing on media
  --storyboard FILE   reuse an edited storyboard.json instead of planning
  --takes FILE        re-cut from a previous run's takes.json without re-shooting
  --no-render         write the HyperFrames project but skip the MP4 render
  --image-model ID    keyframe model (default flux-pro)
  --video-model ID    image-to-video model (default kling-v3-turbo-i2v)
  --tts-model ID      voiceover model (default gemini-tts)
  --voice NAME        voiceover voice (default Charon for gemini-tts)`);
  process.exit(o.help ? 0 : 1);
}

const CLIP_SECONDS = 5;
// Premium by default; --draft trades fidelity for cost while iterating on a storyboard.
const imageModel = o["image-model"] ?? (o.draft ? "flux-dev" : "flux-pro");
const videoModel = o["video-model"] ?? (o.draft ? "pixverse-i2v" : "kling-v3-turbo-i2v");
const ttsModel = o["tts-model"] ?? (o.draft ? "inworld-tts" : "gemini-tts");
const voice = o.voice ?? (ttsModel === "gemini-tts" ? "Charon" : undefined);
const t0 = Date.now();
const log = (m: string) => console.log(`\x1b[2m${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s\x1b[0m ${m}`);

const facts = await loadFacts(positionals[0]!);
const slug = facts.slug.replace(/[^\w.-]+/g, "-");
const runDir = resolve(o.out!, slug);
const projDir = join(runDir, "video");
mkdirSync(join(projDir, "assets"), { recursive: true });
const lp = new Livepeer(`shipreel-${slug}-${Date.now().toString(36)}`.slice(0, 120));
log(`🎬 ${facts.slug} — ${facts.description || "no description"}`);
log(`   crew: ${imageModel} · ${o.stills ? "stills" : videoModel} · ${ttsModel}${voice ? ` (${voice})` : ""} · nemotron-omni-vision · sonilo-t2m`);

// 1. Plan
let sb: Storyboard;
// A re-cut must reuse the storyboard its takes were shot from.
const storyboardFile = o.storyboard ?? (o.takes ? join(dirname(o.takes), "storyboard.json") : undefined);
if (storyboardFile) {
  sb = parseStoryboard(await Bun.file(storyboardFile).json());
  log(`📋 storyboard loaded from ${storyboardFile}`);
} else {
  sb = await plan(lp, facts, Number(o.scenes));
  log(`📋 storyboard: "${sb.title}" — ${sb.tagline}`);
}
writeFileSync(join(runDir, "storyboard.json"), JSON.stringify(sb, null, 2));
sb.scenes.forEach((s, i) => log(`   ${String(i + 1).padStart(2)} [${s.layout}] ${s.headline} — "${s.narration}"`));

// 2. Estimate from live pricing before spending anything
const [pImg, pVid, pVision, pTts, pMusic] = await Promise.all([
  lp.price(imageModel),
  lp.price(videoModel),
  lp.price("nemotron-omni-vision"),
  lp.price(ttsModel),
  lp.price("sonilo-t2m"),
]);
const n = sb.scenes.length;
// Narration plus the per-line delivery direction sent with each read.
const chars = sb.scenes.reduce((s, x) => s + x.narration.length + 90, 0);
const estSeconds = n * 4.5 + 3;
const estimate = {
  keyframes: n * 2 * pImg, // the critic sends roughly half the takes back
  critic: n * 2 * pVision * 1.5,
  motion: o.stills ? 0 : n * CLIP_SECONDS * pVid,
  voice: (chars / 1000) * pTts,
  score: (estSeconds + 2) * pMusic,
};
const total = Object.values(estimate).reduce((a, b) => a + b, 0);
log(`💸 estimate $${total.toFixed(2)} (${Object.entries(estimate).map(([k, v]) => `${k} $${v.toFixed(3)}`).join(", ")})`);
if (o["dry-run"]) process.exit(0);
// A re-cut from takes spends nothing, so only a real shoot is gated.
if (!o.takes && total > Number(o.budget)) {
  console.error(`estimate $${total.toFixed(2)} exceeds --budget $${o.budget}; try --stills or fewer --scenes`);
  process.exit(2);
}

// 3. Shoot, voice, and score in parallel
interface Takes { picture: Awaited<ReturnType<typeof shoot>>; vo: string[]; music: string | null }
let takes: Takes;
if (o.takes) {
  takes = (await Bun.file(o.takes).json()) as Takes;
  log(`🎥 re-cutting from ${o.takes} (no new renders)`);
} else {
  log(`🎥 shooting ${n} scenes${o.stills ? " (stills mode)" : ""}, recording voiceover, scoring…`);
  const [picture, vo, music] = await Promise.all([
    shoot(lp, sb, { stills: o.stills!, imageModel, videoModel, clipSeconds: CLIP_SECONDS }, log),
    voiceover(lp, sb, { ttsModel, voice }, log).then((v) => (log("  voiceover ✓"), v)),
    score(lp, sb, estSeconds).then((u) => (log("  score ✓"), u)).catch((e) => (log(`  score failed, cutting without music: ${e}`), null)),
  ]);
  takes = { picture, vo, music };
  writeFileSync(join(runDir, "takes.json"), JSON.stringify(takes, null, 2));
}
const { picture, vo, music } = takes;
const reshoots = picture.notes.filter((x) => x.verdict === "reshoot").length;
log(`🧐 critic reviewed ${picture.notes.length} keyframes, sent ${reshoots} back for a re-shoot`);

// 4. Pull media local and measure it
async function fetchTo(url: string, name: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`);
  await Bun.write(join(projDir, "assets", name), res);
  return `assets/${name}`;
}
function ext(url: string, fallback: string) {
  return url.match(/\.(m4a|mp3|wav|ogg)$/)?.[1] ?? fallback;
}
// TTS pads each read with dead air; trim both ends and lift the pace slightly (pitch-preserving).
async function tighten(rel: string, name: string) {
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04";
  await $`ffmpeg -v error -y -i ${join(projDir, rel)} -af ${`${trim},areverse,${trim},areverse,atempo=1.06`} ${join(projDir, "assets", name)}`;
  await $`rm -f ${join(projDir, rel)}`;
  return `assets/${name}`;
}
async function seconds(rel: string) {
  const out = await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${join(projDir, rel)}`.text();
  return Number(out.trim());
}
const media: SceneMedia[] = await Promise.all(sb.scenes.map(async (_, i) => {
  const shot = picture.shots[i]!;
  const plate = shot.video ? await fetchTo(shot.video, `plate${i}.mp4`) : await fetchTo(shot.still, `plate${i}.jpg`);
  const line = await tighten(await fetchTo(vo[i]!, `vo${i}-raw.${ext(vo[i]!, "wav")}`), `vo${i}.wav`);
  return {
    plate,
    plateIsVideo: Boolean(shot.video),
    plateSeconds: shot.video ? await seconds(plate) : 0,
    vo: line,
    voSeconds: Math.round((await seconds(line)) * 100) / 100,
  };
}));
const musicRel = music ? await fetchTo(music, `score.${ext(music, "mp3")}`) : null;
const brand = await loadBrand(facts, join(projDir, "assets"));
log(`🏷  brand: logo ${brand.logo ? "✓" : "none"}, github ${brand.githubSvg ? "✓" : "–"}, language ${brand.language?.svg ? brand.language.name : "–"}`);

// 5. Cut the HyperFrames composition
const repoLabel = facts.url.replace(/^https?:\/\//, "") || facts.slug;
const cut = compose({
  dir: projDir, sb, media, music: musicRel, repoLabel, brand,
  proof: { stars: facts.stars, license: facts.license },
  fontsDir: resolve(import.meta.dir, "../fonts"),
});
log(`✂️  cut ${n} scenes, ${cut.total.toFixed(1)}s → ${join(projDir, "index.html")}`);

// 6. Report
const byModel: Record<string, number> = {};
for (const e of lp.ledger) byModel[e.model ?? e.tool] = (byModel[e.model ?? e.tool] ?? 0) + e.cost_usd;
const report = {
  repo: facts.slug,
  session_id: lp.sessionId,
  models: { image: imageModel, video: o.stills ? null : videoModel, tts: ttsModel, voice: voice ?? null, critic: "nemotron-omni-vision", score: "sonilo-t2m", planner: "gemini-text" },
  storyboard: sb,
  cuts: cut.cuts,
  duration_s: cut.total,
  spend_usd: Math.round(lp.spent * 10000) / 10000,
  estimate_usd: Math.round(total * 10000) / 10000,
  spend_by_model: byModel,
  calls: lp.ledger.length,
  critic: picture.notes,
  ledger: lp.ledger,
  wall_clock_s: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
log(`🧾 ${lp.ledger.length} Livepeer calls, spent $${lp.spent.toFixed(3)} (estimate $${total.toFixed(3)})`);

// 7. Render
if (!o["no-render"]) {
  const mp4 = join(runDir, "trailer.mp4");
  log("🎞  rendering with HyperFrames…");
  await $`npx -y hyperframes@0.8.72 render ${projDir} --output ${mp4} --quality delivery`.quiet();
  log(`✅ ${mp4}`);
}
