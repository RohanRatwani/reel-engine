"""Word-level transcription, locally, for free.

Gives you [{w, s, e}, ...] — one entry per word with start and end seconds.
That timing is what lets captions land on the exact word and lets animation be
retimed to a real delivery instead of a guessed rhythm.

    pip install faster-whisper
    python transcribe.py audio.wav words.json

Feed it a WAV, not an MP4. PyAV chokes on some MP4 audio and the error it gives
you is unhelpful. Convert first:

    ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 audio.wav

Model size: "small.en" on CPU int8 is the sweet spot — about 20 seconds of work
for a 60 second clip, and accurate enough that you rarely fix a word. Set
WHISPER_MODEL to change it ("tiny.en" is faster, "medium.en" is better).
"""

import json
import os
import sys

from faster_whisper import WhisperModel

if len(sys.argv) < 3:
    sys.exit("usage: python transcribe.py <audio.wav> <out.json>")

model_name = os.environ.get("WHISPER_MODEL", "small.en")
device = os.environ.get("WHISPER_DEVICE", "cpu")
compute = os.environ.get("WHISPER_COMPUTE", "int8")

model = WhisperModel(model_name, device=device, compute_type=compute)
segments, _info = model.transcribe(sys.argv[1], word_timestamps=True)

words = []
for seg in segments:
    for w in seg.words or []:
        words.append({"w": w.word, "s": round(w.start, 2), "e": round(w.end, 2)})

with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(words, f, indent=0)

print(f"{len(words)} words -> {sys.argv[2]}")
print(" ".join(f'[{x["s"]}]{x["w"]}' for x in words))
