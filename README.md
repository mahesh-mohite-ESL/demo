# Invoice extractor

A small FastAPI service that reads invoice PDFs with the Claude API, converts the printed values into dates and numbers, checks the arithmetic, and shows the result in a web page beside the PDF.

The bundled samples work without an API key: the extraction result of each sample is cached in `samples/cache/`.

## Upload your own invoice

Open the page, choose a PDF (up to 5 MB) under "Or upload your own invoice" and press "Extract uploaded PDF". This needs `ANTHROPIC_API_KEY` in the environment of the service. The file is sent to the Claude API and is not stored.

## Run locally

```
python -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest
uvicorn app.main:app --reload
```

Then open http://localhost:8000.

## Docker

```
docker build -t invoice-extractor .
docker run --rm -p 8000:8000 invoice-extractor
# with uploads enabled:
docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY invoice-extractor
```

## Folder layout

- `app/` the service: `main.py` (routes), `extractor.py` (Claude API and cache), `normalize.py`, `validate.py`, `models.py`, `static/index.html`
- `samples/` seven sample invoice PDFs, `index.json` and `cache/` with their extraction results
- `tools/` `make_samples.py` (recreates the samples), `refresh_cache.py` (re-extracts samples with Claude)
- `tests/` unit and API tests
- `docs/` extra documentation
