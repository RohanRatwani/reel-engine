#!/usr/bin/env node
/**
 * conform-footage.mjs — turn a raw phone clip into a render-ready 1080x1920 asset.
 *
 * Two things silently wreck phone footage, and both are invisible in a small
 * preview. This handles both.
 *
 * 1. HDR. Modern phones record 10-bit HLG or PQ. Converting to 8-bit SDR without
 *    TONE MAPPING gives you milky grey walls, blown-out windows and dead flat
 *    contrast. It looks like a broken export because it is one. This script
 *    detects HDR and inserts the tone-map chain automatically.
 *
 * 2. Cropping. Downscaling a full 4K frame to 1080 wide averages 4 source pixels
 *    into 1, and that supersample IS what makes phone footage look sharp. Crop in
 *    first and you throw the ratio away. A 1:1 "punch in" is unusable mush.
 *    So this script NEVER crops. If you want a close-up, shoot a close-up.
 *
 * Usage:
 *   node scripts/conform-footage.mjs <in.mp4> [out.mp4] [options]
 *
 * Options:
 *   --keep-audio      keep the audio track (default: strip it)
 *   --fps <n>         output frame rate                  (default 30)
 *   --crf <n>         quality, lower is better           (default 16)
 *   --sharpen <n>     unsharp amount, 0 disables         (default 0.6)
 *   --slow <factor>   stretch time, e.g. 3 = 3x slower   (default off)
 *   --check           report what it detects and exit, change nothing
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
if (!argv[0]) {
  console.error("usage: node scripts/conform-footage.mjs <in.mp4> [out.mp4] [--check]");
  process.exit(1);
}

const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const inFile = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const outFile = positional[0] ||
  inFile.replace(/(\.\w+)$/, "-ready.mp4").replace(/-ready\.mp4$/, "-ready.mp4");

const FPS = flag("fps", "30");
const CRF = flag("crf", "16");
const SHARPEN = parseFloat(flag("sharpen", "0.6"));
const SLOW = flag("slow", null);

if (!fs.existsSync(inFile)) { console.error(`not found: ${inFile}`); process.exit(1); }

// ---------------------------------------------------------------- probe
function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,pix_fmt,color_transfer,color_primaries,r_frame_rate",
    "-show_entries", "format=duration", "-of", "default=nw=1", file], { encoding: "utf8" });
  const txt = r.stdout || "";
  const g = (k) => (txt.match(new RegExp(`${k}=(.+)`)) || [])[1]?.trim();
  return {
    width: +g("width"), height: +g("height"), pix: g("pix_fmt"),
    transfer: g("color_transfer"), primaries: g("color_primaries"),
    fps: g("r_frame_rate"), duration: parseFloat(g("duration")),
  };
}

const p = probe(inFile);
const isHDR = p.transfer === "arib-std-b67" || p.transfer === "smpte2084" ||
              p.primaries === "bt2020";

console.log(`\nconform-footage`);
console.log(`  in  : ${inFile}`);
console.log(`  src : ${p.width}x${p.height}, ${p.pix}, ${p.duration?.toFixed(1)}s, ${p.fps}`);
console.log(`  HDR : ${isHDR ? `YES (${p.transfer}) -> tone mapping ON` : "no"}`);

const ratio = p.width / 1080;
console.log(`  downscale ratio: ${ratio.toFixed(2)}x ${
  ratio >= 1.9 ? "(good, full supersample)" :
  ratio >= 1.3 ? "(acceptable, will be a little soft)" :
                 "(LOW — expect softness, this footage cannot carry a close-up)"}`);

if (has("check")) { console.log(); process.exit(0); }

// ---------------------------------------------------------------- filters
const filters = [];

if (SLOW) filters.push(`setpts=${SLOW}*PTS`);

if (isHDR) {
  /* hable at npl=100 beat mobius in side-by-side tests: more contrast and
     saturation retained. Order matters — linearise, tone map, then go back to
     bt709 and only then drop to 8-bit. */
  filters.push(
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p"
  );
}

// full frame, never a crop. lanczos is the sharpest sane scaler here.
filters.push("scale=1080:1920:flags=lanczos");

if (SHARPEN > 0) {
  /* 0.6 was chosen over 1.1 in testing: 1.1 haloed high-contrast edges, which
     looks worse than slightly soft. Luma only, chroma left alone. */
  filters.push(`unsharp=5:5:${SHARPEN}:5:5:0.0`);
}

const args = ["-y", "-v", "error", "-i", inFile, "-vf", filters.join(",")];
if (!has("keep-audio")) args.push("-an");
args.push(
  "-r", FPS, "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-pix_fmt", "yuv420p",
  // MUST re-tag as bt709. Leaving bt2020/HLG tags on 8-bit h264 makes players
  // double-handle the colour and Instagram mangles it further.
  "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
  "-movflags", "+faststart", outFile
);

execFileSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

const out = probe(outFile);
console.log(`  out : ${outFile}`);
console.log(`        ${out.width}x${out.height}, ${out.pix}, ${out.duration?.toFixed(1)}s`);
console.log(`\n  ⚠️ Check the result at FULL 1080x1920, never at thumbnail size.`);
console.log(`     Both HDR and softness problems are invisible at 200px.\n`);
