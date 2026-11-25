# Planted bugs (spoilers)

| # | Sample | What you see | What is right | File |
|---|--------|--------------|---------------|------|
| 1 | bharat-inr | Invoice date 2026-03-04, due date 2026-03-05 | 2026-04-03 and 2026-05-03: an Indian invoice prints day/month/year | app/normalize.py |
| 2 | muller-eur | Subtotal 1.60, total 1.90, unit price 87,50 shown as 8750 | 1600.00 and 1904.00: 1.600,00 uses a decimal comma | app/normalize.py |
| 3 | nova-gbp | Invoice number OVA-2041 | NOVA-2041 | app/normalize.py |
| 4 | orbit-discount | Warning "Subtotal and tax give 1,128.60, but the total is 1,020.60" | No warning: 1,080.00 - 108.00 discount + 48.60 tax = 1,020.60 | app/validate.py |
| 5 | pioneer-qty | Warning "Line 1: 2.5 x 19.99 = 49.975, but the invoice says 49.98" | No warning: 49.975 rounds to 49.98 | app/validate.py |

## Bug reports to paste

### 1. bharat-inr dates

Sample: bharat-inr. Field: invoice date and due date. The service shows an invoice date of 2026-03-04 and a due date of 2026-03-05. The PDF prints 03/04/2026 and 03/05/2026 on an Indian invoice, which is day/month/year, so the invoice date is 3 April 2026 and the due date is 3 May 2026.

### 2. muller-eur amounts

Sample: muller-eur. Field: subtotal, total and the unit price of line 2. The service shows a subtotal of 1.60, a total of 1.90 and a unit price of 8750. The PDF prints 1.600,00, 1.904,00 and 87,50. This is the German format with a decimal comma, so the values are 1600.00, 1904.00 and 87.50.

### 3. nova-gbp invoice number

Sample: nova-gbp. Field: invoice number. The service shows OVA-2041. The PDF prints NOVA-2041, which is the complete number. Only a label such as "No." or "#" should be removed.

### 4. orbit-discount warning

Sample: orbit-discount. Field: validation warning. The service shows "Subtotal and tax give 1,128.60, but the total is 1,020.60". The PDF prints a subtotal of 1,080.00, a discount of 108.00 and tax of 48.60. 1,080.00 - 108.00 + 48.60 = 1,020.60, so the total is correct and there should be no warning.

### 5. pioneer-qty warning

Sample: pioneer-qty. Field: validation warning. The service shows "Line 1: 2.5 x 19.99 = 49.975, but the invoice says 49.98". The PDF prints 49.98 for line 1. 2.5 x 19.99 = 49.975, which rounds to 49.98, so the line is correct and there should be no warning.

## Report to hand over to a person

Extraction feels wrong
