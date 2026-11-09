import { randomUUID } from 'node:crypto';
import type { OcrOutput, Receipt, LineItem } from './types.js';

const dateWords = '(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';
const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const totalLabel = /\b(grand\s*total|total(?:\s*amount|\s*due|\s*sales?|\s*payment|\s*payable)?|amount\s*due|balance\s*due|net\s*total)\b/i;
const skipTotalLabel = /\b(sub\s*total|total\s*(?:items?|qty|quantity|discount|tax|vat)|vatable|change|tendered)\b/i;
const subtotalLabel = /\bsub\s*total\b/i;
const taxLabel = /\b(?:vat|tax|sales\s*tax)\b/i;
const discountLabel = /\b(?:discount|less\s*discount|disc\.)\b/i;
const nonMerchant = /^(?:official\s*receipt|sales\s*invoice|receipt|invoice|transaction|cashier|branch|terminal|date|time|tel\.?|phone|vat|tax|tin\b|subtotal|total|address|thank\s*you|welcome|powered\s*by|www\.|http|pos\b|cash\b|customer\b|queue\b|order\b)/i;
const amountToken = /(?:₱|PHP\s*|USD\s*|\$\s*)?\(?-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\(?-?\d+(?:\.\d{1,2})?/gi;

function parseAmount(v: string): number | null {
  const candidate = v.replace(/(?:₱|PHP|USD|\$|\s|,|\(|\))/gi, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(candidate)) return null;
  const result = Number(candidate);
  if (!Number.isFinite(result) || Math.abs(result) > 100_000_000) return null;
  return v.includes('(') && v.includes(')') ? -Math.abs(result) : result;
}

function amountAtEnd(line: string): number | null {
  const matches = [...line.matchAll(amountToken)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const tail = line.slice((match.index ?? 0) + match[0].length).trim();
  // Avoid matching numbers embedded in product descriptions or middle of text.
  if (tail && !/^[*:-]?$/.test(tail)) return null;
  return parseAmount(match[0]);
}

function findAmount(lines: string[], re: RegExp, exclude?: RegExp): number | null {
  const hits = lines
    .filter(line => re.test(line) && !(exclude && exclude.test(line)))
    .map(line => amountAtEnd(line))
    .filter((value): value is number => value !== null);
  return hits.length ? hits[hits.length - 1] : null;
}

function validISO(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findDate(lines: string[]): { date: string; ambiguous: boolean } {
  for (const line of lines) {
    const iso = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) {
      const value = validISO(+iso[1], +iso[2], +iso[3]);
      if (value) return { date: value, ambiguous: false };
    }
    const numerical = line.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    if (numerical) {
      const a = +numerical[1], b = +numerical[2];
      const y = +numerical[3] < 100 ? 2000 + +numerical[3] : +numerical[3];
      // Philippine-style MM/DD/YYYY default; DD/MM if first component > 12.
      const month = a > 12 ? b : a;
      const day = a > 12 ? a : b;
      const value = validISO(y, month, day);
      if (value) return { date: value, ambiguous: a <= 12 && b <= 12 && a !== b };
    }
    const wordFirst = line.match(new RegExp(`\\b(${dateWords})\\.?[ -]+(\\d{1,2}),?[ -]+(20\\d{2})\\b`, 'i'));
    if (wordFirst) {
      const month = monthNames.indexOf(wordFirst[1].slice(0, 3).toUpperCase()) + 1;
      const value = validISO(+wordFirst[3], month, +wordFirst[2]);
      if (value) return { date: value, ambiguous: false };
    }
    const dayFirst = line.match(new RegExp(`\\b(\\d{1,2})[ -]+(${dateWords})\\.?[,]?[ -]+(20\\d{2})\\b`, 'i'));
    if (dayFirst) {
      const month = monthNames.indexOf(dayFirst[2].slice(0, 3).toUpperCase()) + 1;
      const value = validISO(+dayFirst[3], month, +dayFirst[1]);
      if (value) return { date: value, ambiguous: false };
    }
  }
  return { date: '', ambiguous: false };
}

function findReceiptNumber(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/\b(?:OR|SI|INV|INVOICE|RECEIPT|TRANS(?:ACTION)?|TXN|REF(?:ERENCE)?|ORDER)\s*(?:NO\.?|NUMBER|#|:|-)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,})\b/i);
    if (match && !/^(NUMBER|RECEIPT|INVOICE|SALES|DATE|TOTAL|CASH|OFFICIAL)$/i.test(match[1])) return match[1];
  }
  return '';
}

function findMerchant(lines: string[]): string {
  for (const line of lines.slice(0, 8)) {
    const candidate = line.trim().replace(/^[*#\-\s]+|[*#\-\s]+$/g, '');
    if (candidate.length < 3 || candidate.length > 64 || !/[A-Za-z]{3}/.test(candidate)) continue;
    if (nonMerchant.test(candidate) || /\b(?:20\d{2}|\d{2}:\d{2}|\d{4,})\b/.test(candidate)) continue;
    if (/\b(?:street|st\.|avenue|ave\.|road|rd\.|barangay|brgy\.|city|philippines)\b/i.test(candidate)) continue;
    return candidate;
  }
  return '';
}

function findItems(lines: string[]): LineItem[] {
  const stop = /\b(?:total|subtotal|tax|vat|discount|cash|change|credit|debit|payment|balance|tendered|amount\s*due|receipt|invoice|date|time|tin|thank|savings)\b/i;
  const result: LineItem[] = [];
  for (const line of lines) {
    if (stop.test(line) || !/\d+\.\d{2}\s*$/.test(line)) continue;
    const m = line.match(/^\s*(?:(\d{1,2})\s*[xX]?\s+)?(.{3,80}?)\s+(?:₱|PHP\s*)?([\d,]+\.\d{2})\s*$/i);
    if (!m || !/[A-Za-z]{2}/.test(m[2])) continue;
    const amount = parseAmount(m[3]);
    if (amount === null) continue;
    const quantity = m[1] ? +m[1] : 1;
    if (quantity > 99) continue;
    result.push({ description: m[2].trim(), quantity, amount });
  }
  return result.slice(0, 100);
}

export function parseReceipt(fileName: string, ocr: OcrOutput): Receipt {
  const lines = ocr.lines.map(line => line.text.trim()).filter(Boolean);
  const date = findDate(lines);
  // Prioritize explicit GRAND TOTAL / TOTAL / AMOUNT DUE over nearby cash or change values.
  const total = findAmount(lines, totalLabel, skipTotalLabel);
  const currency = /(?:₱|\bPHP\b|\bPESO(?:S)?\b)/i.test(ocr.rawText)
    ? 'PHP'
    : /(?:\bUSD\b|\$)/i.test(ocr.rawText) ? 'USD' : 'PHP';
  const paymentMethod = /\b(?:gcash|g\s*cash)\b/i.test(ocr.rawText) ? 'GCash'
    : /\b(?:maya|paymaya)\b/i.test(ocr.rawText) ? 'Maya'
    : /\b(?:visa|mastercard|credit\s*card|debit\s*card)\b/i.test(ocr.rawText) ? 'Card'
    : /\bcash\b/i.test(ocr.rawText) ? 'Cash' : '';
  const merchant = findMerchant(lines);
  const issues: string[] = [];
  if (!merchant) issues.push('Merchant not detected');
  if (!date.date) issues.push('Date not detected');
  if (date.ambiguous) issues.push('Date format may be ambiguous (MM/DD assumed)');
  if (total === null) issues.push('Total amount not detected');
  if (ocr.avgConfidence < 0.78) issues.push('Low OCR text confidence');
  if (lines.length === 0) issues.push('No readable text found');
  return {
    id: randomUUID(), fileName, merchant, date: date.date,
    receiptNumber: findReceiptNumber(lines), subtotal: findAmount(lines, subtotalLabel),
    tax: findAmount(lines, taxLabel, /\b(?:vatable|exempt|zero[- ]rated)\b/i),
    discount: findAmount(lines, discountLabel), total, currency, paymentMethod,
    items: findItems(lines), ocrConfidence: Number(ocr.avgConfidence.toFixed(3)),
    needsReview: issues.length > 0, issues, rawText: ocr.rawText,
    lines: ocr.lines, pages: ocr.pages
  };
}
