# ReceiptFlow — PaddleOCR receipt extraction POC

A working proof-of-concept project for **batch receipt scanning**. Upload multiple files in React, run *real* text recognition with local PaddleOCR, parse structured receipt data through Node.js, review and edit it, and export CSV or JSON. **No database** and no paid OCR API.

## Architecture

```text
React + Vite (localhost:5173)
        | HTTPS? No: local HTTP only
        | FormData (one receipt at a time, sequential upload queue)
        v
Node.js + Express + TypeScript (localhost:3001)
        | validates input; forwards raw file; parses fields
        v
Python FastAPI + PaddleOCR 3.x CPU (localhost:8000)
        | performs text detection & recognition locally
        v
Structured OCR lines + confidence -> Node parser -> React editable session state
                                                |-> Export CSV / JSON
                                                |-> Nothing stored in a database
```

**Why Python?** PaddleOCR's local inference pipeline is a Python library. React and Node.js remain the app/frontend backend; a small Python worker performs the PaddleOCR execution. Node.js owns parsing and API orchestration.

## Capabilities

- Bulk select/drag and drop **JPG, JPEG, PNG, WEBP, PDF** (max 15 at once, max 10 MB each, PDFs up to 5 pages)
- Automatically OCR each file, preserve the original document preview, report per-file progress or errors
- Extract merchant, receipt date, OR / invoice number, subtotal, VAT/tax, discount, grand total, currency, payment method and best-effort line items
- OCR confidence, missing-field review flags, user-editable details and line-item correction
- CSV and JSON exports, search/filter and clear session
- Uploaded files are held in memory; no application-level file or record persistence
- One receipt file = one logical receipt. For multi-page PDF, lines are combined into one record.

### Important limitations

This is a POC, **not a production receipt/accounting system**. Different receipt layouts can confuse the rule-based parser even when OCR reads the text correctly. Merchant, prices and items must be checked before use in accounting. Number formats and date formats can be ambiguous; MM/DD/YYYY is assumed for ambiguous numeric dates and flagged. The default currency is PHP unless explicit USD evidence is found; edit currency if needed. A photo containing multiple physical receipts is **not automatically segmented**: upload each receipt separately. No authentication, multi-tenancy, audit trail, or server-side persistence. Text confidence is NOT a guarantee that extraction fields are correct.

## Prerequisites

- **Node.js 20.11+** (Node 22 recommended)
- **Python 3.11** (recommended for widest PaddlePaddle/PaddleOCR wheel compatibility; avoid Python 3.13 unless platform wheels are verified)
- An internet connection **the first time** for Python wheels and PaddleOCR pretrained model downloads. After installing and caching models, recognition runs locally.
- CPU inference is supported; no GPU required. Initial startup / model download can take a while.

## Start the POC (Windows PowerShell)

Open three terminals in the extracted project folder.

**Terminal 1 — Python OCR**

```powershell
cd ocr
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install -r requirements.txt
python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

If PowerShell blocks venv activation, use `ocr\.venv\Scripts\python.exe` instead of activating, or configure your own permitted execution policy. Verify `http://localhost:8000/health` shows `status: ok` (model is loaded on first scan).

**Terminal 2 — Node API**

```powershell
# From project root
npm install
npm run dev -w api
```

**Terminal 3 — React UI**

```powershell
# From project root
npm run dev -w web
```

Open **http://localhost:5173**. The top-right badge should say "OCR connected". Upload test images to trigger the first model download. Once loaded, it says "OCR ready" after a scan.

### Linux / WSL / macOS (Python 3.11)

```bash
cd ocr
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install -r requirements.txt
python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

Then in another terminal from project root: `npm install && npm run dev` (starts both Node + React). On macOS Apple Silicon check the PaddlePaddle install matrix for a compatible wheel/platform instead of assuming the CPU wheel above supports it.

**If using WSL:** keep all three services in WSL for straightforward `localhost` networking. If OCR runs in Docker or on another machine, set `OCR_URL` in the API's environment and ensure it is reachable; do not expose the OCR endpoint publicly.

## Test and build

```bash
npm run test       # Node parser tests, no PaddleOCR download needed
npm run typecheck  # TypeScript checks
npm run build      # Production bundle build (still requires OCR service)
```

Optional adapter smoke tests (without downloading any OCR model): `cd ocr && python -m unittest -v test_service.py`. Two synthetic demo image receipts are included in `samples/` for your first manual scans. They are mock data, not actual transactions.

Try `http://localhost:3001/api/health` to inspect Node's connectivity to OCR. An OCR server status of `offline` means the Python service is not running or cannot be reached.

### API example

```bash
curl -X POST http://localhost:3001/api/receipts/scan \
  -F 'files=@/path/to/receipt1.jpg' \
  -F 'files=@/path/to/receipt2.png'
```

Node returns `receipts` (one parsed record per successful file) and `errors` (individual failures). React processes files sequentially to show progress and isolate failures.

## No database: what does “recorded” mean?

All extracted/editable records are held in **the React page's memory for the current session**. Refresh/close loses them. Download CSV/JSON to retain the data. The API does not store receipts and Python does not intentionally write receipt content to disk, although framework upload buffering and the PaddleOCR **model cache** may use the system's filesystem. Uploading sensitive personal/customer receipts to an open public instance is not recommended.

## Receipt layout tuning with your samples

The parser lives at `api/src/parser.ts`; the OCR adapter lives at `ocr/service.py`. Once you provide representative receipts, the regex/layout handling can be tailored to your merchants, formats and required claim fields. Test the parser with `npm test`. The present rule-based extraction is designed as a starting point and will need calibration for real data.

## Security notes

For demo use on a trusted local machine only. Input extensions/magic bytes are checked, per-file size is capped, uploads aren't retained, and the CSV exporter escapes spreadsheet formulas in text fields. **Before production:** add authentication/authorization, isolated file scanning, TLS, rate limits, proper request timeouts, structured audit logs, stronger validation and anti-abuse controls, privacy/retention policy, robust queueing, and human approval of extracted totals.

## PaddleOCR references

- https://www.paddleocr.ai/main/en/quick_start.html
- https://www.paddleocr.ai/main/en/version3.x/installation.html
- https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md
