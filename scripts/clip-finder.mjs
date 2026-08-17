#!/usr/bin/env node
/**
 * clip-finder.mjs — find the clippable moments in a long-form recording.
 *
 * Feed it the word-level whisper JSON for a 5-20 minute session and it returns a
 * ranked list of candidate reel clips with timestamps, so you never scrub a
 * timeline hunting for the good 40 seconds.
 *
 * Usage:
 *   node scripts/clip-finder.mjs <words.json> [options]
 *
 * Options:
 *   --min <sec>       shortest acceptable clip            (default 18)
 *   --max <sec>       longest acceptable clip             (default 60)
 *   --top <n>         how many candidates to print        (default 12)
 *   --json            emit JSON instead of a report
 *   --cut <n>         print ffmpeg commands for the top n candidates
 *
 * Scoring is heuristic and deliberately transparent — every candidate prints
 * WHY it scored, so you can disagree with it quickly. It is a shortlist tool,
 * not a judge.
 */

import fs from "node:fs";

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const o = { min: 18, max: 60, top: 12, json: false, cut: 0 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const next = () => argv[++i];
    switch (a) {
      case "--min":  o.min = parseFloat(next()); break;
      case "--max":  o.max = parseFloat(next()); break;
      case "--top":  o.top = parseInt(next(), 10); break;
      case "--cut":  o.cut = parseInt(next(), 10); break;
      case "--json": o.json = true; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  if (!pos[0]) {
    console.error("usage: node scripts/clip-finder.mjs <words.json> [--min 18] [--max 60] [--top 12] [--cut 3]");
    process.exit(1);
  }
  o.wordsPath = pos[0];
  return o;
}

// ---------------------------------------------------------------- signals
/**
 * A clip has to survive being ripped out of context. These are the things that
 * make that possible, weighted by how much they actually matter.
 */

// Openers that start a self-contained thought. A clip that begins with one of
// these makes sense to someone who did not hear the previous sentence.
const STRONG_OPENERS = [
  "here's the", "here is the", "the thing is", "most people", "everyone",
  "nobody", "the problem", "the reason", "if you", "you should", "you don't",
  "stop", "never", "always", "the fastest", "the best", "the worst",
  "i used to", "i spent", "i built", "i tried", "let me", "there are",
  "this is why", "that's why", "the trick", "one thing", "my rule",
];

// Words that signal a claim worth clipping rather than filler narration.
const PUNCH = [
  "actually", "literally", "honestly", "biggest", "worst", "best", "never",
  "always", "free", "wrong", "mistake", "broke", "failed", "fixed", "instead",
  "secret", "nobody", "everyone", "stop", "don't", "should", "faster",
  "cheaper", "easier", "hours", "minutes", "seconds",
];

// Openers that CANNOT start a clip — they refer to something already said.
const DANGLING = [
  "so", "and", "but", "then", "also", "because", "which", "that's why",
  "like i said", "as i mentioned", "anyway", "ok so", "okay so", "right so",
  "this one", "that one", "it does", "they do", "he", "she", "it",
];

const NUMBERISH = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third)\b/i;

// ---------------------------------------------------------------- load
function loadWords(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw) || !raw.length) throw new Error(`${file}: expected a non-empty [{w,s,e}]`);
  const words = raw
    .map((r) => ({ w: String(r.w ?? "").trim(), s: +r.s, e: +r.e }))
    .filter((r) => r.w && Number.isFinite(r.s) && Number.isFinite(r.e))
    .sort((a, b) => a.s - b.s);
  // repair whisper's zero-length and overrunning spans
  for (let i = 0; i < words.length; i++) {
    const n = words[i + 1];
    if (n && words[i].e > n.s) words[i].e = n.s;
    if (words[i].e <= words[i].s) words[i].e = words[i].s + 0.08;
  }
  return words;
}

/** Split the stream into sentences on terminal punctuation or a long pause. */
function toSentences(words, pauseGap = 0.62) {
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const w = words[i];
    const nxt = words[i + 1];
    const terminal = /[.!?]$/.test(w.w);
    const bigPause = nxt && nxt.s - w.e > pauseGap;
    if (terminal || bigPause) {
      out.push(mkSentence(cur));
      cur = [];
    }
  }
  if (cur.length) out.push(mkSentence(cur));
  return out.filter((s) => s.words.length > 1);
}

function mkSentence(ws) {
  return {
    words: ws,
    s: ws[0].s,
    e: ws[ws.length - 1].e,
    text: ws.map((w) => w.w).join(" ").replace(/\s+([,.!?])/g, "$1"),
  };
}

// ---------------------------------------------------------------- scoring
function scoreCandidate(sents, from, to, opts) {
  const chosen = sents.slice(from, to + 1);
  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  const dur = last.e - first.s;
  if (dur < opts.min || dur > opts.max) return null;

  const text = chosen.map((c) => c.text).join(" ");
  const lower = text.toLowerCase();
  const head = first.text.toLowerCase();
  const words = text.split(/\s+/).length;

  const reasons = [];
  let score = 0;

  // 1. Does it start cleanly? This is the single biggest factor — a clip that
  //    opens mid-thought is unusable no matter how good the content is.
  const opener = STRONG_OPENERS.find((o) => head.startsWith(o));
  if (opener) { score += 32; reasons.push(`clean opener ("${opener}…")`); }

  const dangler = DANGLING.find((d) => head.startsWith(d + " ") || head === d);
  if (dangler) { score -= 30; reasons.push(`⚠ opens mid-thought ("${dangler}…")`); }

  // 2. Numbers travel. "Three things" and "40 projects" are inherently clippable.
  if (NUMBERISH.test(first.text)) { score += 14; reasons.push("number in the opening line"); }

  // 3. Claim density.
  const hits = PUNCH.filter((p) => lower.includes(p));
  if (hits.length) {
    score += Math.min(24, hits.length * 5);
    reasons.push(`claim words: ${hits.slice(0, 5).join(", ")}`);
  }

  // 4. Pace. Very slow stretches are usually thinking out loud, not delivery.
  const wps = words / dur;
  if (wps >= 2.2 && wps <= 3.6) { score += 12; reasons.push(`good pace (${wps.toFixed(1)} w/s)`); }
  else if (wps < 1.7) { score -= 12; reasons.push(`⚠ slow/rambling (${wps.toFixed(1)} w/s)`); }

  // 5. Length sweet spot. Short clips loop; that is the Format D bet.
  if (dur >= 20 && dur <= 42) { score += 10; reasons.push("ideal reel length"); }

  // 6. Ends on a full stop rather than trailing off.
  if (/[.!?]$/.test(last.text)) { score += 8; reasons.push("ends on a complete sentence"); }
  else { score -= 8; reasons.push("⚠ trails off"); }

  // 7. Penalise filler.
  const fillers = (lower.match(/\b(um|uh|you know|i mean|kind of|sort of|basically)\b/g) || []).length;
  if (fillers) {
    score -= Math.min(18, fillers * 3);
    reasons.push(`⚠ ${fillers} filler${fillers > 1 ? "s" : ""}`);
  }

  return { from, to, start: first.s, end: last.e, dur, score, text, reasons, wps };
}

/** Slide a window over sentence groups and keep the best non-overlapping set. */
function findCandidates(sents, opts) {
  const all = [];
  for (let i = 0; i < sents.length; i++) {
    for (let j = i; j < Math.min(i + 14, sents.length); j++) {
      const c = scoreCandidate(sents, i, j, opts);
      if (c) all.push(c);
    }
  }
  all.sort((a, b) => b.score - a.score);

  // greedy non-overlap so the shortlist is not 12 versions of one moment
  const picked = [];
  for (const c of all) {
    if (picked.some((p) => c.start < p.end - 0.5 && c.end > p.start + 0.5)) continue;
    picked.push(c);
    if (picked.length >= opts.top) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

const ts = (t) => {
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

// ---------------------------------------------------------------- main
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const words = loadWords(opts.wordsPath);
  const sents = toSentences(words);
  const cands = findCandidates(sents, opts);

  const total = words[words.length - 1].e;

  if (opts.json) {
    console.log(JSON.stringify({ sourceDuration: total, candidates: cands }, null, 2));
    return;
  }

  console.log(`\nclip-finder — ${(total / 60).toFixed(1)} min source, ${sents.length} sentences`);
  console.log(`${cands.length} candidates, ${opts.min}-${opts.max}s\n`);

  cands.forEach((c, i) => {
    const bar = c.score >= 60 ? "STRONG" : c.score >= 38 ? "maybe " : "weak  ";
    console.log(`${String(i + 1).padStart(2)}. [${bar}] ${ts(c.start)} → ${ts(c.end)}  (${c.dur.toFixed(1)}s, score ${c.score})`);
    console.log(`    ${c.text.slice(0, 150)}${c.text.length > 150 ? "…" : ""}`);
    console.log(`    ${c.reasons.join(" · ")}\n`);
  });

  if (opts.cut > 0) {
    console.log("\n# cut the top candidates (pad 0.3s head, 0.5s tail):");
    cands.slice(0, opts.cut).forEach((c, i) => {
      const ss = Math.max(0, c.start - 0.3).toFixed(2);
      const t = (c.dur + 0.8).toFixed(2);
      console.log(`ffmpeg -y -ss ${ss} -i SOURCE.mp4 -t ${t} -c:v libx264 -crf 18 -preset slow -c:a aac clip-${String(i + 1).padStart(2, "0")}.mp4`);
    });
  }

  console.log(`\nnote: this is a shortlist, not a judge. Every score shows its reasons —`);
  console.log(`disagree fast and move on. Anything marked ⚠ needs a listen before you trust it.\n`);
}

main();
