#!/usr/bin/env node
/**
 * ref-grab.mjs — paste a reel link, get a fully prepped reference folder.
 *
 * Replaces the manual loop of: open a downloader site, save the file, find it in
 * Downloads, drag it into chat. Now it is one command and everything Claude needs
 * to analyse the reel is already on disk.
 *
 * Usage:
 *   node scripts/ref-grab.mjs <url> [--name <slug>] [--frames 8] [--no-transcribe]
 *
 * Works with: Instagram reels/posts, YouTube (incl. Shorts), TikTok, X — anything
 * yt-dlp supports. Public links only; see the note on private content below.
 *
 * Produces <out-dir>/<slug>/  (default ./refs/<slug>/)
 *   ref.mp4            the video
 *   f/tN.png           evenly spaced frames
 *   f/sheetA.png, ...  contact sheets, 4 frames each — this is what Claude reads
 *   words.json         word-level transcript (local whisper, no API)
 *   INFO.md            metadata + transcript + an analysis checklist
 *
 * ⚠️ These are for STUDYING format, pacing and structure. Do not republish someone
 * else's footage. Every reference in this repo is used to reverse-engineer
 * technique, never to copy content.
 */

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/* All paths are resolved from where you run the command, or from env vars, so
   this script is portable. Override any of them:
     REEL_REFS_DIR   where reference folders are written   (default ./refs)
     WHISPER_PYTHON  python that has faster-whisper        (default "python")
     HF_CACHE_DIR    where model weights are cached        (default HF default) */
const REFS = process.env.REEL_REFS_DIR || path.resolve("refs");
const WHISPER_PY = process.env.WHISPER_PYTHON || "python";
const TRANSCRIBE = path.join(import.meta.dirname, "transcribe.py");

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const o = { frames: 8, transcribe: true, name: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    if (a === "--name") o.name = argv[++i];
    else if (a === "--frames") o.frames = parseInt(argv[++i], 10);
    else if (a === "--no-transcribe") o.transcribe = false;
    else throw new Error(`unknown option: ${a}`);
  }
  if (!pos[0]) {
    console.error("usage: node scripts/ref-grab.mjs <url> [--name slug] [--frames 8] [--no-transcribe]");
    process.exit(1);
  }
  o.url = pos[0];
  return o;
}

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

// ---------------------------------------------------------------- steps
function fetchMeta(url) {
  const out = sh(
    `python -m yt_dlp --no-warnings --simulate --print "%(id)s\t%(uploader)s\t%(duration)s\t%(title)s" "${url}"`
  );
  const [id, uploader, duration, title] = out.split("\t");
  return { id, uploader, duration, title };
}

function download(url, dir) {
  const out = path.join(dir, "ref.mp4");
  execSync(
    `python -m yt_dlp --no-warnings -f "bv*+ba/b" --merge-output-format mp4 -o "${out}" "${url}"`,
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  if (!fs.existsSync(out)) throw new Error("download produced no ref.mp4");
  return out;
}

function probe(file) {
  const out = sh(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate ` +
    `-show_entries format=duration -of default=nw=1 "${file}"`
  );
  const g = (k) => (out.match(new RegExp(`${k}=(.+)`)) || [])[1];
  return {
    width: g("width"), height: g("height"),
    fps: g("r_frame_rate"), duration: parseFloat(g("duration")),
  };
}

function grabFrames(file, dir, n, duration) {
  const fdir = path.join(dir, "f");
  fs.mkdirSync(fdir, { recursive: true });
  const times = [];
  // skip the very first and last moments — they are usually a fade or a black frame
  for (let i = 0; i < n; i++) {
    times.push(+(duration * ((i + 0.5) / n)).toFixed(2));
  }
  times.forEach((t, i) => {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", file,
      "-frames:v", "1", path.join(fdir, `t${i}.png`)]);
  });

  // contact sheets of 4 — one image Claude can read instead of 8 separate reads
  const sheets = [];
  for (let s = 0; s * 4 < n; s++) {
    const group = times.map((_, i) => i).slice(s * 4, s * 4 + 4);
    if (!group.length) break;
    const inputs = group.flatMap((i) => ["-i", path.join(fdir, `t${i}.png`)]);
    const filter = `${group.map((_, k) => `[${k}]`).join("")}hstack=inputs=${group.length},scale=1700:-2`;
    const outp = path.join(fdir, `sheet${String.fromCharCode(65 + s)}.png`);
    execFileSync("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", filter, outp]);
    sheets.push({ file: path.basename(outp), times: group.map((i) => times[i]) });
  }
  return { times, sheets };
}

function transcribe(file, dir) {
  if (!fs.existsSync(TRANSCRIBE)) return { ok: false, why: "scripts/transcribe.py missing" };
  const wav = path.join(dir, "a.wav");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", wav]);
  const words = path.join(dir, "words.json");
  const env = { ...process.env };
  if (process.env.HF_CACHE_DIR) {
    env.HF_HOME = process.env.HF_CACHE_DIR;
    env.HUGGINGFACE_HUB_CACHE = process.env.HF_CACHE_DIR;
  }
  execFileSync(WHISPER_PY, [TRANSCRIBE, wav, words], { env, stdio: ["ignore", "pipe", "pipe"] });
  if (!fs.existsSync(words)) return { ok: false, why: "transcribe produced no words.json" };
  const w = JSON.parse(fs.readFileSync(words, "utf8"));
  return { ok: true, count: w.length, text: w.map((x) => x.w).join(" ").replace(/\s+/g, " ").trim() };
}

// ---------------------------------------------------------------- main
function main() {
  const o = parseArgs(process.argv.slice(2));

  console.log(`\nref-grab\n  ${o.url}\n`);

  console.log("  · reading metadata");
  const meta = fetchMeta(o.url);

  const slug = o.name || slugify(`${meta.uploader || "ref"}-${meta.id}`);
  const dir = path.join(REFS, slug);
  fs.mkdirSync(dir, { recursive: true });

  console.log("  · downloading");
  const file = download(o.url, dir);

  const p = probe(file);
  console.log(`    ${p.width}x${p.height} · ${p.duration.toFixed(1)}s · ${p.fps}`);

  console.log(`  · extracting ${o.frames} frames + contact sheets`);
  const { sheets } = grabFrames(file, dir, o.frames, p.duration);

  let tr = { ok: false, why: "skipped" };
  if (o.transcribe) {
    console.log("  · transcribing locally (whisper)");
    try { tr = transcribe(file, dir); }
    catch (e) { tr = { ok: false, why: String(e.message).slice(0, 120) }; }
  }

  const info = `# Reference — ${meta.title || slug}

- **Source:** ${o.url}
- **Uploader:** ${meta.uploader || "unknown"}
- **Format:** ${p.width}x${p.height}, ${p.duration.toFixed(1)}s, ${p.fps} fps
- **Grabbed:** ${new Date().toISOString().slice(0, 10)}

> Studied for format, pacing and structure only. Not to be republished or copied.

## Contact sheets
${sheets.map((s) => `- \`f/${s.file}\` — frames at ${s.times.map((t) => t + "s").join(", ")}`).join("\n")}

## Transcript
${tr.ok
  ? `${tr.count} words, \`words.json\` has per-word timings.\n\n> ${tr.text}`
  : `_not available (${tr.why})_ — if there is no speech, it is a silent/music reel, which is itself a finding.`}

## Checklist — answer these from the sheets

- [ ] **Length** and how many distinct beats
- [ ] **Shot type**: full frame or letterboxed? locked-off or handheld? how close?
- [ ] **Persistent elements**: title card, header, handle, progress indicator
- [ ] **Text treatment**: font weight, position, does it accumulate or replace?
- [ ] **Cut rhythm**: seconds per beat, and what motivates each cut
- [ ] **Retention device**: what makes you stay past 3s and past 10s?
- [ ] **CTA**: comment trigger, save, share, follow?
- [ ] **What we can copy** vs **what is theirs**
`;

  fs.writeFileSync(path.join(dir, "INFO.md"), info, "utf8");

  console.log(`\n  ready: ${path.relative(process.cwd(), dir) || dir}`);
  sheets.forEach((s) => console.log(`    f/${s.file}`));
  if (tr.ok) console.log(`    words.json (${tr.count} words)`);
  console.log(`    INFO.md\n`);
  console.log(`  Tell Claude: "analyse the reference in ${slug}"\n`);
}

main();
