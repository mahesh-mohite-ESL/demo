import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.extractor import ExtractionUnavailable
from app.main import app, get_extractor
from app.models import RawInvoice

FIXTURES = Path(__file__).parent / "fixtures"


def load_raw(name: str) -> RawInvoice:
    return RawInvoice.model_validate(json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8")))


class FakeExtractor:
    def extract(self, sample_id: str, pdf: bytes, refresh: bool = False) -> tuple[RawInvoice, str]:
        if not (FIXTURES / f"{sample_id}.json").exists():
            raise ExtractionUnavailable("No fixture for this sample.")
        return load_raw(sample_id), "fixture"


@pytest.fixture
def client():
    app.dependency_overrides[get_extractor] = lambda: FakeExtractor()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_extractor, None)
