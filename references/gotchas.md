# The gotchas

Every item here cost real time to find, and several of them shipped a broken video
before being caught. They are ordered by how badly they bite.

---

## Audio: your voice memo is far quieter than you think

**The single most likely reason your reel feels bad.**

Phone voice memos land around **-38 LUFS**. Instagram wants about **-14 LUFS**.
That is roughly 24 dB down, near a sixteenth of normal loudness. A reel like that
is inaudible next to any other video at the same system volume, and the viewer
does not think "the audio is quiet", they just leave.

```bash
ffmpeg -i voice.m4a -af ebur128 -f null -      # read "Integrated loudness"
node scripts/vo-clean.mjs voice.m4a voice-clean.m4a
ffmpeg -i final.mp4 -af ebur128 -f null -      # verify, expect about -14
```

**`linear=true` on loudnorm is not optional** if you have synced anything to a
transcript. It applies one static gain instead of riding the level, so word
timings do not move. Without it, captions and animation drift out of sync.

**Two traps if you script this yourself:**

1. **ffmpeg writes its analysis to stderr and exits 0.** So `execFileSync` gives
   you an empty string and a try/catch never fires. Use `spawnSync` and read
   `stderr`.
2. **`ebur128` prints an `I:` line for every frame as it goes.** Regex for the
   first `I:` and you will grab a silent moment at the start and read `-70`. Only
   parse the number under the final `Integrated loudness:` heading.

The free fix that beats all of the above: **hold the phone 15-20 cm from your
mouth.** Distance is the whole problem. Record one test line and play it back
before recording everything.

---

## Footage: HDR will wreck your colour

Modern phones record 10-bit HLG or PQ. Convert that to 8-bit SDR without tone
mapping and you get milky grey walls, blown-out windows, flat everything.

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=color_transfer,color_primaries,pix_fmt \
  -of default=nw=1 in.mp4
```

`arib-std-b67` (HLG) or `smpte2084` (PQ) means you must tone map.
`node scripts/conform-footage.mjs in.mp4` detects and handles it.

`hable` at `npl=100` beat `mobius` in side-by-side tests. And you **must re-tag
the output as bt709** — leaving bt2020/HLG tags on 8-bit h264 makes players
double-handle the colour and platforms mangle it further.

## Footage: never crop into phone video

Downscaling a full 4K frame to 1080 wide averages 4 source pixels into 1. **That
supersample is what makes phone footage look sharp.** Crop first and you throw
the ratio away.

| approach | ratio | result |
|---|---|---|
| full frame 2160 → 1080 | 2.0x | sharp, always do this |
| crop to 1512 → 1080 | 1.4x | visibly soft |
| 1:1 punch-in | 1.0x | unusable mush |

4K source has no real detail left at 2x punch-in — phone noise reduction already
smeared it. **Close-ups have to be shot, not cropped.** `unsharp` at 0.6 helps;
at 1.1 it haloes edges and looks worse than slightly soft.

## Validate at full resolution, always

Both problems above are **invisible at 200px and obvious at 1080x1920**. A batch
got approved at thumbnail scale once and had to be redone. Extract a real frame
and look at it properly.

---

## HyperFrames composition traps

- **`<video>` must be a DIRECT child of `#root`.** Wrap it in a div and it renders
  black. Use a muted file too; audio-bearing video can trip a symlink path that
  fails on Windows.
- **Every timed element needs `class="clip"` plus `data-start`, `data-duration`
  and `data-track-index`.** Miss one and it silently never appears.
- **Never mix a CSS transform and a GSAP transform tween on the same element.**
  Hard lint error. If you need a static 3D rotation plus an animated scale, nest
  two wrappers: GSAP owns the outer, CSS owns the inner.
- **Exit fades landing on a clip boundary need a `tl.set(...)` hard kill** right
  after, or a non-linear seek can restore stale visibility and flash the element.
- **Never let two tweens drive the same property at the same time.** A scale
  entrance overlapping a scale "punch" is a lint error, and it looks wrong too.
- **Deterministic only.** No `Math.random()`, no `Date.now()`, no network fetch,
  no `repeat: -1`. For count-ups, tween a plain object and write `textContent` in
  `onUpdate`.
- **Every font family you name needs its own `@font-face`.** Including fallbacks.
  `"Anton", "Space Grotesk", sans-serif` fails lint unless BOTH are declared.
- **Windows symlink EPERM on render** means Developer Mode is off. Turn it on or
  run as admin.

## Emoji do not render

The headless Chrome that does the capture has no regional-indicator glyphs, so
`🇺🇸` comes out as the literal letters **"US"**. Flags have to be drawn — a CSS
gradient bar works fine. Emoji in the caption text is fine, just not on screen.

## Whisper output needs cleaning

Real transcripts contain words where `start === end`, and occasionally a word
whose end overruns the next word's start. Normalise before using them for timing:
clamp each word's end to the next word's start, and enforce a minimum duration.
`kinetic-captions.mjs` and `clip-finder.mjs` both do this already.

## Your source clip must be at least as long as the scene

Shorter clip than `data-duration` gives you a frozen or black tail. If you need a
long ground from a short clip, slow it down (`setpts=3*PTS`) — on a blurred,
darkened background layer the slow motion is invisible.
