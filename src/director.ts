// The director: turns repo facts into a validated storyboard using a text LLM
// on Livepeer. The model plans; this file enforces the rules it tends to break.

import { z } from "zod";
import type { Livepeer } from "./livepeer.ts";
import type { RepoFacts } from "./source.ts";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const Scene = z.object({
  layout: z.enum(["open", "title", "feature", "code", "end"]),
  narration: z.string().min(3).max(160),
  headline: z.string().min(1).max(60),
  subline: z.string().max(110).default(""),
  code: z.string().max(240).default(""),
  visual: z.string().min(10).max(600),
  motion: z.string().min(5).max(240),
});

const Storyboard = z.object({
  title: z.string().min(1).max(40),
  tagline: z.string().min(1).max(80),
  accent: Hex,
  style: z.string().min(10).max(400),
  music: z.string().min(5).max(300),
  scenes: z.array(Scene).min(3).max(10),
});

export type Scene = z.infer<typeof Scene>;
export type Storyboard = z.infer<typeof Storyboard>;

function brief(f: RepoFacts, sceneCount: number) {
  return `You are the director of a ${sceneCount}-scene cinematic launch trailer for a software project.
The on-screen text is typeset separately in HTML, so the AI footage must contain NO text.

PROJECT FACTS (the only claims you may make):
name: ${f.name}
repo: ${f.url || f.slug}
description: ${f.description}
language: ${f.language ?? "unknown"}
topics: ${f.topics.join(", ") || "none"}
README (truncated):
"""
${f.readme}
"""

Return JSON only, matching exactly:
{
  "title": "product name as it should appear on screen",
  "tagline": "a sharp promise, max 8 words",
  "accent": "#RRGGBB — one saturated accent color that suits the project's mood",
  "style": "visual style bible, ~25 words: a premium product-film look (controlled light, shallow depth of field, clean composition with negative space for type), palette, lens. Repeated verbatim in every shot for continuity.",
  "music": "instrumental score brief: genre, bpm, mood arc",
  "scenes": [
    {
      "layout": "open | title | feature | code | end",
      "narration": "voiceover line, max 14 words, spoken naturally",
      "headline": "on-screen words, max 5 words",
      "subline": "optional supporting line, max 12 words",
      "code": "for layout=code only: a real command or snippet copied VERBATIM from the README, max 3 lines",
      "visual": "keyframe description: subject, framing, setting, lighting. A metaphor for the idea, not a UI screenshot. No text, no screens with writing, no logos.",
      "motion": "one camera move + subject action for a 5s shot, e.g. 'slow dolly-in, dust drifting through the beam'"
    }
  ]
}

RULES:
- Exactly ${sceneCount} scenes. Scene 1 layout "open" (a hook: a problem or a question). Scene 2 layout "title". Last scene layout "end" with the headline set to the product name.
- Include at most one "code" scene, and only if the README contains a real install or usage command.
- Every claim must come from the facts above. No invented numbers, users, or companies.
- Narration lines read as one continuous voiceover across scenes. Write like a trailer editor: short declaratives, one idea per line, specific nouns taken from the README.
- Banned words: discover, future, harness, unleash, revolutionize, revolutionary, seamless, powerful, robust, cutting-edge, game-changer, journey, empower, elevate, next-level.
- Headlines are punchy fragments, not sentences, and never repeat the narration verbatim.
- Visuals: photographic and physical, like an Apple product film: real materials, objects, places, and light; calm compositions with negative space where the headline will sit. Vary framing across scenes (wide, close, macro, overhead).
- Avoid visual clichés that look cheap or sprout fake lettering: circuit boards, robot hands, binary code, holograms, glowing network meshes, screens or dashboards, server-room corridors.`;
}

/** Validate a storyboard from disk (e.g. one a human edited) before shooting it. */
export function parseStoryboard(raw: unknown): Storyboard {
  const sb = Storyboard.parse(raw);
  return { ...sb, scenes: sb.scenes.map(demoteNonCommands) };
}

// A terminal card must show commands, not README prose that happens to be verbatim.
const COMMAND_LINE = /^(\$\s*)?(\.\/|[a-z][\w.-]*)(\s|$)/;
function looksLikeCommands(code: string) {
  const lines = code.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) =>
    COMMAND_LINE.test(l) && !l.includes("`") && !l.includes("](") && !/[.:]$/.test(l) && !/^[-*]\s/.test(l));
}

function demoteNonCommands(s: Scene): Scene {
  if (s.layout !== "code" || looksLikeCommands(s.code)) return s;
  return { ...s, layout: "feature", code: "" };
}

/** Ask the planner for a storyboard; retry once with the validation error if it drifts from the schema. */
export async function plan(lp: Livepeer, facts: RepoFacts, sceneCount: number): Promise<Storyboard> {
  let prompt = brief(facts, sceneCount);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await lp.json<unknown>(`plan#${attempt}`, prompt);
      return normalize(Storyboard.parse(raw), facts);
    } catch (err) {
      if (attempt === 3) throw err;
      prompt = `${brief(facts, sceneCount)}\n\nYour previous answer was rejected: ${String(err).slice(0, 600)}\nReturn corrected JSON only.`;
    }
  }
  throw new Error("unreachable");
}

// Enforce the structural rules and drop any code the README does not contain verbatim.
function normalize(sb: Storyboard, facts: RepoFacts): Storyboard {
  const readme = facts.readme.replace(/\s+/g, " ");
  const scenes = sb.scenes.map((s) => {
    const code = s.code.trim();
    const codeIsReal = code.length > 0 && readme.includes(code.replace(/\s+/g, " "));
    const layout = s.layout === "code" && !codeIsReal ? "feature" : s.layout;
    return demoteNonCommands({ ...s, layout, code: layout === "code" ? code : "" });
  });
  scenes[0]!.layout = "open";
  if (scenes.length > 2 && !scenes.some((s) => s.layout === "title")) scenes[1]!.layout = "title";
  scenes.at(-1)!.layout = "end";
  scenes.at(-1)!.headline = sb.title;
  return { ...sb, scenes };
}
