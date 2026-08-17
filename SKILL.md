---
name: reel-engine
description: "Build vertical short-form video (Instagram Reels, TikTok, YouTube Shorts) locally and for free, from footage to rendered MP4. Use when the user wants to make a reel or short, add word-synced captions to a clip, fix quiet or bad-sounding voiceover audio, conform phone footage for a vertical edit, cut clips out of a long recording, or study a reference reel from a link. Covers the whole pipeline: hook writing, HyperFrames composition, local Whisper transcription, ffmpeg loudness and colour, and render verification. No paid APIs, no subscriptions, nothing uploaded."
---

# reel-engine

A complete local pipeline for vertical short-form video. Everything runs on the
machine you already have: no paid APIs, no subscriptions, no uploads.

**Stack:** Whisper (local, word-level timings) · HyperFrames (HTML+GSAP → MP4,
open source, Apache-2.0) · ffmpeg · Node.

## First: what are you actually doing?

| Intent | Go to |
|---|---|
| Make a reel from scratch | "The pipeline" below |
| Add word-synced captions to a clip | `scripts/kinetic-captions.mjs` |
| Voice sounds quiet, muddy, or bad | `scripts/vo-clean.mjs` — **and read the audio section of `references/gotchas.md` first** |
| Phone footage looks washed out or soft | `scripts/conform-footage.mjs` |
| Pull clips out of a long recording | `scripts/clip-finder.mjs` |
| Study a reel someone sent me | `scripts/ref-grab.mjs <url>` |
| Decide what to make / write the hook | `references/formats-and-hooks.md` |
| Something rendered wrong | `references/gotchas.md` |

**Before writing any composition, read `references/gotchas.md`.** It is short and
every entry in it is a bug that shipped once.

## Setup

```bash
npm i -g hyperframes            # or use npx, as below
pip install faster-whisper      # local transcription
pip install yt-dlp              # only for ref-grab.mjs
# ffmpeg must be on PATH
```

Fonts are not bundled (licensing). Put `.woff2` files in your project's `fonts/`.
The templates use **Space Grotesk** and **JetBrains Mono**, both free on Google
Fonts. Any family you name in CSS needs its own `@font-face` or lint fails.

## The pipeline

```
[1] TOPIC + HOOK    references/formats-and-hooks.md
[2] FOOTAGE         node scripts/conform-footage.mjs raw.mp4 assets/broll.mp4
[3] COMPOSE         copy templates/format-d or format-e, edit the text
[4] LINT            npx hyperframes lint          ← fix every error before rendering
[5] RENDER          npx hyperframes render
[6] AUDIO (if VO)   node scripts/vo-clean.mjs vo.m4a vo-clean.m4a
                    then mux: ffmpeg -i silent.mp4 -i vo-clean.m4a \
                      -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k out.mp4
[7] VERIFY          node scripts/verify-render.mjs out.mp4
                    then extract a frame and LOOK at it, at full resolution
```

Step 7 is not optional. Several classes of bug are invisible in the code and in a
small preview, and obvious in one full-size frame: unreadable text over a bright
window, a dangling half-sentence, an element overlapping another.

## Non-negotiables

These are the rules that produce most of the failures. Full detail in
`references/gotchas.md`.

1. **Run every voiceover through `vo-clean.mjs`.** Phone memos are ~24 dB too
   quiet. This is the most common reason a reel feels amateur.
2. **Tone map HDR footage.** Phones shoot 10-bit HLG. Skipping this gives grey
   milky walls.
3. **Never crop into phone footage.** The 4K→1080 downscale is what makes it look
   sharp. Close-ups must be shot, not cropped.
4. **Verify at full 1080x1920.** Never judge colour or legibility from a thumbnail.
5. **Show your hook on frame 0**, as a complete sentence. No fade-in.
6. **`<video>` must be a direct child of `#root`**, or it renders black.
7. **Never mix CSS transform with a GSAP transform tween on one element.**
8. **Deterministic only** — no `Math.random()`, no `Date.now()`, no fetch.

## Adding a voiceover

Build silent first, record at a natural pace, then **retime the animation to the
delivery**. Never make the voice fit pre-set marks — that is what makes VO sound
rushed. Budget ~2.3 words/sec, not 3.

The templates keep their beat times in named arrays (`RED`, `GREEN`) exactly so
they can be replaced with real onsets from `transcribe.py` output.

A VO reel gets no trending audio; the voice and the music compete and both lose.

## Templates

- `templates/format-d/` — one clip, one hook line, detail in the caption. 6-8s.
  For reference-shaped content: paths, keys, tool names.
- `templates/format-e/` — the red/green list with censor-bar reveals. 12-20s.
  The most shareable structure here. For comparisons and checklists.

Both lint clean and render as-is once you add `assets/broll.mp4` and fonts.

## Scripts

| Script | Does |
|---|---|
| `transcribe.py` | audio → word-level `[{w,s,e}]` JSON, locally |
| `vo-clean.mjs` | voice memo → broadcast-loudness (-14 LUFS) audio |
| `conform-footage.mjs` | raw phone clip → 1080x1920 asset, HDR-safe, never cropped |
| `kinetic-captions.mjs` | word timings → paste-in CSS/HTML/GSAP captions |
| `clip-finder.mjs` | long recording → ranked clip candidates with timestamps |
| `ref-grab.mjs` | reel URL → downloaded, framed, transcribed reference folder |
| `verify-render.mjs` | final MP4 → pass/fail gate on the things that break uploads |

Run any of them with no arguments for usage.

## On references

`ref-grab.mjs` downloads other people's videos so you can study format, pacing and
structure. **Keep those files local and never republish them.** Reverse-engineer
the technique, not the content.
