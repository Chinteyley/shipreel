# Shipreel

**Every repo deserves a launch trailer.** Shipreel is an agent that reads a GitHub repo and directs a narrated, scored, 30 to 45 second cinematic trailer for it. It plans the story, shoots the footage, reviews its own takes, records the voiceover, and cuts the final MP4.

The whole crew works on the **Livepeer network**: planner LLM, keyframes, vision critic, image-to-video, voice, and music. Every word on screen is real HTML typography composited with **HyperFrames**, because diffusion models still can't spell.

```
bun shipreel livepeer/go-livepeer
```

**▶ [Demo video](https://7y4flzpulgv4co6r.public.blob.vercel-storage.com/uploads/1790266481197-9i7upk-shipreel-demo-v2.mp4)** (2:21) · Sample trailers, unedited Shipreel output: [Shipreel, by Shipreel](https://github.com/Chinteyley/shipreel/releases/download/v0.1.0/trailer-shipreel.mp4) · [livepeer/go-livepeer](https://github.com/Chinteyley/shipreel/releases/download/v0.1.0/trailer-go-livepeer.mp4)

## Why

Generative video is great at light, texture, and motion and bad at words. Ask a model for a title card and you get glyph soup. Shipreel gives each medium the job it's good at:

| Layer | Who does it | Why |
| --- | --- | --- |
| Story, script, shot list | LLM on Livepeer (`gemini-text`) | Grounded in the README; no invented claims |
| Keyframes | Livepeer (`flux-pro`) | Text-free 2752×1536 "clean plates" with a shared style bible for continuity |
| Quality control | Vision model on Livepeer (`nemotron-omni-vision`) | Rejects plates with stray text or off-brief framing, then re-shoots with the critique fed back in |
| Motion | Livepeer (`kling-v3-turbo-i2v`) | 5-second camera moves from each approved keyframe |
| Voiceover | Livepeer (`gemini-tts`, voice Charon) | One line per scene, so every cut is timed to its read |
| Score | Livepeer (`sonilo-t2m`) | Instrumental bed, auto-ducked under the voice |
| Typography, logos, captions, edit | HyperFrames | Pixel-exact type, the repo's real logo and GitHub/language marks, word-timed captions, deterministic render |

## How it works

```
repo ──► director ──► storyboard.json ──► pre-run estimate ──► budget gate
                                                                      │
             ┌──────────────────────────┬─────────────────────────────┤
             ▼                          ▼                             ▼
      keyframe (flux-pro)        voiceover (gemini-tts)        score (sonilo)
             │
      critic (vision) ── fail ──► re-shoot with critique
             │ pass
      animate (i2v)
             └──────────────┬───────────┘
                            ▼
           HyperFrames composition (index.html) ──► trailer.mp4 + report.json
```

1. **Plan.** The director gets the repo's README and metadata and returns a storyboard: title, tagline, accent color, a style bible, a music brief, and one entry per scene (layout, narration, on-screen headline, visual, camera move). Schema violations get sent back to the model with the validation error. Code scenes are dropped unless the command appears verbatim in the README.
2. **Estimate.** Live prices from `get_pricing` produce a cost estimate before anything renders. `--budget` aborts over-budget runs; `--dry-run` stops here.
3. **Shoot.** Scenes render in parallel. Each keyframe is graded by a vision model for stray text and brief match. Failures are re-shot once with the critic's objection in the prompt, and the best take is kept.
4. **Sound.** Voiceover lines and the score render alongside the picture.
5. **Cut.** Shipreel writes a HyperFrames project: footage plates with slow push-ins, kinetic type per layout (open, title, feature, code, end), word-timed captions in the letterbox, and a music lane that ducks under every voice line. The duration of each scene follows its voiceover.
6. **Render + report.** `trailer.mp4`, plus `report.json` with every Livepeer call, the model that actually ran, cost, latency, and the critic's verdicts.

## Quickstart

Requires [Bun](https://bun.sh), `ffmpeg`, and Node (for `npx hyperframes`).

```bash
bun install
bun shipreel livepeer/go-livepeer            # premium trailer, ~$4.50 (6 scenes)
bun shipreel livepeer/go-livepeer --draft    # cheap models for iterating, ~$2.50
bun shipreel oven-sh/bun --stills --draft    # keyframes only, HyperFrames push-ins, ~$0.40
bun shipreel ./my-local-repo --dry-run       # plan + estimate, spend nothing
```

Measured on the premium stack: `livepeer/go-livepeer` (6 scenes, 36.9s) cost $4.35 over 31 Livepeer calls in about 5 minutes; Shipreel's own trailer (7 scenes, 46.4s) cost $5.20 over 39 calls. Most of that is image-to-video.

Logos are never generated. For a GitHub organization, Shipreel uses the org avatar; for a local checkout it uses `brand/*.svg` or `logo.svg` if present. GitHub and language marks come from [simple-icons](https://simpleicons.org).

No API key is needed to try it: the Livepeer Agent MCP runs on keyless demo credits. Set `LIVEPEER_API_KEY` to bill your own account.

Output lands in `out/<owner>-<repo>/`:

| File | What |
| --- | --- |
| `trailer.mp4` | The finished trailer, 1920×1080 |
| `storyboard.json` | The director's plan. Edit it and pass `--storyboard` to re-shoot your version |
| `takes.json` | Every rendered asset URL. Pass `--takes` to re-cut without re-rendering |
| `video/` | The HyperFrames project. Open it in Studio with `npx hyperframes preview` |
| `report.json` | Spend by model, per-call ledger, critic verdicts, timings |

### Options

```
--scenes N          scenes in the trailer (default 6)
--budget USD        abort if the pre-run estimate exceeds this (default 5)
--draft             cheap stack for iterating: flux-dev, pixverse-i2v, inworld-tts
--stills            skip image-to-video; animate keyframes in HyperFrames (~10x cheaper)
--dry-run           plan + estimate only
--storyboard FILE   reuse an edited storyboard.json instead of planning
--takes FILE        re-cut from a previous run's takes.json
--no-render         write the HyperFrames project, skip the MP4
--image-model ID    keyframe model (default flux-pro)
--video-model ID    image-to-video model (default kling-v3-turbo-i2v)
--tts-model ID      voiceover model (default gemini-tts)
--voice NAME        voiceover voice (default Charon)
```

## Use it from your coding agent

This repo ships an `.mcp.json` that connects Claude Code (or any MCP client) to the Livepeer Agent creative surface, so you can direct re-shoots conversationally: "re-shoot scene 3 wider, keep the palette".

## Project layout

```
src/cli.ts        orchestration, estimate, budget gate, report
src/livepeer.ts   MCP-over-HTTP client + spend ledger
src/source.ts     repo facts from GitHub or a local checkout
src/director.ts   storyboard planning + validation
src/shoot.ts      keyframes, vision critic, re-shoots, image-to-video
src/sound.ts      voiceover + score
src/brand.ts      real logos and GitHub/language marks (never generated)
src/compose.ts    HyperFrames composition writer
demo/             the submission video, built from a real run
```

## Livepeer Agent Hackathon

Built for the Livepeer Agent Hackathon (Track 01, Livepeer Agent Builder).

The demo video is itself a HyperFrames composition generated from a real Shipreel run: every cost, keyframe, and critic verdict on screen comes from that run's `report.shoot.json`, and the trailer inside it was made by Shipreel about Shipreel. Its narration, score, and sound design were also rendered on Livepeer (`gemini-tts`, `sonilo-t2m`, `mirelo-sfx`). To rebuild it:

```bash
bun shipreel . --out out-v2 --scenes 7 && bun shipreel livepeer/go-livepeer --out out-v2
bun demo/make-audio.ts
bun demo/build.ts out-v2/Chinteyley-shipreel out-v2/livepeer-go-livepeer
npx hyperframes render demo --output demo/renders/shipreel-demo.mp4 --quality delivery
```

## License

MIT
