// Picture department: render a text-free keyframe per scene, have a vision
// model critique it, re-shoot once if it fails, then animate the keeper.

import type { Storyboard } from "./director.ts";
import type { Livepeer } from "./livepeer.ts";

export interface CriticNote {
  scene: number;
  attempt: number;
  url: string;
  has_text: boolean;
  on_brief: number;
  issues: string;
  verdict: "keep" | "reshoot";
}

export interface Shot { scene: number; still: string; video: string | null; model: string }

export interface ShootOptions { stills: boolean; imageModel: string; videoModel: string; clipSeconds: number }

const PASS = 0.6;
const NO_TEXT = "clean plate, no text, no letters, no signage, no logos, no watermark, no UI";

async function critique(lp: Livepeer, scene: number, attempt: number, url: string, visual: string): Promise<CriticNote> {
  const v = await lp.see<{ has_text?: boolean; on_brief?: number; issues?: string }>(
    `critic s${scene}#${attempt}`,
    url,
    `You are a strict film plate critic. This frame will get typography composited on top, so any visible text, letters, glyph-like scribbles, logos, or UI writing is a defect.
Brief: "${visual}"
Reply JSON only: {"has_text": boolean, "on_brief": number between 0 and 1, "issues": "short phrase, or none"}`,
  );
  const on_brief = Math.max(0, Math.min(1, Number(v.on_brief ?? 0)));
  const has_text = Boolean(v.has_text);
  const verdict = !has_text && on_brief >= PASS ? "keep" : "reshoot";
  return { scene, attempt, url, has_text, on_brief, issues: String(v.issues ?? ""), verdict };
}

async function keyframe(lp: Livepeer, sb: Storyboard, i: number, opts: ShootOptions, notes: CriticNote[]) {
  const s = sb.scenes[i]!;
  let prompt = `${sb.style}. ${s.visual}. ${NO_TEXT}.`;
  let best: CriticNote | null = null;
  let model = opts.imageModel;
  // Stray text is the failure that matters most under typography, so it earns a third take.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const img = await lp.media(`keyframe s${i}#${attempt}`, {
      action: "generate",
      prompt,
      model_override: opts.imageModel,
      aspect_ratio: "16:9",
    });
    model = img.model;
    const note = await critique(lp, i, attempt, img.url, s.visual).catch(
      (e): CriticNote => ({ scene: i, attempt, url: img.url, has_text: false, on_brief: 0.5, issues: `critic unavailable: ${e}`, verdict: "keep" }),
    );
    notes.push(note);
    if (!best || note.on_brief - (note.has_text ? 1 : 0) > best.on_brief - (best.has_text ? 1 : 0)) best = note;
    if (note.verdict === "keep" || (attempt === 2 && !note.has_text)) break;
    // Re-shoot: feed the critic's objection back into the prompt.
    prompt = `${sb.style}. ${s.visual}. Fix: ${note.issues}. Absolutely ${NO_TEXT}, only pure imagery.`;
  }
  return { url: best!.url, model };
}

async function pool<T>(n: number, jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]!();
    }
  }));
  return out;
}

export async function shoot(lp: Livepeer, sb: Storyboard, opts: ShootOptions, log: (m: string) => void) {
  const notes: CriticNote[] = [];
  const shots = await pool(4, sb.scenes.map((s, i) => async (): Promise<Shot> => {
    const kf = await keyframe(lp, sb, i, opts, notes);
    log(`  scene ${i + 1}: keyframe ✓ (${notes.filter((n) => n.scene === i).length} take(s))`);
    if (opts.stills) return { scene: i, still: kf.url, video: null, model: kf.model };
    const vid = await lp.media(`animate s${i}`, {
      action: "animate",
      source_url: kf.url,
      prompt: `${s.motion}. ${sb.style}. ${NO_TEXT}.`,
      duration: opts.clipSeconds,
      model_override: opts.videoModel,
    }).catch((err) => {
      // A still with a HyperFrames push-in beats losing the whole trailer.
      log(`  scene ${i + 1}: motion failed, using the still (${String(err).slice(0, 120)})`);
      return null;
    });
    if (!vid) return { scene: i, still: kf.url, video: null, model: kf.model };
    log(`  scene ${i + 1}: motion ✓ (${vid.model})`);
    return { scene: i, still: kf.url, video: vid.url, model: vid.model };
  }));
  return { shots, notes };
}
