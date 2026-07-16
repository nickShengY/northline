"""Render reference-guided candidates for the last two Northline story beats."""

from __future__ import annotations

import shutil
import subprocess
import sys
import os
from pathlib import Path

from gradio_client import Client, handle_file


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get("NORTHLINE_VIDEO_WORK", ROOT / "output" / "scroll-world-generation"))
LANDING = ROOT / "apps" / "web-portal" / "public" / "landing"
CLIENT = Client("http://127.0.0.1:7861")
WIDTH = int(os.environ.get("NORTHLINE_VIDEO_WIDTH", "768"))
HEIGHT = int(os.environ.get("NORTHLINE_VIDEO_HEIGHT", "448"))


def last_frame(video: Path, image: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-sseof", "-0.05", "-i", str(video),
         "-frames:v", "1", "-q:v", "2", str(image)],
        check=True,
    )


def render(primary: Path, reference: Path, output: Path, prompt: str, strength: str) -> None:
    result = CLIENT.predict(
        input_image=handle_file(primary),
        reference_images=[handle_file(reference)],
        reference_frame_indices="0,64",
        reference_strengths=f"1.0,{strength}",
        prompt=prompt,
        duration=3,
        enhance_prompt=False,
        seed=424242,
        randomize_seed=False,
        height=HEIGHT,
        width=WIDTH,
        api_name="/generate_video_with_refs",
    )
    if not result or not result[0]:
        raise RuntimeError(
            f"Local video generator returned no file at {WIDTH}x{HEIGHT}. "
            "The requested frame size likely exceeds the deployment's native generation ceiling."
        )
    shutil.copy2(Path(result[0]), output)


render(
    WORK / "03-bridge-last.png",
    LANDING / "northline-compliance.webp",
    WORK / "04-closeout-candidate.mp4",
    "Single continuous cinematic camera move, no cuts. Continue the exact same slow, steady forward glide through the same vessel bridge toward a credible closeout station. Ease beside one crew lead completing a digital trip closeout on a rugged tablet, verifying readiness and a catch lot without readable screen text. Keep the same vessel, blue-hour weather, navy and cold-silver grade, realistic maritime equipment, natural anatomy, and premium documentary finish. In the final second settle back into the same slow forward glide toward a lit exterior doorway. No pullback, no time jump, no duplicated people, no text, no captions, no logos. Add subtle wheelhouse, radio, engine, and water ambience.",
    "0.66",
)
last_frame(WORK / "04-closeout-candidate.mp4", WORK / "04-closeout-candidate-last.png")

render(
    WORK / "04-closeout-candidate-last.png",
    LANDING / "northline-traceability.webp",
    WORK / "05-landing-candidate.mp4",
    "Single continuous cinematic camera move, no cuts. Continue the exact same slow, steady forward glide through the lit doorway onto the same vessel's dockside landing at first light. Follow one sealed catch container into a credible cold-chain handoff where a worker performs a digital lot scan. Maintain the same vessel identity, harbor geography, blue-hour weather evolving only naturally toward dawn, navy and cold-silver grade, realistic anatomy, and premium editorial documentary finish. In the final second settle into a calm slow forward glide toward the working harbor horizon. No pullback, no abrupt morph, no duplicated people, no text, no captions, no logos. Add subtle harbor water, refrigeration, gull, and working-port ambience.",
    "0.76",
)
last_frame(WORK / "05-landing-candidate.mp4", WORK / "05-landing-candidate-last.png")
print("FINALE CANDIDATES COMPLETE", flush=True)
