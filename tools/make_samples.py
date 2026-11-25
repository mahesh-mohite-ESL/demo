import json
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.extractor import write_cache  # noqa: E402
from app.models import RawInvoice  # noqa: E402

SAMPLES_DIR = ROOT / "samples"
CACHE_DIR = SAMPLES_DIR / "cache"

EN = {
    "number": "Invoice No:",
    "date": "Invoice date:",
    "due": "Due date:",
    "currency": "Currency:",
    "subtotal": "Subtotal",
    "discount": "Discount",
    "total": "Total",
    "columns": ("Description", "Quantity", "Unit price", "Amount"),
}
DE = {
    "number": "Rechnungsnr.:",
    "date": "Rechnungsdatum:",
    "due": "Fällig am:",
    "currency": "Währung:",
    "subtotal": "Zwischensumme",
    "discount": "Rabatt",
    "total": "Gesamtbetrag",
    "columns": ("Beschreibung", "Menge", "Einzelpreis", "Betrag"),
}

SAMPLES = [
    {
        "id": "acme-usd",
        "title": "Acme Cloud Services (USD)",
        "heading": "INVOICE",
        "labels": EN,
        "vendor": ["Acme Cloud Services Inc.", "500 Harbor Street", "Seattle, WA 98101", "USA"],
        "number": "INV-10021",
        "date": "11/20/2026",
        "due": "12/20/2026",
        "currency": "USD",
        "items": [("Cloud hosting - November", "1", "1,250.00", "1,250.00"), ("Support plan", "2", "150.00", "300.00")],
        "subtotal": "1,550.00",
        "discount": "",
        "tax_label": "Sales tax (8%)",
        "tax": "124.00",
        "total": "1,674.00",
    },
    {
        "id": "bharat-inr",
        "title": "Bharat Office Supplies (INR)",
        "heading": "TAX INVOICE",
        "labels": EN,
        "vendor": ["Bharat Office Supplies Pvt. Ltd.", "14 MG Road", "Pune 411001", "India"],
        "number": "BOS/2026/0457",
        "date": "03/04/2026",
        "due": "03/05/2026",
        "currency": "INR",
        "items": [("Laser printer", "2", "45,000.00", "90,000.00"), ("Toner cartridge", "10", "1,000.00", "10,000.00")],
        "subtotal": "1,00,000.00",
        "discount": "",
        "tax_label": "GST (18%)",
        "tax": "18,000.00",
        "total": "1,18,000.00",
    },
    {
        "id": "muller-eur",
        "title": "Müller Maschinenbau (EUR)",
        "heading": "RECHNUNG",
        "labels": DE,
        "vendor": ["Müller Maschinenbau GmbH", "Industriestraße 7", "70565 Stuttgart", "Deutschland"],
        "number": "RE-2026-0193",
        "date": "12.11.2026",
        "due": "12.12.2026",
        "currency": "EUR",
        "items": [("Wartung Fräsmaschine", "1", "1.250,00", "1.250,00"), ("Ersatzteile", "4", "87,50", "350,00")],
        "subtotal": "1.600,00",
        "discount": "",
        "tax_label": "MwSt. (19%)",
        "tax": "304,00",
        "total": "1.904,00",
    },
    {
        "id": "nova-gbp",
        "title": "Nova Analytics (GBP)",
        "heading": "INVOICE",
        "labels": EN,
        "vendor": ["Nova Analytics Ltd", "22 Castle Lane", "Leeds LS1 4AP", "United Kingdom"],
        "number": "NOVA-2041",
        "date": "5 November 2026",
        "due": "5 December 2026",
        "currency": "GBP",
        "items": [("Data audit (days)", "3", "400.00", "1,200.00")],
        "subtotal": "1,200.00",
        "discount": "",
        "tax_label": "VAT (20%)",
        "tax": "240.00",
        "total": "1,440.00",
    },
    {
        "id": "orbit-discount",
        "title": "Orbit Logistics (USD, with discount)",
        "heading": "INVOICE",
        "labels": EN,
        "vendor": ["Orbit Logistics LLC", "910 Freight Avenue", "Dallas, TX 75201", "USA"],
        "number": "OL-88310",
        "date": "Oct 28, 2026",
        "due": "Nov 27, 2026",
        "currency": "USD",
        "items": [("Freight - pallet", "8", "125.00", "1,000.00"), ("Insurance", "1", "80.00", "80.00")],
        "subtotal": "1,080.00",
        "discount": "108.00",
        "discount_label": "Discount (10%)",
        "tax_label": "Sales tax (5%)",
        "tax": "48.60",
        "total": "1,020.60",
    },
    {
        "id": "pioneer-qty",
        "title": "Pioneer Fabrics (USD, fractional quantity)",
        "heading": "INVOICE",
        "labels": EN,
        "vendor": ["Pioneer Fabrics Co.", "37 Mill Road", "Charlotte, NC 28202", "USA"],
        "number": "PF-5572",
        "date": "November 3, 2026",
        "due": "December 3, 2026",
        "currency": "USD",
        "items": [("Cotton twill (metres)", "2.5", "19.99", "49.98"), ("Thread spool", "12", "1.25", "15.00")],
        "subtotal": "64.98",
        "discount": "",
        "tax_label": "Sales tax (0%)",
        "tax": "0.00",
        "total": "64.98",
    },
    {
        "id": "zenith-inr",
        "title": "Zenith Consulting (INR)",
        "heading": "TAX INVOICE",
        "labels": EN,
        "vendor": ["Zenith Consulting Pvt. Ltd.", "8 Residency Road", "Bengaluru 560025", "India"],
        "number": "ZC-2026-118",
        "date": "14 Nov 2026",
        "due": "14 Dec 2026",
        "currency": "INR",
        "items": [("Process review workshop", "2", "25,000.00", "50,000.00")],
        "subtotal": "50,000.00",
        "discount": "",
        "tax_label": "GST (18%)",
        "tax": "9,000.00",
        "total": "59,000.00",
    },
]

FOOTER = "Synthetic sample invoice for demonstration. Not a real document."


def register_fonts() -> tuple[str, str]:
    """Use a TrueType font when one is available, so that umlauts print correctly."""
    candidates = [
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            pdfmetrics.registerFont(TTFont("Body", regular))
            pdfmetrics.registerFont(TTFont("Body-Bold", bold))
            return "Body", "Body-Bold"
    return "Helvetica", "Helvetica-Bold"


def draw_pdf(sample: dict, path: Path, fonts: tuple[str, str]) -> None:
    regular, bold = fonts
    labels = sample["labels"]
    width, height = A4
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    left, right = 50, width - 50
    y = height - 60

    c.setFont(bold, 13)
    c.drawString(left, y, sample["vendor"][0])
    c.setFont(regular, 10)
    for i, line in enumerate(sample["vendor"][1:], start=1):
        c.drawString(left, y - 15 * i, line)
    c.setFont(bold, 22)
    c.drawRightString(right, y, sample["heading"])

    y -= 100
    c.setFont(regular, 10)
    for label, value in (
        (labels["number"], sample["number"]),
        (labels["date"], sample["date"]),
        (labels["due"], sample["due"]),
        (labels["currency"], sample["currency"]),
    ):
        c.drawString(left, y, label)
        c.drawString(left + 110, y, value)
        y -= 16

    y -= 20
    c.setFont(bold, 10)
    head_description, head_quantity, head_unit, head_amount = labels["columns"]
    c.drawString(left, y, head_description)
    c.drawRightString(330, y, head_quantity)
    c.drawRightString(430, y, head_unit)
    c.drawRightString(right, y, head_amount)
    y -= 6
    c.line(left, y, right, y)
    y -= 16
    c.setFont(regular, 10)
    for description, qty, unit, amount in sample["items"]:
        c.drawString(left, y, description)
        c.drawRightString(330, y, qty)
        c.drawRightString(430, y, unit)
        c.drawRightString(right, y, amount)
        y -= 16
    c.line(left, y + 8, right, y + 8)

    y -= 14
    totals = [(labels["subtotal"], sample["subtotal"])]
    if sample["discount"]:
        totals.append((sample.get("discount_label", labels["discount"]), "-" + sample["discount"]))
    totals.append((sample["tax_label"], sample["tax"]))
    for label, value in totals:
        c.drawString(330, y, label)
        c.drawRightString(right, y, value)
        y -= 16
    c.setFont(bold, 11)
    c.drawString(330, y, labels["total"])
    c.drawRightString(right, y, f"{sample['total']} {sample['currency']}")

    c.setFont(regular, 8)
    c.drawCentredString(width / 2, 40, FOOTER)
    c.showPage()
    c.save()


def raw_of(sample: dict) -> RawInvoice:
    return RawInvoice.model_validate(
        {
            "invoice_number": sample["number"],
            "vendor_name": sample["vendor"][0],
            "invoice_date": sample["date"],
            "due_date": sample["due"],
            "currency": sample["currency"],
            "line_items": [{"description": d, "quantity": q, "unit_price": u, "amount": a} for d, q, u, a in sample["items"]],
            "subtotal": sample["subtotal"],
            "discount": sample["discount"],
            "tax": sample["tax"],
            "total": sample["total"],
        }
    )


def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fonts = register_fonts()
    index = {}
    for sample in SAMPLES:
        draw_pdf(sample, SAMPLES_DIR / f"{sample['id']}.pdf", fonts)
        write_cache(CACHE_DIR / f"{sample['id']}.json", sample["id"], raw_of(sample), "seed")
        index[sample["id"]] = sample["title"]
    with (SAMPLES_DIR / "index.json").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
    print(f"Created {len(SAMPLES)} PDFs, {len(SAMPLES)} cache files and samples/index.json")


if __name__ == "__main__":
    main()
