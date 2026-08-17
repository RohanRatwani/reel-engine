# reel-engine

A **Claude Code skill** for making vertical short-form video (Reels, Shorts, TikTok)
entirely on your own machine. No paid APIs, no subscriptions, nothing uploaded.

Built while making reels for [@theprocrastihacker](https://instagram.com/theprocrastihacker).
Every gotcha in here shipped a broken video at least once first.

## What's in it

**Scripts**

| | |
|---|---|
| `vo-clean.mjs` | Fixes the single most common reel problem: **phone voice memos are ~24 dB too quiet.** Two-pass loudness normalisation to -14 LUFS with denoise, without shifting word timings |
| `conform-footage.mjs` | Raw phone clip → render-ready 1080x1920. Detects HDR and tone maps it, never crops (and explains why) |
| `transcribe.py` | Local Whisper, word-level timings. No API |
| `kinetic-captions.mjs` | The Submagic/CapCut auto-caption look, generated from your own transcript for free |
| `clip-finder.mjs` | Feed it a 10-minute recording, get ranked clip candidates with timestamps and reasons |
| `ref-grab.mjs` | Paste a reel URL → downloaded, frame-sheeted, transcribed folder ready to study |
| `verify-render.mjs` | Pass/fail gate on the things that actually break uploads |

**Templates** — two HyperFrames compositions that lint clean and render as-is:
a single-clip caption-bait loop, and a red/green checklist with censor-bar reveals.

**References** — the accumulated gotchas (audio loudness, HDR colour, the sharpness
rule, HyperFrames traps) and a guide to picking formats and writing hooks.

## Install

Drop the folder into your skills directory:

```bash
git clone https://github.com/<you>/reel-engine .claude/skills/reel-engine
```

Then in Claude Code: *"make me a reel about X"* or *"my voiceover sounds terrible"*
and the skill loads itself.

**Dependencies**

```bash
npm i -g hyperframes         # HTML+GSAP -> MP4 (Apache-2.0, from HeyGen)
pip install faster-whisper   # local transcription
pip install yt-dlp           # only needed for ref-grab
# plus ffmpeg on PATH
```

Fonts are not bundled for licensing reasons. The templates use Space Grotesk and
JetBrains Mono, both free on Google Fonts.

## The three things most worth reading

Even if you never install this:

1. **Measure your voiceover loudness.** `ffmpeg -i voice.m4a -af ebur128 -f null -`
   If it is not near -14 LUFS, that is why your reel sounds amateur next to
   everyone else's.
2. **Tone map HDR footage.** If `ffprobe` says `arib-std-b67`, converting without
   tone mapping is why your walls look grey and your windows blown out.
3. **Never crop into phone footage.** The full-frame 4K→1080 downscale is what
   makes it look sharp. A punch-in throws that away and cannot be recovered.

All three are in `references/gotchas.md` with the exact commands.

## Not included, on purpose

No API keys, no credentials, no personal footage, and none of the reference videos
used during development — those belong to their creators. `ref-grab.mjs` will fetch
references for you to study locally; keep them that way.

## Licence

MIT. Do whatever you want with it.
