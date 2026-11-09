export interface OcrLine {
  text: string;
  confidence: number;
  page: number;
}

export interface OcrOutput {
  lines: OcrLine[];
  rawText: string;
  avgConfidence: number;
  pages: number;
}

export interface LineItem {
  description: string;
  quantity: number;
  amount: number;
}

export interface Receipt {
  id: string;
  fileName: string;
  merchant: string;
  date: string;
  receiptNumber: string;
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number | null;
  currency: string;
  paymentMethod: string;
  items: LineItem[];
  ocrConfidence: number;
  needsReview: boolean;
  issues: string[];
  rawText: string;
  lines: OcrLine[];
  pages: number;
}
