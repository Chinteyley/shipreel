// Renders the demo's narration (gemini-tts, Charon), score, and sound design on Livepeer.
import { writeFileSync } from "node:fs";
import { $ } from "bun";
import { Livepeer } from "../src/livepeer.ts";

const DIR = "demo/assets/v2";
const STYLE = "Read in a calm, warm, confident keynote narrator voice, unhurried, with natural pauses";
export const lines: Record<string, string> = {
  hook: "Every repo deserves a launch trailer. Nobody has time to make one.",
  reveal: "So we built Shipreel. An agent that directs it for you.",
  cmd: "One command. Point it at any GitHub repo.",
  crew: "Six models. One network. The entire crew runs on Livepeer.",
  director: "A director reads your README, and writes the storyboard. No invented claims.",
  critic: "A camera shoots every keyframe. A vision critic reviews each take, and sends the bad ones back.",
  motion: "The keepers come alive. Then it records the voiceover, and scores the music.",
  words: "AI video still can't spell. So every word on screen is real type, set with HyperFrames.",
  receipt: "And every run is priced before it spends a cent.",
  intro: "This is the trailer it made about itself.",
  close: "Shipreel. Every repo deserves a launch trailer.",
};
const sfx: Record<string, [string, number]> = {
  whoosh: ["soft cinematic air whoosh transition, clean, short tail, no music", 2],
  bloom: ["deep warm cinematic logo reveal impact with soft shimmer tail, premium, no music", 3],
  key: ["single soft mechanical keyboard enter key press, close mic, clean", 1],
  tick: ["tiny soft glassy UI tick, subtle, clean", 1],
};

const lp = new Livepeer("shipreel-demo-v2");
const seconds = async (f: string) => Number((await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${f}`.text()).trim());
const save = async (url: string, f: string) => { await Bun.write(f, await fetch(url)); return f; };
const exists = (f: string) => Bun.file(f).exists();

const vo: Record<string, { file: string; seconds: number }> = {};
await Promise.all(Object.entries(lines).map(async ([k, text]) => {
  const f = `${DIR}/vo-${k}.mp3`;
  if (!(await exists(f))) {
    for (let a = 1; a <= 3; a++) {
      try {
        const r = await lp.run(`vo ${k}#${a}`, "gemini-tts", { prompt: text, inputs: { prompt: `${STYLE}: ${text}`, voice: "Charon" } });
        await save(String(r.url), f);
        break;
      } catch (e) { if (a === 3) throw e; }
    }
  }
  vo[k] = { file: f.replace("demo/", ""), seconds: Math.round((await seconds(f)) * 100) / 100 };
}));

const fx: Record<string, string> = {};
await Promise.all(Object.entries(sfx).map(async ([k, [prompt, duration]]) => {
  const f = `${DIR}/sfx-${k}.wav`;
  if (!(await exists(f))) {
    const r = await lp.run(`sfx ${k}`, "mirelo-sfx", { prompt, inputs: { duration } });
    const url = String(r.url);
    await save(url, f);
  }
  fx[k] = f.replace("demo/", "");
}));

const bedFile = `${DIR}/bed.m4a`;
if (!(await exists(bedFile))) {
  const r = await lp.run("score", "sonilo-t2m", {
    prompt: "minimal premium product keynote score, warm felt piano motif over soft analog synth pads and a gentle pulsing bass, 100 bpm, hopeful and confident, slow build to an uplifting final swell, instrumental, no vocals",
    inputs: { duration: 120 },
    timeout: 150,
  });
  await save(String(r.url), bedFile);
}
writeFileSync("demo/audio.json", JSON.stringify({ lines, vo, sfx: fx, bed: bedFile.replace("demo/", "") }, null, 2));
console.log(JSON.stringify(vo), `spent $${lp.spent.toFixed(4)}`);
