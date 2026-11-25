import pytest

import app.main as main
from app.main import app, get_live_extractor
from tests.conftest import load_raw

PDF_BODY = b"%PDF-1.4\n" + b"x" * 100
PDF_HEADERS = {"Content-Type": "application/pdf"}


class FakeLive:
    def extract_pdf(self, pdf: bytes):
        return load_raw("zenith-inr")


@pytest.fixture
def live_client(client):
    app.dependency_overrides[get_live_extractor] = lambda: FakeLive()
    try:
        yield client
    finally:
        app.dependency_overrides.pop(get_live_extractor, None)


def sample_files():
    return sorted(str(p) for p in main.SAMPLES_DIR.rglob("*"))


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_samples_lists_zenith(client):
    items = {item["id"]: item for item in client.get("/samples").json()}
    assert items["zenith-inr"]["title"] == "Zenith Consulting (INR)"
    assert items["zenith-inr"]["pdf_url"] == "/samples/zenith-inr.pdf"


def test_sample_pdf_is_served(client):
    response = client.get("/samples/zenith-inr.pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_extract_returns_normalised_result(client):
    body = client.post("/extract/zenith-inr").json()
    assert body["source"] == "fixture"
    assert body["raw"]["total"] == "59,000.00"
    assert body["invoice"]["total"] == "59000.00"
    assert body["invoice"]["invoice_date"] == "2026-11-14"
    assert body["warnings"] == []


def test_ids_that_are_not_plain_names_are_rejected(client):
    assert client.post("/extract/Zenith_INR").status_code == 400
    assert client.post("/extract/..%2Fpyproject").status_code in (400, 404)
    assert client.get("/samples/..%5Csecret.pdf").status_code in (400, 404)


def test_unknown_sample_is_404(client):
    assert client.post("/extract/no-such-invoice").status_code == 404


def test_sample_without_fixture_is_503(client):
    assert client.post("/extract/nova-gbp").status_code == 503


def test_home_page_is_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Invoice extractor" in response.text


def test_upload_returns_extraction(live_client):
    response = live_client.post("/extract-upload", content=PDF_BODY, headers=PDF_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["sample_id"] == "upload"
    assert body["source"] == "claude"
    assert body["invoice"]["total"] == "59000.00"
    assert body["warnings"] == []


def test_upload_rejects_non_pdf_and_empty_body(live_client):
    assert live_client.post("/extract-upload", content=b"hello", headers=PDF_HEADERS).status_code == 400
    assert live_client.post("/extract-upload", content=b"", headers=PDF_HEADERS).status_code == 400


def test_upload_larger_than_limit_is_413(live_client, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 1024)
    big = b"%PDF-1.4\n" + b"x" * 2000
    assert live_client.post("/extract-upload", content=big, headers=PDF_HEADERS).status_code == 413
    assert live_client.post("/extract-upload", content=PDF_BODY, headers=PDF_HEADERS).status_code == 200


def test_upload_without_api_key_is_503(client):
    app.dependency_overrides[get_live_extractor] = lambda: None
    try:
        response = client.post("/extract-upload", content=PDF_BODY, headers=PDF_HEADERS)
    finally:
        app.dependency_overrides.pop(get_live_extractor, None)
    assert response.status_code == 503


def test_upload_leaves_samples_folder_unchanged(live_client):
    before = sample_files()
    assert live_client.post("/extract-upload", content=PDF_BODY, headers=PDF_HEADERS).status_code == 200
    assert sample_files() == before
