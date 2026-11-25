import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.extractor import ClaudeExtractor, ExtractionUnavailable, write_cache  # noqa: E402

SAMPLES_DIR = ROOT / "samples"
CACHE_DIR = SAMPLES_DIR / "cache"


def main(argv: list[str]) -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set. Set it and run this script again.")
        return 1
    ids = argv or sorted(p.stem for p in SAMPLES_DIR.glob("*.pdf"))
    live = ClaudeExtractor()
    for sample_id in ids:
        pdf_path = SAMPLES_DIR / f"{sample_id}.pdf"
        if not pdf_path.exists():
            print(f"Unknown sample: {sample_id}")
            return 1
        try:
            raw = live.extract_pdf(pdf_path.read_bytes())
        except ExtractionUnavailable as exc:
            print(f"{sample_id}: {exc}")
            return 1
        write_cache(CACHE_DIR / f"{sample_id}.json", sample_id, raw, "claude", live.model)
        print(f"Refreshed {sample_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
