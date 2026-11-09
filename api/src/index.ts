import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { parseReceipt } from './parser.js';
import type { OcrOutput, Receipt } from './types.js';

const port = Number(process.env.PORT || 3001);
const ocrUrl = (process.env.OCR_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const timeoutMs = Number(process.env.OCR_TIMEOUT_MS || 600000);
const maxFileBytes = 10 * 1024 * 1024;
const maxBatchBytes = 50 * 1024 * 1024;
const maxFiles = 15;
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '16kb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileBytes, files: maxFiles } });

function fileTypeOK(file: Express.Multer.File): boolean {
  const b = file.buffer;
  if (b.length < 12) return false;
  const png = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const webp = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  const pdf = b.toString('ascii', 0, 5) === '%PDF-';
  const ext = file.originalname.split('.').pop()?.toLowerCase();
  return Boolean((png && ext === 'png') || (jpeg && ['jpg', 'jpeg'].includes(ext || '')) ||
    (webp && ext === 'webp') || (pdf && ext === 'pdf'));
}

function mimeFromFile(file: Express.Multer.File): string {
  const ext = file.originalname.split('.').pop()?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

app.get('/api/health', async (_req, res) => {
  try {
    const response = await fetch(`${ocrUrl}/health`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error('OCR unavailable');
    const data = await response.json() as { modelLoaded?: boolean };
    res.json({ api: 'online', ocr: 'online', modelLoaded: Boolean(data.modelLoaded) });
  } catch {
    res.status(503).json({ api: 'online', ocr: 'offline', modelLoaded: false });
  }
});

app.post('/api/receipts/scan', upload.array('files', maxFiles), async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  if (!files.length) { res.status(400).json({ error: 'Upload at least one receipt using the files field.' }); return; }
  if (files.reduce((sum, file) => sum + file.size, 0) > maxBatchBytes) {
    res.status(413).json({ error: 'Maximum combined upload size is 50 MB.' }); return;
  }
  if (files.some(file => !fileTypeOK(file))) {
    res.status(415).json({ error: 'Only valid PNG, JPG, WEBP and PDF files are supported.' }); return;
  }

  const receipts: Receipt[] = [];
  const errors: { fileName: string; message: string }[] = [];
  for (const file of files) {
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.buffer)], { type: mimeFromFile(file) }), file.originalname);
      const response = await fetch(`${ocrUrl}/ocr`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) {
        const info = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(response.status >= 500 ? 'OCR service encountered an error. Check the OCR terminal.' : (info.detail || `OCR returned HTTP ${response.status}`));
      }
      const ocr = await response.json() as OcrOutput;
      receipts.push(parseReceipt(file.originalname, ocr));
    } catch (error) {
      errors.push({ fileName: file.originalname, message: error instanceof Error ? error.message : 'Unknown OCR error' });
    }
  }
  res.status(receipts.length ? 200 : 502).json({ receipts, errors });
});

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.message });
    return;
  }
  console.error('API error:', error instanceof Error ? error.message : 'Unknown error');
  res.status(500).json({ error: 'Unexpected server error.' });
};
app.use(errorHandler);

app.listen(port, '0.0.0.0', () => {
  console.log(`ReceiptFlow API ready at http://localhost:${port} (OCR: ${ocrUrl})`);
});
