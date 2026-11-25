from decimal import Decimal

from app.models import Invoice


def _money(value: Decimal) -> str:
    return f"{value:,.2f}"


def validate_invoice(invoice: Invoice) -> list[str]:
    warnings: list[str] = []
    if not invoice.invoice_number:
        warnings.append("Invoice number is missing.")
    if invoice.invoice_date is None:
        warnings.append("Invoice date is missing.")
    if invoice.invoice_date and invoice.due_date and invoice.due_date < invoice.invoice_date:
        warnings.append("Due date is before the invoice date.")
    for index, item in enumerate(invoice.line_items, start=1):
        product = item.quantity * item.unit_price
        if product != item.amount:
            warnings.append(
                f"Line {index}: {item.quantity} x {item.unit_price} = {product}, but the invoice says {_money(item.amount)}."
            )
    if invoice.line_items:
        items_sum = sum((item.amount for item in invoice.line_items), Decimal("0"))
        if items_sum != invoice.subtotal:
            warnings.append(f"Line items add up to {_money(items_sum)}, but the subtotal is {_money(invoice.subtotal)}.")
    if invoice.subtotal + invoice.tax != invoice.total:
        warnings.append(f"Subtotal and tax give {_money(invoice.subtotal + invoice.tax)}, but the total is {_money(invoice.total)}.")
    if invoice.subtotal != 0 and float(invoice.tax) / float(invoice.subtotal) > 0.3:
        warnings.append("Tax is more than 30% of the subtotal.")
    return warnings
