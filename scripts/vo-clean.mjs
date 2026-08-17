#!/usr/bin/env node
/**
 * vo-clean.mjs — make a phone voice memo sound like it belongs on Instagram.
 *
 * Phone voice memos come in FAR too quiet. The 2026-08-16 recording measured
 * -38.5 LUFS integrated with a -21 dBFS true peak; Instagram targets about
 * -14 LUFS. That is ~24 dB down, roughly a sixteenth of normal loudness, and it
 * is why the reel was inaudible next to a YouTube video at the same system volume.
 *
 * Raising the level alone would raise the room noise with it, so the chain is:
 *   highpass 80 Hz   kill desk rumble and handling thumps
 *   afftdn           gentle broadband denoise (room hiss)
 *   acompressor      even out the loud/soft words so nothing disappears
 *   loudnorm 2-pass  hit -14 LUFS accurately (single pass drifts)
 *   alimiter         catch stray peaks so IG never clips it
 *
 * `linear=true` on loudnorm matters: it applies one static gain rather than
 * riding the level dynamically, so **word timings do not move** and any
 * animation already retimed to the transcript stays in sync.
 *
 * Usage:
 *   node scripts/vo-clean.mjs <in.m4a> [out.m4a] [--target -14]
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
if (!argv[0]) {
  console.error("usage: node scripts/vo-clean.mjs <in.m4a> [out.m4a] [--target -14]");
  process.exit(1);
}

const inFile = argv[0];
let target = -14;
const ti = argv.indexOf("--target");
if (ti !== -1) target = parseFloat(argv[ti + 1]);

const positional = argv.filter((a, i) => !a.startsWith("--") && (ti === -1 || i !== ti + 1));
const outFile = positional[1] ||
  path.join(path.dirname(inFile), path.basename(inFile).replace(/(\.\w+)$/, "-clean$1"));

if (!fs.existsSync(inFile)) { console.error(`not found: ${inFile}`); process.exit(1); }

/* ffmpeg writes its analysis to STDERR and still exits 0, so execFileSync's
   return value (stdout) is empty and a try/catch never fires. spawnSync is the
   only way to read it on success. This cost one debugging round. */
function ffErr(args) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return (r.stderr || "") + (r.stdout || "");
}

function lufs(file) {
  const txt = ffErr(["-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  /* ebur128 prints a per-frame "I:" line for the WHOLE file as it goes, so a
     naive /I:\s*(-?[\d.]+)/ grabs an early silent frame (-70 LUFS) instead of
     the result. The number we want is only in the trailing summary block, under
     "Integrated loudness:". Same for the true peak. */
  const iBlock = txt.split("Integrated loudness:").pop() || "";
  const i = (iBlock.match(/I:\s*(-?[\d.]+)\s*LUFS/) || [])[1];
  const pBlock = txt.split("True peak:").pop() || "";
  const p = (pBlock.match(/Peak:\s*(-?[\d.]+)\s*dBFS/) || [])[1];
  return { i: i ? parseFloat(i) : null, peak: p ? parseFloat(p) : null };
}

const PRE = "highpass=f=80,afftdn=nf=-28";

console.log(`\nvo-clean\n  in : ${inFile}`);

// ---- pass 1: measure through the same pre-filters loudnorm will see
const p1 = ffErr(["-hide_banner", "-i", inFile, "-af",
  `${PRE},loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"]);
const grab = (k) => (p1.match(new RegExp(`"${k}"\\s*:\\s*"(-?[\\d.a-z]+)"`)) || [])[1];
const stats = {
  i: grab("input_i"), tp: grab("input_tp"),
  lra: grab("input_lra"), thresh: grab("input_thresh"), offset: grab("target_offset"),
};

if (!stats || !stats.i) {
  console.error("  could not measure input — is ffmpeg on PATH?");
  process.exit(1);
}
console.log(`  measured: ${stats.i} LUFS, true peak ${stats.tp} dBFS`);

// ---- pass 2: apply. linear=true keeps word timings put.
const chain =
  `${PRE},` +
  `acompressor=threshold=-18dB:ratio=3:attack=8:release=180:makeup=1,` +
  `loudnorm=I=${target}:TP=-1.5:LRA=11:` +
  `measured_I=${stats.i}:measured_TP=${stats.tp}:measured_LRA=${stats.lra}:` +
  `measured_thresh=${stats.thresh}:offset=${stats.offset}:linear=true,` +
  `alimiter=limit=0.94`;

execFileSync("ffmpeg", ["-y", "-v", "error", "-i", inFile, "-af", chain,
  "-ar", "48000", "-ac", "1", "-c:a", "aac", "-b:a", "192k", outFile]);

const after = lufs(outFile);
console.log(`  out: ${outFile}`);
console.log(`  now: ${after.i ?? "?"} LUFS, true peak ${after.peak ?? "?"} dBFS  (target ${target})\n`);

if (after.i !== null && Math.abs(after.i - target) > 1.5) {
  console.log("  ⚠️ more than 1.5 LU off target — check the source for clipping or long silences\n");
}
