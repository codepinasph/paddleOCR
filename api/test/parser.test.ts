import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReceipt } from '../src/parser.ts';
import type { OcrOutput } from '../src/types.ts';

function read(lines: string[], score = .94): OcrOutput {
  return { lines: lines.map(text => ({ text, confidence: score, page: 1 })), rawText: lines.join('\n'), avgConfidence: score, pages: 1 };
}

test('Philippine receipt: extract merchant, date, reference, tax and total', () => {
  const result = parseReceipt('sample.jpg', read([
    'CAFE MAHOGANY', 'Official Receipt', 'OR # 000123-A', 'Date: 11/05/2026',
    '2 Coffee Latte 290.00', 'Sandwich 180.00', 'SUBTOTAL 470.00',
    'VAT 50.36', 'GRAND TOTAL ₱470.00', 'CASH 500.00', 'CHANGE 30.00'
  ]));
  assert.equal(result.merchant, 'CAFE MAHOGANY');
  assert.equal(result.date, '2026-11-05');
  assert.equal(result.receiptNumber, '000123-A');
  assert.equal(result.total, 470);
  assert.equal(result.subtotal, 470);
  assert.equal(result.tax, 50.36);
  assert.equal(result.currency, 'PHP');
  assert.equal(result.paymentMethod, 'Cash');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.needsReview, true); // MM/DD ambiguity warning
});

test('ISO dates and amounts work without PHP symbols', () => {
  const result = parseReceipt('receipt.png', read([
    'CITY BOOKSTORE', 'DATE 2026-11-09 10:35', 'Notebook 120.00', 'SUBTOTAL 120.00', 'TOTAL 120.00'
  ]));
  assert.equal(result.date, '2026-11-09');
  assert.equal(result.total, 120);
  assert.equal(result.needsReview, false);
});

test('missing fields flagged without inventing total', () => {
  const result = parseReceipt('blur.jpg', read(['THANK YOU FOR SHOPPING', 'unreadable text'], .5));
  assert.equal(result.total, null);
  assert.equal(result.needsReview, true);
  assert.ok(result.issues.includes('Total amount not detected'));
});

test('month name dates and an amount with thousands separators', () => {
  const result = parseReceipt('a.jpg', read(['MARKET PLAZA', 'Nov 09, 2026', 'Total: 1,234.50']));
  assert.equal(result.date, '2026-11-09');
  assert.equal(result.total, 1234.50);
});
