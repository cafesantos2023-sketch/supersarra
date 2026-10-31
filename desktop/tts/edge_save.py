"""Génère un MP3 et les repères temporels des mots avec Edge TTS.

Utilisé par le processus principal Electron pour éviter les soucis de la CLI
`python -m edge_tts` (barre de progression / bug `audio_file` quand le service
renvoie une erreur). Arguments : texte, voix, fichier audio, fichier des repères.
"""

import asyncio
import json
import sys

import edge_tts


async def main() -> None:
    text = sys.argv[1] if len(sys.argv) > 1 else ""
    voice = sys.argv[2] if len(sys.argv) > 2 else "fr-FR-DeniseNeural"
    output = sys.argv[3] if len(sys.argv) > 3 else "sarra-edge.mp3"
    alignment_path = sys.argv[4] if len(sys.argv) > 4 else ""
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    alignment = []
    with open(output, "wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                alignment.append({
                    "text": chunk.get("text", ""),
                    "start": max(0.0, float(chunk.get("offset", 0)) / 10_000_000),
                    "duration": max(0.0, float(chunk.get("duration", 0)) / 10_000_000),
                })
    if alignment_path:
        with open(alignment_path, "w", encoding="utf-8") as metadata:
            json.dump(alignment, metadata, ensure_ascii=False)


if __name__ == "__main__":
    asyncio.run(main())
