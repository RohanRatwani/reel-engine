#!/usr/bin/env node
/**
 * kinetic-captions.mjs — word-synced "kinetic typography" captions for HyperFrames.
 *
 * Turns a local-whisper words.json ({w,s,e} per word) into ready-to-paste
 * HTML + CSS + GSAP for a reel composition. This is the free, self-hosted
 * replacement for Submagic / CapCut auto-captions, in the cream-editorial palette.
 *
 * Usage:
 *   node scripts/kinetic-captions.mjs <words.json> [options]
 *
 * Options:
 *   --out <path>        write generated block to a file instead of stdout
 *   --demo <dir>        write a full standalone HyperFrames project (index.html) to <dir>
 *   --max-words <n>     max words per phrase card        (default 3)
 *   --gap <sec>         silence gap that forces a break  (default 0.45)
 *   --start <sec>       only emit words at/after this    (default 0)
 *   --end <sec>         only emit words before this      (default Infinity)
 *   --offset <sec>      shift all timings by this amount (default 0)
 *   --track <n>         data-track-index for phrases     (default 30)
 *   --size <cqw>        caption font size in cqw         (default 15)
 *   --pos <cqh>         top of the caption band, in cqh  (default 44)
 *   --style <name>      pop | rise | punch               (default pop)
 *   --font <name>       anton | grotesk                  (default anton)
 *   --reveal <name>     phrase | word                    (default phrase)
 *                         phrase = whole line lands, highlight travels (karaoke)
 *                         word   = words appear one at a time as spoken
 *
 * Emits nothing non-deterministic: no Math.random, no Date.now. Safe for
 * `hyperframes render`.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------- palette
// Cream editorial tokens. Keep in sync with CLAUDE.md section 3.
const TOKENS = {
  ink: "#161513",
  cream: "#f7f2e6",
  peach: "#f0a87a",
  butter: "#f0c860",
};

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const opts = {
    maxWords: 3,
    gap: 0.45,
    start: 0,
    end: Infinity,
    offset: 0,
    track: 30,
    size: 15,
    pos: 44,
    style: "pop",
    font: "anton",
    reveal: "phrase",
    out: null,
    demo: null,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const next = () => argv[++i];
    switch (a) {
      case "--max-words": opts.maxWords = parseInt(next(), 10); break;
      case "--gap":       opts.gap = parseFloat(next()); break;
      case "--start":     opts.start = parseFloat(next()); break;
      case "--end":       opts.end = parseFloat(next()); break;
      case "--offset":    opts.offset = parseFloat(next()); break;
      case "--track":     opts.track = parseInt(next(), 10); break;
      case "--size":      opts.size = parseFloat(next()); break;
      case "--pos":       opts.pos = parseFloat(next()); break;
      case "--style":     opts.style = next(); break;
      case "--font":      opts.font = next(); break;
      case "--reveal":    opts.reveal = next(); break;
      case "--out":       opts.out = next(); break;
      case "--demo":      opts.demo = next(); break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }

  if (!positional[0]) {
    console.error("usage: node scripts/kinetic-captions.mjs <words.json> [options]");
    process.exit(1);
  }
  opts.wordsPath = positional[0];

  if (!["pop", "rise", "punch"].includes(opts.style)) {
    throw new Error(`--style must be pop|rise|punch, got "${opts.style}"`);
  }
  if (!Number.isFinite(opts.maxWords) || opts.maxWords < 1) {
    throw new Error("--max-words must be >= 1");
  }
  if (!FONTS[opts.font]) {
    throw new Error(`--font must be one of ${Object.keys(FONTS).join("|")}, got "${opts.font}"`);
  }
  if (!["phrase", "word"].includes(opts.reveal)) {
    throw new Error(`--reveal must be phrase|word, got "${opts.reveal}"`);
  }
  return opts;
}

// ---------------------------------------------------------------- load + clean
/**
 * Whisper emits some degenerate spans where s === e, and occasionally a word
 * whose end overruns the next word's start. Normalise so every word has a
 * positive duration and the sequence is monotonic.
 */
function loadWords(file, { start, end, offset }) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${file} is not a non-empty array of {w,s,e}`);
  }

  const MIN_DUR = 0.08;

  const words = raw
    .map((r) => ({
      w: String(r.w ?? "").trim(),
      s: Number(r.s),
      e: Number(r.e),
    }))
    .filter((r) => r.w.length > 0 && Number.isFinite(r.s) && Number.isFinite(r.e))
    .filter((r) => r.s >= start && r.s < end)
    .sort((a, b) => a.s - b.s);

  if (words.length === 0) {
    throw new Error(`no words left after filtering (--start ${start} --end ${end})`);
  }

  for (let i = 0; i < words.length; i++) {
    const cur = words[i];
    const nxt = words[i + 1];
    // clamp the end to just before the next word starts
    if (nxt && cur.e > nxt.s) cur.e = nxt.s;
    // repair zero/negative spans
    if (cur.e - cur.s < MIN_DUR) {
      cur.e = nxt ? Math.min(cur.s + MIN_DUR, nxt.s) : cur.s + MIN_DUR;
    }
    if (cur.e <= cur.s) cur.e = cur.s + MIN_DUR;

    cur.s = round(cur.s + offset);
    cur.e = round(cur.e + offset);
  }

  return words;
}

const round = (n) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------- grouping
/**
 * Break the word stream into phrase cards. A break happens on any of:
 *   - reaching --max-words
 *   - sentence-ending punctuation (hard break, reads as a beat)
 *   - a silence gap longer than --gap
 * Commas break too, but only if the phrase already has 2+ words, so we don't
 * strand single words on their own card.
 */
function groupPhrases(words, { maxWords, gap }) {
  const phrases = [];
  let cur = [];

  const flush = () => {
    if (cur.length) {
      phrases.push({ words: cur, s: cur[0].s, e: cur[cur.length - 1].e });
      cur = [];
    }
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prev = words[i - 1];

    if (prev && word.s - prev.e > gap) flush();

    cur.push(word);

    const hardStop = /[.!?…]$/.test(word.w);
    const softStop = /[,;:]$/.test(word.w) && cur.length >= 2;

    if (cur.length >= maxWords || hardStop || softStop) flush();
  }
  flush();

  // Hold each phrase until the next one begins, so there is never a dead frame
  // mid-sentence. Trailing phrase gets a short tail.
  for (let i = 0; i < phrases.length; i++) {
    const next = phrases[i + 1];
    phrases[i].out = next ? next.s : round(phrases[i].e + 0.45);
    phrases[i].dur = round(Math.max(0.2, phrases[i].out - phrases[i].s));
  }

  return phrases;
}

// ---------------------------------------------------------------- escaping
const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ---------------------------------------------------------------- fonts
// Put the matching .woff2 in your project's fonts/ dir. Anton and Space Grotesk
// are both free on Google Fonts. Every family you name needs its own @font-face
// or `hyperframes lint` fails with font_family_without_font_face.
const FONTS = {
  // Condensed heavy display. This is the face the big "kinetic caption" look
  // is built on — tall, tight, fills the frame. Default.
  anton: {
    file: "anton.woff2",
    family: "Anton",
    weight: 400,
    // No named fallback: any family listed here needs its own @font-face or
    // hyperframes lint fails with font_family_without_font_face.
    css: `"Anton", system-ui, sans-serif`,
    tracking: "0.005em",
  },
  // Matches the rest of the cream-editorial system. Quieter, less shouty.
  grotesk: {
    file: "spacegrotesk-500.woff2",
    family: "Space Grotesk",
    weight: 500,
    css: `"Space Grotesk", system-ui, sans-serif`,
    tracking: "-0.01em",
  },
};

// ---------------------------------------------------------------- CSS
function buildCss({ size, pos, font }) {
  const f = FONTS[font];
  return `/* ── kinetic captions (generated by scripts/kinetic-captions.mjs) ── */
/* requires fonts/${f.file} in the project */
.kc-phrase {
  position: absolute;
  left: 6cqw;
  right: 6cqw;
  top: ${pos}cqh;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;
  /* Anton has tight sidebearings, so words need a wider column gap than the
     em value suggests or they visually collide at large sizes. */
  gap: 0.22em 0.5em;
  text-align: center;
  /* NOTE: no CSS transform here on purpose. GSAP owns transform on .kc-w,
     and mixing the two is a hyperframes lint error. Vertical placement is
     done with top/line-height, not translate. */
}
.kc-w {
  display: inline-block;
  font-family: ${f.css};
  font-weight: ${f.weight};
  font-size: ${size}cqw;
  line-height: 1.02;
  letter-spacing: ${f.tracking};
  text-transform: uppercase;
  color: ${TOKENS.cream};
  /* readable over any footage without needing a full-frame scrim */
  text-shadow:
    0 0.35cqw 1.6cqw rgba(0, 0, 0, 0.55),
    0 0 0.7cqw rgba(0, 0, 0, 0.35);
  will-change: transform, opacity;
}
/* The spoken-word highlight (${TOKENS.peach}) is applied by GSAP at render
   time, not by a class, so there is no class to declare here. */
`;
}

// ---------------------------------------------------------------- HTML
function buildHtml(phrases, { track }) {
  const lines = phrases.map((p, i) => {
    const spans = p.words
      .map((w, j) => `      <span class="kc-w" id="kc-${i}-${j}">${escapeHtml(w.w)}</span>`)
      .join("\n");
    return `    <div class="clip kc-phrase" id="kc-p${i}" data-start="${p.s}" data-duration="${p.dur}" data-track-index="${track}">
${spans}
    </div>`;
  });
  return `    <!-- kinetic captions: ${phrases.length} phrases (generated) -->\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------- GSAP
// Entrance duration per style, used to detect when a highlight punch would
// collide with the entrance tween on the same property.
const STYLE_DUR = { pop: 0.16, rise: 0.2, punch: 0.14 };

const STYLE_TWEENS = {
  // each word snaps in with a small overshoot — the default "word pop"
  pop: (id, t) =>
    `  tl.fromTo("#${id}", { opacity: 0, scale: 0.62 }, { opacity: 1, scale: 1, duration: 0.16, ease: "back.out(2.6)" }, ${t});`,
  // words slide up into place, calmer, better under a slow VO
  rise: (id, t) =>
    `  tl.fromTo("#${id}", { opacity: 0, yPercent: 42 }, { opacity: 1, yPercent: 0, duration: 0.2, ease: "power3.out" }, ${t});`,
  // hard scale punch, loudest of the three
  punch: (id, t) =>
    `  tl.fromTo("#${id}", { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.14, ease: "power4.out" }, ${t});`,
};

function buildJs(phrases, { style, reveal }) {
  const tween = STYLE_TWEENS[style];
  const out = [];

  out.push(`  /* ── kinetic captions (generated by scripts/kinetic-captions.mjs) ── */`);
  out.push(`  /* style="${style}" reveal="${reveal}", ${phrases.length} phrases.`);
  out.push(`     Add to your existing paused timeline. */`);

  phrases.forEach((p, i) => {
    const pid = `kc-p${i}`;
    out.push(``);
    out.push(`  // phrase ${i}: ${JSON.stringify(p.words.map((w) => w.w).join(" "))}`);
    // The phrase container itself only fades — no transform, so it can never
    // fight the per-word transform tweens.
    out.push(`  tl.set("#${pid}", { opacity: 1 }, ${p.s});`);

    p.words.forEach((w, j) => {
      const wid = `kc-${i}-${j}`;

      if (reveal === "word") {
        // Each word appears at the moment it is spoken. Hidden words still
        // occupy layout, so a part-revealed phrase sits off-centre.
        out.push(tween(wid, w.s));
      } else {
        // reveal="phrase": the whole line lands together, so it is optically
        // centred from the first frame. The spoken word then gets the punch.
        const entranceAt = round(p.s + j * 0.035);
        out.push(tween(wid, entranceAt));

        // Skip the punch if the word is still entering — both drive `scale`,
        // and overlapping tweens on one property fight each other. The
        // entrance already reads as the punch in that case.
        if (w.s >= entranceAt + STYLE_DUR[style]) {
          out.push(
            `  tl.fromTo("#${wid}", { scale: 1 }, { scale: 1.14, duration: 0.1, yoyo: true, repeat: 1, ease: "power2.out" }, ${w.s});`
          );
        }
      }

      // Highlight while the word is being spoken, then drop back to cream.
      // Set `color` directly rather than swapping className: GSAP's className
      // handling rewrites the whole style attribute and would wipe the inline
      // transform this word just got from the pop tween.
      out.push(`  tl.set("#${wid}", { color: "${TOKENS.peach}" }, ${w.s});`);
      out.push(`  tl.set("#${wid}", { color: "${TOKENS.cream}" }, ${w.e});`);
    });

    // hard-kill at the boundary so nothing bleeds into the next phrase
    out.push(`  tl.set("#${pid}", { opacity: 0 }, ${p.out});`);
    p.words.forEach((_, j) => {
      out.push(`  tl.set("#kc-${i}-${j}", { opacity: 0 }, ${p.out});`);
    });
  });

  return out.join("\n");
}

// ---------------------------------------------------------------- demo project
function buildDemo(phrases, opts, css, html, js) {
  const total = round(phrases[phrases.length - 1].out + 0.3);
  const f = FONTS[opts.font];
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  @font-face {
    font-family: "${f.family}";
    src: url("fonts/${f.file}") format("woff2");
    font-weight: ${f.weight};
    font-display: block;
  }
  @font-face {
    font-family: "JetBrains Mono";
    src: url("fonts/jetbrainsmono-500.woff2") format("woff2");
    font-weight: 500;
    font-display: block;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #0e0e0e; }
  #root { container-type: size; }
  video.fill { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #scrim {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(12,11,10,.55) 0%, rgba(12,11,10,.2) 30%,
      rgba(12,11,10,.35) 62%, rgba(12,11,10,.7) 100%);
  }
  #handle {
    position: absolute; left: 0; right: 0; bottom: 7cqh; text-align: center;
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 2.1cqw; letter-spacing: .12em;
    color: #f3ecd9; text-shadow: 0 .2cqw 1cqw rgba(0,0,0,.7);
  }

${css.split("\n").map((l) => (l ? "  " + l : l)).join("\n")}
</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${total}"
       data-width="1080" data-height="1920">

    <video id="v1" class="fill" src="assets/broll.mp4" data-start="0" data-duration="${total}"
           data-track-index="1" data-media-start="0" muted playsinline
           style="object-position:50% 38%"></video>

    <div id="scrim" class="clip" data-start="0" data-duration="${total}" data-track-index="5"></div>

${html}

    <div id="handle" class="clip" data-start="0" data-duration="${total}" data-track-index="90">
      @yourhandle
    </div>
  </div>

<script>
  const tl = gsap.timeline({ paused: true });

  // slow push so the footage never reads as a still
  tl.fromTo("#v1", { scale: 1.0 }, { scale: 1.08, duration: ${total}, ease: "none" }, 0);

${js}

  window.__timelines = { main: tl };
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- main
function main() {
  const opts = parseArgs(process.argv.slice(2));

  const words = loadWords(opts.wordsPath, opts);
  const phrases = groupPhrases(words, opts);

  const css = buildCss(opts);
  const html = buildHtml(phrases, opts);
  const js = buildJs(phrases, opts);

  const last = phrases[phrases.length - 1];
  const summary =
    `kinetic-captions: ${words.length} words -> ${phrases.length} phrases, ` +
    `${phrases[0].s}s to ${last.out}s, style=${opts.style}`;

  if (opts.demo) {
    const dir = path.resolve(opts.demo);
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    const file = path.join(dir, "index.html");
    fs.writeFileSync(file, buildDemo(phrases, opts, css, html, js), "utf8");
    console.error(summary);
    console.error(`demo project written: ${file}`);
    console.error(`drop a vertical clip at ${path.join(dir, "assets", "broll.mp4")} then run: npx hyperframes render`);
    return;
  }

  const block =
    `<!-- ===== CSS: paste inside <style> ===== -->\n${css}\n` +
    `\n<!-- ===== HTML: paste inside #root ===== -->\n${html}\n` +
    `\n/* ===== JS: paste into your timeline block ===== */\n${js}\n`;

  if (opts.out) {
    fs.writeFileSync(path.resolve(opts.out), block, "utf8");
    console.error(summary);
    console.error(`written: ${opts.out}`);
  } else {
    console.error(summary);
    process.stdout.write(block);
  }
}

main();
