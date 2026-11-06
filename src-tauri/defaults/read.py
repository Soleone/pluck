# /// script
# requires-python = ">=3.12"
# dependencies = ["kokoro-onnx>=0.4", "sounddevice", "edge-tts", "miniaudio"]
# ///
"""Reads the text on stdin aloud, starting once the first few sentences are ready. Its card at the
bottom of the screen stops it.

Settings come from the action's env in pluck.toml:
  ENGINE  "kokoro" (local, the default) or "edge" (Microsoft's online voices, needs internet)
  VOICE   a Kokoro voice like "af_heart", or an Edge voice like "en-US-AvaMultilingualNeural"
  SPEED   1.0 is normal
"""

import asyncio
import hashlib
import os
import queue
import re
import sys
import threading
import urllib.request
from pathlib import Path

import numpy as np
import sounddevice

RATE = 24_000
CHUNK = 300
MODEL_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".cache") / "pluck" / "kokoro"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def main():
    text = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    engine = os.environ.get("ENGINE", "kokoro")
    speed = float(os.environ.get("SPEED", "1.0"))
    if engine == "kokoro":
        speak = kokoro(os.environ.get("VOICE", "af_heart"), speed)
    elif engine == "edge":
        speak = edge(os.environ.get("VOICE", "en-US-AvaMultilingualNeural"), speed)
    else:
        raise ValueError(f'ENGINE is "{engine}", but it can only be "kokoro" or "edge"')
    play(speak, chunks(text))


def chunks(text):
    """Groups sentences into pieces of about CHUNK characters, so the first one is ready fast."""
    chunk = ""
    for sentence in re.split(r"(?<=[.!?…])\s+|\n\s*\n", text):
        chunk = f"{chunk} {sentence.strip()}".strip()
        if len(chunk) >= CHUNK:
            yield chunk
            chunk = ""
    if chunk:
        yield chunk


def play(speak, pieces):
    """Speaks the next piece while the current one plays, a few pieces ahead at most."""
    ready = queue.Queue(maxsize=3)

    def produce():
        try:
            for piece in pieces:
                ready.put(speak(piece))
        except Exception as error:
            ready.put(error)
        ready.put(None)

    threading.Thread(target=produce, daemon=True).start()
    with sounddevice.OutputStream(samplerate=RATE, channels=1, dtype="float32") as stream:
        while (audio := ready.get()) is not None:
            if isinstance(audio, Exception):
                raise audio
            stream.write(audio.reshape(-1, 1))


def kokoro(voice, speed):
    from kokoro_onnx import Kokoro

    model = Kokoro(*(str(download(name, digest)) for name, digest in MODEL_FILES.items()))
    lang = "en-gb" if voice.startswith("b") else "en-us"

    def speak(text):
        samples, rate = model.create(text, voice=voice, speed=speed, lang=lang)
        assert rate == RATE
        return samples.astype(np.float32)

    return speak


def download(name, digest):
    """Fetches a model file once and keeps it in MODEL_DIR."""
    path = MODEL_DIR / name
    if path.exists():
        return path
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".partial")
    urllib.request.urlretrieve(MODEL_URL + name, partial)
    if hashlib.sha256(partial.read_bytes()).hexdigest() != digest:
        partial.unlink()
        raise RuntimeError(f"The download of {name} is damaged, try again")
    partial.replace(path)
    return path


def edge(voice, speed):
    import edge_tts
    import miniaudio

    rate = f"{round((speed - 1) * 100):+d}%"

    async def mp3(text):
        stream = edge_tts.Communicate(text, voice, rate=rate).stream()
        return b"".join([part["data"] async for part in stream if part["type"] == "audio"])

    def speak(text):
        decoded = miniaudio.decode(asyncio.run(mp3(text)), nchannels=1, sample_rate=RATE)
        return np.array(decoded.samples, dtype=np.float32) / 32768

    return speak


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.exit(str(error))
