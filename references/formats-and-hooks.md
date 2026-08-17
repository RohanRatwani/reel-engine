# What to make, and how to open it

The tools are the easy part. Picking the wrong thing to make is what wastes a week.

---

## The hook rule that matters most

**Write the hook as the viewer's own sentence, in quotes.**

```
"I want to start sending cold emails for my company, but don't know how"
"I want better answers from AI, but I don't know what I'm doing wrong"
```

It is not a claim about your topic and not a promise to teach. It is a thought the
viewer has already had. Someone who has had it is already watching; someone who
has not was never your audience, and losing them in the first second is fine.

**What does not work:** `"6 things to stop doing"`. That is a table of contents.
So is `"Give me 45 seconds and you'll understand X"` — that is a hook for a
lecture, and it asks for patience before giving anything.

**Hook shapes that do work.** All of them are things that HAPPENED:

| shape | example |
|---|---|
| an event | "AWS couldn't find itself." |
| a confession | "I've been vibe coding for months now..." |
| a number with a problem attached | "23,000 photos. Can't delete them manually." |
| a contrarian read on hype | "Everyone's hyping Agent Builder like..." |
| the viewer's own sentence | "I want X but I don't know how" |

**The test:** can your hook start with **"I"** or **"X just happened"**? If it can
only start with **"Here's what X is"**, it is an encyclopedia entry. Rewrite it or
drop the topic. A concept explainer competes with a Google snippet and loses.

**Show the hook on frame 0.** Do not fade it in. On a 7 second reel a half-second
fade spends 7% of the whole thing unreadable, inside the exact window where the
scroll decision happens. And make sure it is a **complete sentence** immediately —
animating the last word in leaves a dangling fragment on screen, which reads as
broken rather than suspenseful.

---

## Format D — one clip, one line, detail in the caption

6 to 8 seconds. One hook, one chip, one CTA. All the real content in the caption.

A short clip read alongside a long caption gets looped many times over, which
reads as very high retention. A 20 second multi-card video has a drop-off point
every few seconds and caps at 100%.

**Route here when the payload is reference material**: file paths, config keys,
tool names, steps. Nobody absorbs a file path at 3 seconds a card. That content is
caption-shaped.

Template: `templates/format-d/`

## Format E — the red/green list

4 to 6 `don't do this / do this instead` pairs. The most shareable structure in
this space, because the finished frame is a checklist and **people forward
checklists** — it makes the sender look useful to a friend. Nobody forwards your
autobiography.

**Build it as an accumulating two-column list where unreached rows are solid
colour bars** that resolve into words on their beat. Being able to *count* how
many answers are still hidden holds attention better than a progress bar, and the
final state is the complete list, so you never need a separate recap frame.

Showing one pair at a time and replacing it is the weaker variant.

Rules: one line per side, 8 words max. Red muted and smaller, green full contrast —
it must lose the contrast fight on purpose. Red enters first, green lands the beat
after; **the gap between them is the content.** If both appear together there is no
contrast to read, just two lines of text.

Template: `templates/format-e/`

## Talking head

The format nothing beats for follows, and the one people avoid because it feels
harder. It is not harder, it is just uncomfortable.

Graphics layered over footage of someone quietly working has no energy to amplify.
No amount of editing fixes that. What the good accounts have is not better editing,
it is a person **close to the lens, talking with their hands**.

- phone at arm's length, chest-up, not across the room
- look into the lens, not at your screen
- gesture; count on your fingers
- slightly faster and louder than feels natural
- re-frame between takes so your cuts have somewhere to go
- fumble a line, pause, say it again, keep rolling — the trim is free

Skip the wardrobe and lighting anxiety. The accounts you are comparing yourself to
are shot in a bedroom with a lamp.

---

## Voiceover, if you add one

Build the reel silent first, then record, then **retime the animation to the
delivery** — never the other way round. Forcing your voice to hit pre-set marks is
why VO sounds rushed.

Budget about **2.3 words per second**, not 3. A 62-word script for a 19 second
video came out sounding panicked; 19 seconds is closer to 42 words. Leave roughly a
second between lines and let the animation carry the gaps.

Pipeline: silent render → record → `transcribe.py` for word timings →
`vo-clean.mjs` for loudness → move the beat arrays onto the real onsets → mux →
re-render.

**A VO reel gets no trending audio.** The voice and the music compete and both
lose. If you want a music bed, mix it quiet under the voice at render time.

---

## Two things worth knowing about CTAs

**One primary action per reel**, matched to what the reel is:

- reference / list / red-green → **save**
- opinion / story / relatable → **share**
- a genuine downloadable behind it → **comment trigger**

**Do not put a comment trigger on every reel.** It reads as a funnel and burns the
goodwill that makes it work. Cap it at one or two a week, and never use one unless
a real resource exists to send — a trigger with nothing behind it is worse than no
CTA at all.

Every reel can still end on a plain follow line. That is baseline, not the ask.
