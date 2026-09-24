// Sound department: one voiceover line per scene (so each scene is timed to
// its own read) and a single instrumental score for the whole trailer.

import type { Storyboard } from "./director.ts";
import type { Livepeer } from "./livepeer.ts";

export interface SoundOptions { ttsModel: string; voice?: string }

const NARRATOR = "Read like a confident film trailer narrator at a measured, natural pace, warm, no exaggeration";
const FALLBACK_TTS = "inworld-tts";

async function speak(lp: Livepeer, step: string, text: string, opts: SoundOptions): Promise<string> {
  if (opts.ttsModel === "gemini-tts") {
    // The gemini-tts endpoint reads `inputs.prompt`; Livepeer maps the top-level prompt to `text`.
    const res = await lp.run(step, "gemini-tts", {
      prompt: text,
      inputs: { prompt: `${NARRATOR}: ${text}`, voice: opts.voice ?? "Charon" },
    }, 3);
    if (typeof res.url !== "string") throw new Error(`${step}: gemini-tts returned no audio URL`);
    return res.url;
  }
  const r = await lp.media(step, {
    action: "tts",
    prompt: text,
    model_override: opts.ttsModel,
    ...(opts.voice ? { voice: opts.voice } : {}),
  });
  return r.url;
}

export async function voiceover(lp: Livepeer, sb: Storyboard, opts: SoundOptions, log: (m: string) => void = () => {}) {
  return Promise.all(sb.scenes.map(async (s, i) => {
    try {
      return await speak(lp, `voice s${i}`, s.narration, opts);
    } catch (err) {
      if (opts.ttsModel === FALLBACK_TTS) throw err;
      log(`  voice s${i}: ${opts.ttsModel} failed, falling back to ${FALLBACK_TTS} (${String(err).slice(0, 100)})`);
      return speak(lp, `voice s${i} fallback`, s.narration, { ttsModel: FALLBACK_TTS });
    }
  }));
}

export async function score(lp: Livepeer, sb: Storyboard, seconds: number) {
  const res = await lp.run("score", "sonilo-t2m", {
    prompt: `${sb.music}. Instrumental trailer score, builds to a peak near the end, clean ending.`,
    inputs: { duration: Math.ceil(seconds) + 2 },
    timeout: 120,
  }, 2);
  const url = firstUrl(res);
  if (!url) throw new Error(`score: no audio URL in ${JSON.stringify(res).slice(0, 300)}`);
  return url;
}

function firstUrl(v: unknown): string | null {
  if (typeof v === "string") return /^https?:\/\//.test(v) ? v : null;
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) {
      const u = firstUrl(x);
      if (u) return u;
    }
  }
  return null;
}
