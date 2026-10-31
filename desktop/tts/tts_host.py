"""tts_host.py — hôte de synthèse vocale pour l'overlay Sarra.

Electron (Chromium) ne fournit aucune voix à `speechSynthesis`. Cet hôte tourne
en Python + PyQt6 (QTextToSpeech, voix Windows) et dialogue avec Electron.

Deux transports :
  * TCP 127.0.0.1:<port> — lancé par start.bat avant Electron (recommandé) ;
  * stdin/stdout — repli quand l'application est lancée directement.

Protocole (lignes UTF-8, champs séparés par des tabulations) :
    SPEAK <id> <rate> <volume> <voice-b64> <text-b64>
    STOP
    VOICES
Réponses :
    START <id> | BOUNDARY <id> <start> <length> <word-b64>
    END <id> | ERROR <id> <message-b64>
    VOICES <name-b64>|<lang-b64>;<...>
"""

from __future__ import annotations

import base64
import os
import queue
import socket
import sys
import threading

from PyQt6.QtCore import QCoreApplication, QTimer
from PyQt6.QtTextToSpeech import QTextToSpeech

PORT = 0
LOG_PATH = ""
ARGS = sys.argv[1:]
for index, arg in enumerate(ARGS):
    if arg == "--port" and index + 1 < len(ARGS):
        try:
            PORT = int(ARGS[index + 1])
        except ValueError:
            PORT = 0
    elif arg == "--log" and index + 1 < len(ARGS):
        LOG_PATH = ARGS[index + 1]


def log(message: str) -> None:
    line = f"{message}\n"
    if LOG_PATH:
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as handle:
                handle.write(line)
        except OSError:
            pass
    try:
        sys.stderr.write(line)
        sys.stderr.flush()
    except Exception:
        pass


APP = QCoreApplication([sys.argv[0]])
ENGINE = os.environ.get("SARRA_TTS_ENGINE", "").strip()
MUTE = os.environ.get("SARRA_TTS_MUTE", "") == "1"
TTS = QTextToSpeech(ENGINE) if ENGINE else QTextToSpeech()
CLIENT: socket.socket | None = None
CLIENT_LOCK = threading.Lock()
QUEUE: queue.Queue[str] = queue.Queue()
WRITE_QUEUE: queue.Queue[str | None] = queue.Queue()
SPEAKING_ID: int | None = None
EOF = False


def b64(text: str) -> str:
    return base64.b64encode((text or "").encode("utf-8")).decode("ascii")


def unb64(text: str) -> str:
    try:
        return base64.b64decode(text or "").decode("utf-8")
    except Exception:
        return ""


def emit(line: str) -> None:
    WRITE_QUEUE.put(line)


def _writer_loop() -> None:
    while True:
        line = WRITE_QUEUE.get()
        if line is None:
            return

        with CLIENT_LOCK:
            client = CLIENT
        if client is not None:
            try:
                client.sendall((line + "\n").encode("utf-8"))
                continue
            except OSError as exc:
                log(f"[diag] socket write failed: {exc}")

        try:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
        except OSError as exc:
            log(f"[diag] stdout write failed: {exc}")


def emit_error(job_id: int, message: str) -> None:
    emit(f"ERROR\t{job_id}\t{b64(message)}")


def voices_now():
    try:
        return TTS.availableVoices()
    except Exception:
        return []


def select_voice(name: str) -> None:
    voices = voices_now()
    for voice in voices:
        if voice.name() == name:
            TTS.setVoice(voice)
            return
    for candidate in voices:
        if candidate.locale().name().lower().startswith("fr"):
            TTS.setVoice(candidate)
            return


def on_state(state: QTextToSpeech.State) -> None:
    global SPEAKING_ID
    if state == QTextToSpeech.State.Speaking:
        return
    if state == QTextToSpeech.State.Ready and SPEAKING_ID is not None:
        job_id = SPEAKING_ID
        SPEAKING_ID = None
        emit(f"END\t{job_id}")
    elif state == QTextToSpeech.State.Error and SPEAKING_ID is not None:
        job_id = SPEAKING_ID
        SPEAKING_ID = None
        emit_error(job_id, "synthèse vocale en erreur")
        emit(f"END\t{job_id}")


def on_error(_error: QTextToSpeech.Error, message: str) -> None:
    log(f"[diag] erreur moteur {_error} : {message}")
    if SPEAKING_ID is not None:
        emit_error(SPEAKING_ID, message or "erreur de synthèse")


def on_saying_word(word: str, _text_id: int, start: int, length: int) -> None:
    if SPEAKING_ID is not None and TTS.state() == QTextToSpeech.State.Speaking:
        emit(f"BOUNDARY\t{SPEAKING_ID}\t{start}\t{length}\t{b64(word)}")


TTS.stateChanged.connect(on_state)
TTS.errorOccurred.connect(on_error)
TTS.sayingWord.connect(on_saying_word)


def handle_speak(parts: list[str]) -> None:
    global SPEAKING_ID
    job_id = int(parts[1])
    rate = float(parts[2])
    volume = float(parts[3])
    voice = unb64(parts[4]) if len(parts) > 4 else ""
    text = unb64(parts[5]) if len(parts) > 5 else ""

    if SPEAKING_ID is not None:
        previous = SPEAKING_ID
        SPEAKING_ID = None
        TTS.stop()
        emit(f"END\t{previous}")

    select_voice(voice)
    TTS.setRate(max(-1.0, min(1.0, (rate - 1.0) * 1.5)))
    TTS.setVolume(0.0 if MUTE else max(0.0, min(1.0, volume)))
    if not text.strip():
        emit(f"START\t{job_id}")
        emit(f"END\t{job_id}")
        return

    SPEAKING_ID = job_id
    log(f"[diag] SPEAK {job_id} voice={voice or '(défaut)'} rate={rate} volume={volume} len={len(text)}")
    emit(f"START\t{job_id}")
    TTS.say(text)


def handle_voices() -> None:
    current = voices_now()
    log(
        f"[diag] exe={sys.executable} state={TTS.state()} voices={len(current)} "
        f"locale={TTS.locale().name()} engine={TTS.engine()}"
    )
    items = []
    for voice in current:
        items.append(f"{b64(voice.name())}|{b64(voice.locale().name())}")
    emit("VOICES\t" + ";".join(items))


def drain() -> None:
    while True:
        try:
            line = QUEUE.get_nowait()
        except queue.Empty:
            return
        if not line:
            continue
        parts = line.split("\t")
        try:
            if parts[0] == "SPEAK" and len(parts) >= 4:
                handle_speak(parts)
            elif parts[0] == "STOP":
                global SPEAKING_ID
                if SPEAKING_ID is not None:
                    job_id = SPEAKING_ID
                    SPEAKING_ID = None
                    TTS.stop()
                    emit(f"END\t{job_id}")
            elif parts[0] == "VOICES":
                handle_voices()
        except Exception as exc:  # noqa: BLE001 — l'hôte ne doit jamais mourir
            emit_error(int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else -1, str(exc))


def read_stream(stream) -> None:
    global EOF
    try:
        for raw in stream:
            QUEUE.put(raw.decode("utf-8", "replace").rstrip("\r\n"))
    except Exception:
        pass
    EOF = True


def tcp_server() -> None:
    global CLIENT, EOF
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", PORT))
        server.listen(1)
        log(f"[diag] TCP 127.0.0.1:{PORT} en écoute")
    except OSError as exc:
        log(f"[diag] TCP indisponible: {exc}")
        EOF = True
        return
    while True:
        conn, _address = server.accept()
        with CLIENT_LOCK:
            CLIENT = conn
        log("[diag] client connecté")
        buffer = b""
        try:
            while True:
                data = conn.recv(4096)
                if not data:
                    break
                buffer += data
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    QUEUE.put(line.decode("utf-8", "replace").rstrip("\r"))
        except OSError:
            pass
        finally:
            with CLIENT_LOCK:
                CLIENT = None
            try:
                conn.close()
            except OSError:
                pass
            log("[diag] client déconnecté")
            EOF = True
        break


if PORT:
    threading.Thread(target=tcp_server, daemon=True).start()
    # Aucun client après 45 s : l'overlay n'a pas démarré, on s'arrête.
    QTimer.singleShot(45000, lambda: APP.quit() if CLIENT is None else None)
else:
    threading.Thread(target=read_stream, args=(sys.stdin.buffer,), daemon=True).start()

WRITER_THREAD = threading.Thread(target=_writer_loop, daemon=True, name="TTS-Writer")
WRITER_THREAD.start()

POLL = QTimer()
POLL.timeout.connect(drain)
POLL.start(40)

# Quitte quand Electron a disparu (socket/pipe fermé).
EOF_TIMER = QTimer()
EOF_TIMER.timeout.connect(lambda: APP.quit() if EOF and QUEUE.empty() else None)
EOF_TIMER.start(250)

select_voice("")
APP.exec()
WRITE_QUEUE.put(None)
WRITER_THREAD.join(timeout=1)
