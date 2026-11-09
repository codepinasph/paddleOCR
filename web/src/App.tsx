import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, Check, CheckCheck, CheckCircle2,
  ChevronDown, CircleAlert, Clock3, CloudUpload, DatabaseZap, FileCheck2,
  FileImage, FileJson2, FileSpreadsheet, FileText, FolderOpen, Info,
  LayoutDashboard, LoaderCircle, MoreHorizontal, Plus, RefreshCw, ScanLine,
  Search, ShieldCheck, Sparkles, Trash2, UploadCloud, X
} from 'lucide-react';
import type { Job, Receipt } from './types';

type Filter = 'all' | 'review' | 'verified';
type EditableKey = 'merchant' | 'date' | 'receiptNumber' | 'currency' | 'paymentMethod';
type AmountKey = 'subtotal' | 'tax' | 'discount' | 'total';
const accepted = '.png,.jpg,.jpeg,.webp,.pdf';
const numericFields: AmountKey[] = ['subtotal', 'tax', 'discount', 'total'];

function money(value: number | null, currency = 'PHP') {
  if (value === null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(value);
  } catch { return `${currency} ${value.toFixed(2)}`; }
}
function shortDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Not found';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}
function download(blob: Blob, filename: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function csvCell(value: string | number | boolean | null | undefined) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) && typeof value === 'string') text = `'${text}`; // Prevent spreadsheet formula injection
  return `"${text.replace(/"/g, '""')}"`;
}

function IconTile({ children, variant = 'blue' }: { children: ReactNode; variant?: string }) {
  return <span className={`icon-tile icon-tile--${variant}`}>{children}</span>;
}

export default function App() {
  const [records, setRecords] = useState<Receipt[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [serverStatus, setServerStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [modelLoaded, setModelLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);

  const selected = records.find(record => record.id === selectedId) ?? null;
  const reviewCount = records.filter(r => r.needsReview && !r.reviewed).length;
  const verifiedCount = records.filter(r => !r.needsReview || r.reviewed).length;
  const totalPHP = records.reduce((total, r) => total + (r.currency === 'PHP' && r.total !== null ? r.total : 0), 0);
  const visible = useMemo(() => records.filter(r => {
    const statusOK = filter === 'all' || (filter === 'review' ? r.needsReview && !r.reviewed : !r.needsReview || r.reviewed);
    const searchOK = `${r.merchant} ${r.fileName} ${r.receiptNumber}`.toLowerCase().includes(query.toLowerCase());
    return statusOK && searchOK;
  }), [records, filter, query]);

  async function probe() {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('Unavailable');
      const result = await response.json() as { modelLoaded: boolean };
      setServerStatus('ready');
      setModelLoaded(result.modelLoaded);
    } catch { setServerStatus('offline'); }
  }
  useEffect(() => {
    void probe();
    const urls = previewUrls.current;
    return () => { urls.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  async function handleFiles(fileList: FileList | File[]) {
    if (busyRef.current) return;
    const files = Array.from(fileList);
    if (!files.length) return;
    if (files.length > 15) { setNotice('Maximum 15 receipts per batch.'); return; }
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    const batch = files.map(file => ({ id: crypto.randomUUID(), fileName: file.name, status: 'queued' as const }));
    setJobs(current => [...batch, ...current].slice(0, 30));
    let completed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i], jobId = batch[i].id;
      const update = (status: Job['status'], message?: string) => setJobs(current => current.map(job => job.id === jobId ? { ...job, status, message } : job));
      if (file.size > 10 * 1024 * 1024) { update('error', 'File is larger than 10 MB.'); continue; }
      if (!/\.(png|jpe?g|webp|pdf)$/i.test(file.name)) { update('error', 'Unsupported file type.'); continue; }
      update('processing');
      try {
        const form = new FormData();
        form.append('files', file);
        const response = await fetch('/api/receipts/scan', { method: 'POST', body: form });
        const result = await response.json() as { receipts?: Receipt[]; errors?: { fileName: string; message: string }[]; error?: string };
        if (!response.ok || !result.receipts?.length) throw new Error(result.errors?.[0]?.message || result.error || 'Extraction failed.');
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        const record = { ...result.receipts[0], previewUrl, reviewed: false };
        setRecords(current => [record, ...current]);
        setSelectedId(current => current ?? record.id);
        completed++;
        update('done');
      } catch (error) {
        update('error', error instanceof Error ? error.message : 'Unknown upload error.');
      }
    }
    if (completed) setNotice(`${completed} receipt${completed === 1 ? '' : 's'} processed. Review flagged fields before export.`);
    await probe();
    busyRef.current = false;
    setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) void handleFiles(event.dataTransfer.files);
  }
  function onSelect(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) void handleFiles(event.target.files); }
  function updateReceipt(patch: Partial<Receipt>) {
    if (!selectedId) return;
    setRecords(current => current.map(r => r.id === selectedId ? { ...r, ...patch, reviewed: false } : r));
  }
  function removeReceipt(receipt: Receipt) {
    if (receipt.previewUrl) {
      URL.revokeObjectURL(receipt.previewUrl);
      previewUrls.current.delete(receipt.previewUrl);
    }
    setRecords(current => current.filter(r => r.id !== receipt.id));
    if (selectedId === receipt.id) setSelectedId(records.find(r => r.id !== receipt.id)?.id ?? null);
  }
  function exportJSON() {
    const data = records.map(({ previewUrl: _previewUrl, ...record }) => record);
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'receiptflow-records.json');
  }
  function exportCSV() {
    const headers = ['File Name', 'Merchant', 'Date', 'Receipt Number', 'Currency', 'Subtotal', 'Tax', 'Discount', 'Total', 'Payment Method', 'OCR Confidence', 'Needs Review', 'Reviewed', 'Issues', 'Items'];
    const rows = records.map(r => [r.fileName, r.merchant, r.date, r.receiptNumber, r.currency, r.subtotal, r.tax, r.discount, r.total, r.paymentMethod, r.ocrConfidence, r.needsReview, r.reviewed ?? false, r.issues.join('; '), r.items.map(i => `${i.quantity}x ${i.description}: ${i.amount}`).join('; ')]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    download(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), 'receiptflow-records.csv');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-symbol"><ScanLine size={23} strokeWidth={2.3} /></span><span>receipt<span className="brand-accent">flow</span><small>OCR WORKSPACE</small></span></div>
        <div className="side-group-label">WORKSPACE</div>
        <div className="side-link active"><LayoutDashboard size={18} /><span>Overview</span></div>
        <div className="side-link muted"><FileText size={18} /><span>Receipts</span><span className="side-count">{records.length}</span></div>
        <div className="side-link muted"><Activity size={18} /><span>Extraction queue</span></div>
        <div className="sidebar-spacer" />
        <div className="side-note"><div className="side-note-icon"><DatabaseZap size={18} /></div><strong>Demo workspace</strong><p>Records stay in memory and disappear when you refresh. Export to keep a copy.</p><span>No database connected</span></div>
        <div className="sidebar-footer"><div className="avatar">RF</div><div><strong>Local environment</strong><small>PaddleOCR POC · v1.0</small></div><MoreHorizontal size={18}/></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>Overview</strong></div><div className="topbar-right"><span className={`service-status ${serverStatus}`}><span className="status-dot" />{serverStatus === 'ready' ? (modelLoaded ? 'OCR ready' : 'OCR connected') : serverStatus === 'offline' ? 'OCR offline' : 'Checking OCR'}</span><span className="top-avatar">RF</span></div></header>
        <div className="content">
          <div className="heading-area"><div><div className="eyebrow"><Sparkles size={14} /> SMART DOCUMENT PROCESSING</div><h1>Receipt intelligence, <em>simplified.</em></h1><p>Turn stacks of receipts into clean, structured records in seconds. Powered by PaddleOCR.</p></div><div className="heading-actions"><span className="poc-label"><ShieldCheck size={15}/> Local-first POC</span></div></div>

          <div className="metrics">
            <div className="metric"><IconTile><FileText size={20} /></IconTile><div className="metric-number">{records.length.toString().padStart(2, '0')}</div><span>Receipts scanned</span><small>Total this session</small></div>
            <div className="metric"><IconTile variant="orange"><CircleAlert size={20} /></IconTile><div className="metric-number">{reviewCount.toString().padStart(2, '0')}</div><span>Needs review</span><small>Check extracted fields</small></div>
            <div className="metric"><IconTile variant="green"><CheckCheck size={20} /></IconTile><div className="metric-number">{verifiedCount.toString().padStart(2, '0')}</div><span>Ready to export</span><small>Auto-cleared or reviewed</small></div>
            <div className="metric"><IconTile variant="purple"><FileSpreadsheet size={20} /></IconTile><div className="metric-number metric-number--money">{money(totalPHP)}</div><span>Total captured (PHP)</span><small>Excludes non-PHP receipts</small></div>
          </div>

          <div className="workflow-grid">
            <section className="panel upload-panel"><div className="panel-header"><div><div className="section-pretitle">STEP 01</div><h2>Upload receipts</h2><p>Drag in receipts or browse your files.</p></div><IconTile><CloudUpload size={21} /></IconTile></div>
              <div className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'disabled' : ''}`} onDragOver={event => {event.preventDefault(); setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => !busy && fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !busy) fileInput.current?.click(); }} aria-label="Upload receipt files">
                <div className="upload-illustration"><UploadCloud size={31} strokeWidth={1.7}/><div className="illustration-glow" /></div>
                <strong>{busy ? 'Processing receipts…' : 'Drop receipts here'}</strong><span>or <b>click to browse</b> from your device</span><div className="file-types"><span>JPG</span><span>PNG</span><span>WEBP</span><span>PDF</span></div><small>Up to 15 files per batch · 10 MB each · PDF max 5 pages</small>
              </div>
              <input type="file" ref={fileInput} accept={accepted} multiple hidden onChange={onSelect} disabled={busy} />
              <button className="primary full-width" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Plus size={18} />} {busy ? 'Scanning in progress' : 'Choose receipt files'} <ArrowRight size={16} /></button>
              {jobs.length > 0 && <div className="queue"><div className="queue-heading"><strong>Recent uploads</strong><span>{jobs.length} files</span></div>{jobs.slice(0, 5).map(job => <div className="queue-item" key={job.id}><div className="queue-file-icon"><FileImage size={17}/></div><div className="queue-file-info"><strong title={job.fileName}>{job.fileName}</strong><small title={job.message}>{job.message ?? (job.status === 'processing' ? 'Extracting text…' : job.status === 'queued' ? 'Queued' : job.status === 'done' ? 'Extraction complete' : 'Failed')}</small></div><span className={`queue-state ${job.status}`}>{job.status === 'done' ? <CheckCircle2 size={17} /> : job.status === 'error' ? <CircleAlert size={17}/> : job.status === 'processing' ? <LoaderCircle size={17} className="spin"/> : <Clock3 size={17}/>}</span></div>)}</div>}
            </section>

            <section className="panel steps-panel"><div className="panel-header"><div><div className="section-pretitle">THE PROCESS</div><h2>From scan to structured data</h2><p>Simple, transparent, and fully editable.</p></div><span className="auto-badge"><span className="auto-dot" /> Automated</span></div>
              <div className="step-line"><span className="step-index">01</span><div className="step-info"><strong>Upload your documents</strong><p>Add multiple image or PDF receipts in one go.</p></div><div className="step-icon"><UploadCloud size={21}/></div></div>
              <div className="step-line"><span className="step-index">02</span><div className="step-info"><strong>AI-powered text recognition</strong><p>PaddleOCR detects text and confidence scores.</p></div><div className="step-icon"><ScanLine size={21}/></div></div>
              <div className="step-line"><span className="step-index">03</span><div className="step-info"><strong>Extract &amp; verify details</strong><p>Review merchant, date, totals, tax and items.</p></div><div className="step-icon"><CheckCircle2 size={21}/></div></div>
              <div className="step-line"><span className="step-index">04</span><div className="step-info"><strong>Export structured records</strong><p>Save your reviewed receipts as CSV or JSON.</p></div><div className="step-icon"><ArrowDownToLine size={21}/></div></div>
              <div className="privacy-note"><ShieldCheck size={18}/><div><strong>Private processing</strong><span>OCR runs on your machine. No cloud OCR API or database is required.</span></div></div>
            </section>
          </div>

          <section className="panel records-panel"><div className="records-title"><div><div className="section-pretitle">STEP 02</div><h2>Extracted receipts <span className="title-count">{records.length}</span></h2><p>Review and refine the data before exporting.</p></div><div className="export-actions"><button className="secondary" onClick={exportCSV} disabled={!records.length}><FileSpreadsheet size={16}/> Export CSV</button><button className="secondary" onClick={exportJSON} disabled={!records.length}><FileJson2 size={16}/> JSON</button></div></div>
            <div className="table-toolbar"><div className="filter-tabs"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All receipts <span>{records.length}</span></button><button className={filter === 'review' ? 'selected' : ''} onClick={() => setFilter('review')}>Needs review <span>{reviewCount}</span></button><button className={filter === 'verified' ? 'selected' : ''} onClick={() => setFilter('verified')}>Verified <span>{verifiedCount}</span></button></div><div className="search-box"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search receipts…" aria-label="Search receipts" /></div></div>
            {notice && <div className="notice"><Info size={15} />{notice}<button onClick={() => setNotice('')} title="Dismiss"><X size={14}/></button></div>}
            <div className="table-wrap"><table className="receipt-table"><thead><tr><th>MERCHANT / FILE</th><th>DATE</th><th>RECEIPT #</th><th>AMOUNT</th><th>STATUS</th><th></th></tr></thead><tbody>{visible.map(r => <tr key={r.id} onClick={() => {setSelectedId(r.id);setShowRaw(false);}} className={selectedId === r.id ? 'selected-row' : ''}><td><div className="merchant-cell"><span className="merchant-icon"><FileText size={18}/></span><span><strong>{r.merchant || 'Unknown merchant'}</strong><small>{r.fileName}</small></span></div></td><td>{shortDate(r.date)}</td><td className="receipt-ref">{r.receiptNumber || '—'}</td><td className="amount-cell">{money(r.total, r.currency)}</td><td>{r.needsReview && !r.reviewed ? <span className="tag tag--review"><CircleAlert size={13}/> Needs review</span> : <span className="tag tag--verified"><Check size={13}/> Verified</span>}</td><td><ArrowRight size={16} className="table-arrow"/></td></tr>)}</tbody></table>{!visible.length && <div className="empty-state"><div className="empty-illustration"><FolderOpen size={38} strokeWidth={1.35}/></div><h3>{records.length ? 'No receipts match your filter' : 'Your receipts will appear here'}</h3><p>{records.length ? 'Try another search or status filter.' : 'Upload your first receipt to start extracting structured information.'}</p>{!records.length && <button className="text-button" onClick={() => fileInput.current?.click()}>Upload a receipt <ArrowRight size={15}/></button>}</div>}</div>
            {records.length > 0 && <div className="table-footer"><span>Showing {visible.length} of {records.length} records</span><button onClick={() => { if (window.confirm('Clear all receipt records? Any data not exported will be lost.')) { previewUrls.current.forEach(url => URL.revokeObjectURL(url)); previewUrls.current.clear(); setRecords([]); setSelectedId(null); setJobs([]); setNotice('Session cleared.'); } }}><Trash2 size={14}/> Clear session</button></div>}
          </section>

          {selected && <section className="panel review-panel"><div className="review-heading"><div><div className="section-pretitle">STEP 03 · REVIEW DETAILS</div><h2>{selected.merchant || 'Unknown merchant'}</h2><p>Compare extracted data with the original receipt. Edits stay in this session until exported.</p></div><div className="review-heading-actions"><span className="confidence-label">OCR text confidence: <strong>{Math.round(selected.ocrConfidence * 100)}%</strong></span><button className="icon-button" title="Close review" onClick={() => setSelectedId(null)}><X size={18}/></button></div></div>
            <div className="review-body"><div className="preview-column"><h3>Original document <span>{selected.pages > 1 ? `${selected.pages} pages` : 'Preview'}</span></h3><div className="preview-frame">{selected.previewUrl && selected.fileName.toLowerCase().endsWith('.pdf') ? <iframe src={selected.previewUrl} title="Receipt PDF preview"/> : selected.previewUrl ? <img src={selected.previewUrl} alt={`Original receipt: ${selected.fileName}`} /> : <FileImage size={40}/>}</div><button className="raw-toggle" onClick={() => setShowRaw(!showRaw)}><FileText size={15}/>{showRaw ? 'Hide recognized text' : 'Show recognized OCR text'}<ChevronDown size={15} className={showRaw ? 'flipped' : ''}/></button>{showRaw && <pre className="raw-text">{selected.rawText || '(No readable text found)'}</pre>}{selected.issues.length > 0 && <div className="review-alert"><CircleAlert size={18}/><div><strong>Fields to double-check</strong>{selected.issues.map(issue => <p key={issue}>· {issue}</p>)}</div></div>}</div>
              <div className="form-column"><div className="form-header"><h3>Extracted information</h3><span>Editable fields</span></div><div className="form-grid">{([['merchant','Merchant / store name'],['date','Receipt date'],['receiptNumber','Receipt / OR number'],['currency','Currency'],['paymentMethod','Payment method']] as [EditableKey,string][]).map(([key,label]) => <label className={`field ${key === 'merchant' ? 'wide' : ''}`} key={key}><span>{label}</span>{key === 'currency' ? <select value={selected.currency} onChange={e => updateReceipt({currency:e.target.value})}><option value="PHP">PHP — Philippine Peso</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="SGD">SGD — Singapore Dollar</option><option value="JPY">JPY — Japanese Yen</option></select> : <input type={key === 'date' ? 'date' : 'text'} value={selected[key]} onChange={e => updateReceipt({[key]: e.target.value})} placeholder={`Enter ${label.toLowerCase()}`}/>}</label>)}{numericFields.map(key => <label className="field" key={key}><span>{key.charAt(0).toUpperCase() + key.slice(1)}</span><div className="input-with-prefix"><span>{selected.currency}</span><input type="number" step="0.01" value={selected[key] ?? ''} onChange={e => updateReceipt({ [key]: e.target.value === '' ? null : Number(e.target.value) })} placeholder="0.00" /></div></label>)}</div>
                <div className="items-heading"><h3>Detected line items <span>{selected.items.length}</span></h3><button className="text-button" onClick={() => updateReceipt({items: [...selected.items, { description: '', quantity: 1, amount: 0 }]})}><Plus size={15}/> Add item</button></div>{selected.items.length ? <div className="items-list">{selected.items.map((item,index) => <div className="item-row" key={index}><input aria-label={`Item ${index+1} description`} value={item.description} onChange={e => updateReceipt({items: selected.items.map((old,i) => i === index ? {...old, description:e.target.value} : old)})}/><input className="item-quantity" aria-label={`Item ${index+1} quantity`} type="number" min="1" value={item.quantity} onChange={e => updateReceipt({items: selected.items.map((old,i) => i === index ? {...old, quantity: Number(e.target.value)} : old)})}/><input className="item-amount" aria-label={`Item ${index+1} amount`} type="number" step="0.01" value={item.amount} onChange={e => updateReceipt({items: selected.items.map((old,i) => i === index ? {...old, amount: Number(e.target.value)} : old)})}/><button title="Remove item" onClick={() => updateReceipt({items: selected.items.filter((_,i) => i !== index)})}><X size={15}/></button></div>)}</div> : <p className="no-items">No line items confidently detected. You can add them manually.</p>}
                <div className="review-actions"><button className="danger-outline" onClick={() => removeReceipt(selected)}><Trash2 size={15}/> Remove</button><button className="primary" onClick={() => setRecords(current => current.map(r => r.id === selected.id ? {...r, reviewed: true} : r))}><CheckCheck size={17}/>{selected.reviewed ? 'Reviewed ✓' : 'Mark as reviewed'}</button></div>
              </div>
            </div>
          </section>}
          <footer className="page-footer"><span>ReceiptFlow POC · React + Node.js + PaddleOCR</span><span><ShieldCheck size={14}/> No database · Session-only records</span></footer>
        </div>
      </main>
    </div>
  );
}
