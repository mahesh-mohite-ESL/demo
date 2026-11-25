import re
from datetime import date, datetime
from decimal import Decimal

from app.models import Invoice, LineItem, RawInvoice

_CURRENCIES = {
    "$": "USD",
    "US$": "USD",
    "€": "EUR",
    "£": "GBP",
    "₹": "INR",
    "RS": "INR",
    "RS.": "INR",
}

_NUMBER = re.compile(r"-?\d[\d.,]*")

_NUMERIC_DATE_FORMATS = {
    True: ("%d/%m/%Y", "%m/%d/%Y"),
    False: ("%m/%d/%Y", "%d/%m/%Y"),
}
_OTHER_DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y", "%d-%b-%y")


def normalize_currency(text: str) -> str:
    value = text.strip().upper()
    return _CURRENCIES.get(value, value)


def parse_amount(text: str) -> Decimal:
    match = _NUMBER.search(text)
    if match is None:
        if text.strip() in ("", "-"):
            return Decimal("0")
        raise ValueError(f"No number found in {text!r}")
    number = match.group(0).rstrip(".,")
    number = number.replace(",", "")
    return Decimal(number)


def parse_date(text: str, day_first: bool = False) -> date | None:
    value = text.strip()
    if not value:
        return None
    order = _NUMERIC_DATE_FORMATS[day_first]
    candidates = [fmt for fmt in order] + [fmt.replace("/", "-") for fmt in order] + list(_OTHER_DATE_FORMATS)
    for fmt in candidates:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date: {text!r}")


def clean_invoice_number(text: str) -> str:
    return re.sub(r"^(?:No\.|#)[\s:]*", "", text.strip()).strip()


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_invoice(raw: RawInvoice) -> Invoice:
    return Invoice(
        invoice_number=clean_invoice_number(raw.invoice_number),
        vendor_name=clean_text(raw.vendor_name),
        invoice_date=parse_date(raw.invoice_date),
        due_date=parse_date(raw.due_date),
        currency=normalize_currency(raw.currency),
        line_items=[
            LineItem(
                description=clean_text(item.description),
                quantity=parse_amount(item.quantity),
                unit_price=parse_amount(item.unit_price),
                amount=parse_amount(item.amount),
            )
            for item in raw.line_items
        ],
        subtotal=parse_amount(raw.subtotal),
        discount=parse_amount(raw.discount),
        tax=parse_amount(raw.tax),
        total=parse_amount(raw.total),
    )
