from datetime import date
from decimal import Decimal

import pytest

from app.normalize import normalize_invoice
from app.validate import validate_invoice
from tests.conftest import load_raw


@pytest.fixture
def invoice():
    return normalize_invoice(load_raw("acme-usd"))


def test_consistent_invoice_has_no_warnings(invoice):
    assert validate_invoice(invoice) == []


def test_empty_invoice_number_is_reported(invoice):
    invoice.invoice_number = ""
    assert "Invoice number is missing." in validate_invoice(invoice)


def test_due_date_before_invoice_date_is_reported(invoice):
    invoice.due_date = date(2026, 11, 1)
    assert "Due date is before the invoice date." in validate_invoice(invoice)


def test_wrong_line_amount_is_reported(invoice):
    invoice.line_items[1].amount = Decimal("310.00")
    warnings = validate_invoice(invoice)
    assert any(w.startswith("Line 2:") for w in warnings)


def test_subtotal_mismatch_is_reported(invoice):
    invoice.subtotal = Decimal("1500.00")
    invoice.total = Decimal("1624.00")
    warnings = validate_invoice(invoice)
    assert any(w.startswith("Line items add up to 1,550.00") for w in warnings)


def test_total_mismatch_is_reported(invoice):
    invoice.total = Decimal("1700.00")
    warnings = validate_invoice(invoice)
    assert any("the total is 1,700.00" in w for w in warnings)
