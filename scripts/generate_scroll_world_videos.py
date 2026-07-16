"""Generate Northline's seam-safe scroll-world chain with the local Gradio app.

Every leg starts from the exact decoded final frame of the prior rendered leg.
Destination stills are intentionally not passed to the video model: the prompt
drives one physical journey instead of morphing between unrelated compositions.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
import os
from pathlib import Path

from gradio_client import Client, handle_file


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get("NORTHLINE_VIDEO_WORK", ROOT / "output" / "scroll-world-generation"))
LANDING = ROOT / "apps" / "web-portal" / "public" / "landing"
INITIAL_FRAME = LANDING / "northline-hero.webp"
SEED = int(os.environ.get("NORTHLINE_VIDEO_SEED", "424242"))
WIDTH = int(os.environ.get("NORTHLINE_VIDEO_WIDTH", "768"))
HEIGHT = int(os.environ.get("NORTHLINE_VIDEO_HEIGHT", "448"))
DURATION = float(os.environ.get("NORTHLINE_VIDEO_DURATION", "3"))

STYLE = (
    " Preserve the exact same lead vessel, crew, North Atlantic blue-hour weather, "
    "deep navy and cold silver grade, restrained teal instrument light, realistic scale, "
    "natural anatomy, physically plausible maritime equipment, and high-end editorial "
    "documentary cinematography. Smooth graceful motion, coherent geometry, subtle "
    "parallax, no cuts, no time jump, no weather change, no object duplication, no text, "
    "no captions, no logos."
)

LEGS = [
    (
        "01-approach",
        "Single continuous cinematic camera move. Continue a slow, steady forward glide "
        "in one straight line directly toward the bow of the lead commercial fishing vessel. "
        "Lock the vessel's bow to the center of frame with zero orbit, zero lateral tracking, "
        "zero pullback, and zero zoom-out. The vessel must grow steadily larger throughout as "
        "the camera closes the distance. Advance over the centered bow toward the illuminated bridge. "
        "In the final second, settle into the same slow forward glide toward the working deck."
        + STYLE
        + " Add restrained ocean, wind, and diesel ambience.",
    ),
    (
        "02-deck",
        "Single continuous cinematic camera move. Continue the exact same slow, steady "
        "forward glide from the previous frame, crossing the bow and moving low along the "
        "working deck of the same vessel. Pass credible gear and a small competent crew in "
        "correct protective equipment preparing for the next operation. In the final second, "
        "settle into the same slow forward glide toward a lit watertight bridge doorway."
        + STYLE
        + " Add subtle deck, rope, engine, wind, and water ambience.",
    ),
    (
        "03-bridge",
        "Single continuous cinematic camera move. Continue the exact same slow, steady "
        "forward glide through the lit watertight doorway into the bridge of the same vessel. "
        "Move past plausible navigation instruments toward a calm operator using a rugged "
        "offline operations tablet while the sea remains visible through the windows. In the "
        "final second, settle into the same slow forward glide toward the chart and closeout station."
        + STYLE
        + " Add quiet wheelhouse room tone, radio texture, engine hum, and distant water.",
    ),
    (
        "04-closeout",
        "Single continuous cinematic camera move. Continue the exact same slow, steady "
        "forward glide inside the bridge. Immediately reveal one calm crew lead at a dedicated "
        "closeout desk on the right, completing a premium digital compliance workflow on a rugged "
        "tablet: verifying readiness, signing the trip record, and confirming the catch lot without "
        "readable interface text. Track slowly past the desk and remain inside this bridge workspace; "
        "do not exit to the deck, do not show an empty room, and do not remove the operator. In the "
        "final second, settle into the same slow forward glide toward the lit exterior doorway."
        + STYLE
        + " Add restrained device, refrigeration, harbor, and working-vessel ambience.",
    ),
    (
        "05-landing",
        "Single continuous cinematic camera move. Continue the exact same slow, steady "
        "forward glide through the lit doorway as the same vessel arrives at an orderly dockside "
        "landing at first light. Follow one sealed catch container from the vessel to two properly "
        "equipped dock workers performing a credible handheld digital lot scan and clean cold-chain "
        "handoff. Keep the workers and container visible as the camera tracks low beside them, then "
        "rise slightly toward the harbor horizon. In the final second, settle into a calm, resolved "
        "slow forward glide toward the first pale light beyond the working port."
        + STYLE
        + " Add subtle harbor water, refrigeration, gull, and quiet logistics ambience.",
    ),
]

LEG_LIMIT = int(os.environ.get("NORTHLINE_VIDEO_LEG_LIMIT", str(len(LEGS))))


def extract_last(video: Path, output: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-sseof", "-0.05", "-i", str(video),
         "-frames:v", "1", "-q:v", "2", str(output)],
        check=True,
    )


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    client = Client("http://127.0.0.1:7861")
    previous_frame = INITIAL_FRAME

    for slug, prompt in LEGS[:LEG_LIMIT]:
        raw = WORK / f"{slug}-raw.mp4"
        last = WORK / f"{slug}-last.png"
        if raw.exists():
            print(f"SKIP {raw.name} (already generated)", flush=True)
        else:
            started = time.monotonic()
            print(f"START {slug} from {previous_frame.name}", flush=True)
            result = client.predict(
                input_image=handle_file(previous_frame),
                prompt=prompt,
                duration=DURATION,
                enhance_prompt=False,
                seed=SEED,
                randomize_seed=False,
                height=HEIGHT,
                width=WIDTH,
                api_name="/generate_video",
            )
            if not result or not result[0]:
                raise RuntimeError(
                    f"Local video generator returned no file for {slug} at {WIDTH}x{HEIGHT}. "
                    "The requested frame size likely exceeds the deployment's native generation ceiling."
                )
            shutil.copy2(Path(result[0]), raw)
            print(
                f"DONE {slug} {time.monotonic() - started:.1f}s seed={result[1]}",
                flush=True,
            )
        extract_last(raw, last)
        previous_frame = last

    print("CHAIN COMPLETE", flush=True)


if __name__ == "__main__":
    main()
