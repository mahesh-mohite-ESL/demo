from datetime import date
from decimal import Decimal

import pytest

from app.normalize import (
    clean_invoice_number,
    clean_text,
    normalize_currency,
    normalize_invoice,
    parse_amount,
    parse_date,
)
from tests.conftest import load_raw


def test_parse_amount_reads_thousands_separators():
    assert parse_amount("1,250.00") == Decimal("1250.00")
    assert parse_amount("1,18,000.00") == Decimal("118000.00")


def test_parse_amount_ignores_currency_text():
    assert parse_amount("Rs. 9,000.00") == Decimal("9000.00")
    assert parse_amount("$ 80.00") == Decimal("80.00")


def test_parse_amount_treats_empty_and_dash_as_zero():
    assert parse_amount("") == Decimal("0")
    assert parse_amount("-") == Decimal("0")


def test_parse_amount_raises_for_text_without_number():
    with pytest.raises(ValueError):
        parse_amount("n/a")


def test_parse_date_reads_written_months():
    assert parse_date("14 Nov 2026") == date(2026, 11, 14)
    assert parse_date("5 November 2026") == date(2026, 11, 5)
    assert parse_date("Oct 28, 2026") == date(2026, 10, 28)


def test_parse_date_reads_iso_and_dotted_dates():
    assert parse_date("2026-11-20") == date(2026, 11, 20)
    assert parse_date("12.11.2026") == date(2026, 11, 12)


def test_parse_date_honours_day_first():
    assert parse_date("03/04/2026", day_first=True) == date(2026, 4, 3)
    assert parse_date("03/04/2026", day_first=False) == date(2026, 3, 4)


def test_parse_date_falls_back_to_the_other_order():
    assert parse_date("11/20/2026", day_first=True) == date(2026, 11, 20)


def test_parse_date_of_blank_text_is_none():
    assert parse_date("") is None
    assert parse_date("   ") is None


def test_parse_date_raises_for_unknown_text():
    with pytest.raises(ValueError):
        parse_date("next week")


def test_normalize_currency_maps_symbols_and_codes():
    assert normalize_currency("$") == "USD"
    assert normalize_currency("Rs.") == "INR"
    assert normalize_currency(" eur ") == "EUR"


def test_clean_invoice_number_removes_a_leading_label():
    assert clean_invoice_number("No. ZC-2026-118") == "ZC-2026-118"
    assert clean_invoice_number("# INV-10021 ") == "INV-10021"


def test_clean_text_collapses_whitespace():
    assert clean_text("  Acme \n  Cloud\tServices  ") == "Acme Cloud Services"


def test_normalize_invoice_converts_every_field():
    invoice = normalize_invoice(load_raw("zenith-inr"))
    assert invoice.invoice_number == "ZC-2026-118"
    assert invoice.vendor_name == "Zenith Consulting Pvt. Ltd."
    assert invoice.invoice_date == date(2026, 11, 14)
    assert invoice.due_date == date(2026, 12, 14)
    assert invoice.currency == "INR"
    assert invoice.line_items[0].quantity == Decimal("2")
    assert invoice.line_items[0].amount == Decimal("50000.00")
    assert invoice.discount == Decimal("0")
    assert invoice.total == Decimal("59000.00")
