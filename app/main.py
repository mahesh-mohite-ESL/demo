import json
import os
import re
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.extractor import CachedExtractor, ClaudeExtractor, ExtractionUnavailable, Extractor
from app.models import ExtractionResult, RawInvoice, SampleInfo
from app.normalize import normalize_invoice
from app.validate import validate_invoice

ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT / "samples"
CACHE_DIR = SAMPLES_DIR / "cache"
STATIC_DIR = Path(__file__).resolve().parent / "static"
SAMPLE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PDF_MAGIC = b"%PDF-"

app = FastAPI(title="Invoice extractor", version="1.0.0")


def get_live_extractor() -> ClaudeExtractor | None:
    return ClaudeExtractor() if os.environ.get("ANTHROPIC_API_KEY") else None


def get_extractor() -> Extractor:
    return CachedExtractor(CACHE_DIR, live=ClaudeExtractor() if os.environ.get("ANTHROPIC_API_KEY") else None)


def sample_path(sample_id: str) -> Path:
    if not SAMPLE_ID.match(sample_id):
        raise HTTPException(status_code=400, detail="Invalid sample id.")
    path = SAMPLES_DIR / f"{sample_id}.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Unknown sample.")
    return path


def build_result(sample_id: str, source: str, raw: RawInvoice) -> ExtractionResult:
    try:
        invoice = normalize_invoice(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ExtractionResult(sample_id=sample_id, source=source, raw=raw, invoice=invoice, warnings=validate_invoice(invoice))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/config")
def config() -> dict[str, str]:
    return {"repo_url": os.environ.get("REPO_URL", "").rstrip("/")}


@app.get("/samples")
def list_samples() -> list[SampleInfo]:
    index = json.loads((SAMPLES_DIR / "index.json").read_text(encoding="utf-8"))
    return [SampleInfo(id=sample_id, title=index[sample_id], pdf_url=f"/samples/{sample_id}.pdf") for sample_id in sorted(index)]


@app.get("/samples/{sample_id}.pdf")
def get_sample_pdf(sample_id: str) -> FileResponse:
    return FileResponse(sample_path(sample_id), media_type="application/pdf")


@app.post("/extract/{sample_id}")
def extract(sample_id: str, refresh: bool = False, extractor: Extractor = Depends(get_extractor)) -> ExtractionResult:
    path = sample_path(sample_id)
    try:
        raw, source = extractor.extract(sample_id, path.read_bytes(), refresh)
    except ExtractionUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return build_result(sample_id, source, raw)


@app.post("/extract-upload")
async def extract_upload(request: Request, live: ClaudeExtractor | None = Depends(get_live_extractor)) -> ExtractionResult:
    limit = MAX_UPLOAD_BYTES
    too_large = HTTPException(status_code=413, detail="The file is larger than 5 MB.")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise too_large
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_large
        chunks.append(chunk)
    pdf = b"".join(chunks)
    if not pdf.startswith(PDF_MAGIC):
        raise HTTPException(status_code=400, detail="The uploaded file is not a PDF.")
    if live is None:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY is not set, so uploaded invoices cannot be extracted.")
    try:
        raw = await run_in_threadpool(live.extract_pdf, pdf)
    except ExtractionUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return build_result("upload", "claude", raw)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
