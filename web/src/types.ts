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
  reviewed?: boolean;
  issues: string[];
  rawText: string;
  lines: { text: string; confidence: number; page: number }[];
  pages: number;
  previewUrl?: string;
}
export interface Job {
  id: string;
  fileName: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  message?: string;
}
