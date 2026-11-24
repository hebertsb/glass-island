"""Demonio persistente de voz en español para GlassIsland (Subu).

Combina dos motores en un solo proceso liviano:
1. Escucha continua real del micrófono de la laptop con VAD (calibración de ruido
   + espera a que termines tu frase sin cortarte) y transcripción en español
   (`es-BO` / `es-ES`). Emite eventos JSON `{"event":"heard","text":"..."}` por stdout.
2. Síntesis de voz neural fluida en español latino (`edge-tts`, voz por defecto
   `es-BO-SofiaNeural`, idéntica a una locución fluida natural) devolviendo
   audio MP3 en base64 para reproducción instantánea en Electron.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import re
import sys
import threading
import time
import wave

import edge_tts
import numpy as np
import sounddevice as sd
import speech_recognition as sr

SAMPLE_RATE = 16000
BLOCK_MS = 100
BLOCK_SIZE = int(SAMPLE_RATE * BLOCK_MS / 1000)

_stdout_lock = threading.Lock()
_state_lock = threading.Lock()
_listen_enabled = True
_muted_for_tts_until = 0.0
_voice_name = "es-BO-SofiaNeural"
_use_whisper = False
_whisper_model = None
_whisper_loading = False


def _ensure_whisper_async() -> None:
    global _whisper_model, _whisper_loading
    if _whisper_model is not None or _whisper_loading:
        return
    _whisper_loading = True

    def _loader() -> None:
        global _whisper_model, _whisper_loading
        try:
            from faster_whisper import WhisperModel  # type: ignore

            try:
                # Intenta GPU NVIDIA (RTX 5050) con large-v3-turbo en int8_float16 (~1.6 GB VRAM)
                _whisper_model = WhisperModel(
                    "large-v3-turbo", device="cuda", compute_type="int8_float16"
                )
                emit({"event": "whisper_ready", "device": "cuda", "model": "large-v3-turbo"})
            except Exception:
                # Fallback liviano en CPU (0% GPU)
                _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
                emit({"event": "whisper_ready", "device": "cpu", "model": "small"})
        except Exception as exc:
            emit({"event": "whisper_error", "message": str(exc)})
        finally:
            _whisper_loading = False

    threading.Thread(target=_loader, daemon=True).start()


def emit(obj: dict) -> None:
    # ensure_ascii=True garantiza UTF-8 limpio sin caracteres rotos (msica) en pipes de Windows
    line = json.dumps(obj, ensure_ascii=True)
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


_EN_PHONETICS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bfirestone\b", re.I), "fáierstoun"),
    (re.compile(r"\byoutube\s+music\b", re.I), "yutúb miúsic"),
    (re.compile(r"\byoutube\b", re.I), "yutúb"),
    (re.compile(r"\bspotify\b", re.I), "espótifai"),
    (re.compile(r"\baccuweather\b", re.I), "ákiu wéder"),
    (re.compile(r"\bvisual\s+studio\s+code\b", re.I), "víshual stúdio cóud"),
    (re.compile(r"\bvs\s*code\b", re.I), "vi es cóud"),
    (re.compile(r"\bgithub\b", re.I), "guítjab"),
    (re.compile(r"\bwhatsapp\b", re.I), "guátsap"),
    (re.compile(r"\benterprise\s+architect\b", re.I), "énterprais árquitect"),
    (re.compile(r"\bclaude\b", re.I), "clod"),
    (re.compile(r"\bcopilot\b", re.I), "copáilot"),
    (re.compile(r"\bchatgpt\b", re.I), "chat ye pe te"),
    (re.compile(r"\bdocker\b", re.I), "dóker"),
    (re.compile(r"\bscreenshot\b", re.I), "escrínshot"),
    (re.compile(r"\bfocus\b", re.I), "fóucus"),
    (re.compile(r"\bfrutiger\s+aero\b", re.I), "frútiguer áero"),
    (re.compile(r"\bliquid\s+glass\b", re.I), "lícuid glas"),
]


def _prepare_tts_text(text: str, voice: str) -> str:
    # Las voces MultilingualNeural pronuncian inglés y español nativamente solas
    if "Multilingual" in voice:
        return text
    out = text
    for pat, repl in _EN_PHONETICS:
        out = pat.sub(repl, out)
    return out


async def _synth_mp3_b64(text: str, voice: str) -> str:
    spoken = _prepare_tts_text(text, voice)
    communicate = edge_tts.Communicate(spoken, voice=voice, rate="+6%")
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    raw = buf.getvalue()
    if not raw:
        return ""
    return "data:audio/mpeg;base64," + base64.b64encode(raw).decode("ascii")


def _pcm_to_audio_data(pcm_int16: np.ndarray) -> sr.AudioData:
    wav_buf = io.BytesIO()
    with wave.open(wav_buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_int16.tobytes())
    return sr.AudioData(pcm_int16.tobytes(), SAMPLE_RATE, 2)


def _listen_loop() -> None:
    global _muted_for_tts_until
    recognizer = sr.Recognizer()
    # Calibración inicial rápida del piso de ruido ambiental (0.6 s)
    noise_floor = 0.012
    try:
        cal = sd.rec(
            int(SAMPLE_RATE * 0.6),
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
        )
        sd.wait()
        rms = float(np.sqrt(np.mean(cal**2)))
        noise_floor = max(0.010, min(0.06, rms * 2.4))
    except Exception:
        pass

    emit({"event": "ready", "noise_floor": round(noise_floor, 4)})

    speech_chunks: list[np.ndarray] = []
    pre_buffer: list[np.ndarray] = []
    speaking = False
    silence_blocks = 0
    max_blocks = 95  # hasta 9.5 segundos por frase

    def callback(indata, frames, time_info, status):  # noqa: ARG001
        nonlocal speaking, silence_blocks, speech_chunks, pre_buffer, noise_floor
        now = time.monotonic()
        with _state_lock:
            enabled = _listen_enabled
            muted_until = _muted_for_tts_until
        if not enabled or now < muted_until:
            speaking = False
            speech_chunks = []
            silence_blocks = 0
            return

        chunk = indata[:, 0].copy()
        rms = float(np.sqrt(np.mean(chunk**2)))

        if not speaking:
            pre_buffer.append(chunk)
            if len(pre_buffer) > 4:
                pre_buffer.pop(0)
            if rms > noise_floor * 1.45:
                speaking = True
                silence_blocks = 0
                speech_chunks = list(pre_buffer)
                emit({"event": "vad", "active": True})
            else:
                # Ajuste adaptativo muy lento al ruido de fondo
                noise_floor = noise_floor * 0.992 + max(0.008, rms * 2.1) * 0.008
        else:
            speech_chunks.append(chunk)
            if rms < noise_floor * 1.1:
                silence_blocks += 1
            else:
                silence_blocks = 0

            # Termina la frase tras 1.5s de silencio (deja pensar entre palabras sin cortar)
            if silence_blocks >= 15 or len(speech_chunks) >= max_blocks:
                captured = np.concatenate(speech_chunks)
                speaking = False
                speech_chunks = []
                silence_blocks = 0
                emit({"event": "vad", "active": False})
                if len(captured) >= int(SAMPLE_RATE * 0.45):
                    threading.Thread(
                        target=_transcribe_async,
                        args=(recognizer, captured),
                        daemon=True,
                    ).start()

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            blocksize=BLOCK_SIZE,
            dtype="float32",
            callback=callback,
        ):
            while True:
                time.sleep(0.25)
    except Exception as exc:
        emit({"event": "error", "message": str(exc)})


def _transcribe_async(recognizer: sr.Recognizer, audio_f32: np.ndarray) -> None:
    try:
        with _state_lock:
            want_whisper = _use_whisper
        if want_whisper and _whisper_model is not None:
            segments, _ = _whisper_model.transcribe(
                audio_f32,
                language="es",
                beam_size=1,
                vad_filter=False,
                initial_prompt="Nova, Copilot, Claude, Visual Studio Code, YouTube, Firestone, Santa Cruz, Bolivia.",
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
            if text:
                emit({"event": "heard", "text": text, "engine": "whisper"})
                return
        pcm = np.clip(audio_f32 * 32767.0, -32768, 32767).astype(np.int16)
        audio_data = _pcm_to_audio_data(pcm)
        text = recognizer.recognize_google(audio_data, language="es-BO")
        if text and text.strip():
            emit({"event": "heard", "text": text.strip(), "engine": "google"})
    except sr.UnknownValueError:
        pass
    except Exception:
        pass


def _stdin_loop() -> None:
    global _listen_enabled, _muted_for_tts_until, _voice_name
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        cmd = req.get("cmd")
        req_id = req.get("id", 0)

        if cmd == "set_listen":
            with _state_lock:
                _listen_enabled = bool(req.get("enabled", True))
            emit({"id": req_id, "data": {"ok": True, "enabled": _listen_enabled}})
        elif cmd == "set_engine":
            want = bool(req.get("whisper", False))
            with _state_lock:
                _use_whisper = want
            if want:
                _ensure_whisper_async()
            emit({"id": req_id, "data": {"ok": True, "whisper": _use_whisper}})
        elif cmd == "mute_for":
            secs = float(req.get("seconds", 3.0))
            with _state_lock:
                _muted_for_tts_until = max(_muted_for_tts_until, time.monotonic() + secs)
            emit({"id": req_id, "data": {"ok": True}})
        elif cmd == "speak":
            text = str(req.get("text", "")).strip()
            voice = str(req.get("voice") or _voice_name)
            _voice_name = voice
            audio_b64 = ""
            if text:
                with _state_lock:
                    _muted_for_tts_until = time.monotonic() + max(2.2, len(text) * 0.075)
                try:
                    audio_b64 = loop.run_until_complete(_synth_mp3_b64(text, voice))
                except Exception:
                    audio_b64 = ""
            emit({"id": req_id, "data": {"audio": audio_b64, "voice": voice}})
        elif cmd == "quit":
            break


def main() -> None:
    t = threading.Thread(target=_listen_loop, daemon=True)
    t.start()
    _stdin_loop()


if __name__ == "__main__":
    main()
