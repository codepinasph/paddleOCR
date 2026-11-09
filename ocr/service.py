"""PaddleOCR 3.x CPU service. Files are processed in memory, without a database."""

import asyncio
import io
import logging
import os
from typing import Any

import fitz
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger("receiptflow.ocr")
app = FastAPI(title="ReceiptFlow OCR", docs_url="/docs")
ocr_model: Any = None
model_lock = asyncio.Lock()  # One OCR operation at a time on the CPU
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 5
MAX_PIXELS = 20_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def load_ocr() -> Any:
    global ocr_model
    if ocr_model is None:
        from paddleocr import PaddleOCR

        # Select a named version so future PaddleOCR default changes don't alter the POC.
        ocr_model = PaddleOCR(
            ocr_version=os.getenv("OCR_VERSION", "PP-OCRv5"),
            lang="en",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device="cpu",
        )
    return ocr_model


def decode_images(content: bytes, file_name: str) -> list[np.ndarray]:
    if content.startswith(b"%PDF-"):
        try:
            with fitz.open(stream=content, filetype="pdf") as doc:
                if doc.needs_pass:
                    raise HTTPException(400, "Password-protected PDFs are not supported.")
                if not (1 <= doc.page_count <= MAX_PAGES):
                    raise HTTPException(400, f"PDF must contain 1 to {MAX_PAGES} pages.")
                images = []
                for page in doc:
                    # Scale down large pages to protect POC memory.
                    scale = min(2.0, (MAX_PIXELS / max(1, page.rect.width * page.rect.height)) ** .5)
                    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
                    images.append(rgb[:, :, ::-1].copy())  # RGB -> OpenCV BGR
                return images
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, "Cannot read the uploaded PDF.") from exc

    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"}:
                raise HTTPException(415, "Unsupported image format.")
            image = ImageOps.exif_transpose(image)
            if image.width * image.height > MAX_PIXELS:
                raise HTTPException(413, "Image exceeds the 20 MP limit.")
            rgb = np.array(image.convert("RGB"), dtype=np.uint8)
            return [rgb[:, :, ::-1].copy()]
    except HTTPException:
        raise
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Image cannot be decoded.") from exc


def parse_ocr_result(result: Any, page_num: int) -> list[dict[str, Any]]:
    """Normalize OCRResult.json (PaddleOCR 3.x) into ordered, editable text lines."""
    data = result.json
    if "res" in data:
        data = data["res"]
    texts = data.get("rec_texts", [])
    scores = data.get("rec_scores", [])
    boxes = data.get("rec_boxes", [])
    tokens = []
    for i, value in enumerate(texts):
        text = str(value).strip()
        if not text:
            continue
        score = float(scores[i]) if i < len(scores) else 0.0
        box = boxes[i] if i < len(boxes) else None
        top = float(box[1]) if box is not None else i * 100
        bottom = float(box[3]) if box is not None else top + 20
        left = float(box[0]) if box is not None else 0
        tokens.append({"text": text, "confidence": score, "top": top,
                       "left": left, "center": (top + bottom) / 2, "height": max(1, bottom - top)})

    tokens.sort(key=lambda token: (token["center"], token["left"]))
    rows: list[list[dict[str, Any]]] = []
    for token in tokens:
        if rows and abs(token["center"] - sum(t["center"] for t in rows[-1]) / len(rows[-1])) <= max(8, token["height"] * .48):
            rows[-1].append(token)
        else:
            rows.append([token])
    lines = []
    for row in rows:
        row.sort(key=lambda token: token["left"])
        lines.append({
            "text": " ".join(token["text"] for token in row),
            "confidence": round(sum(token["confidence"] for token in row) / len(row), 4),
            "page": page_num,
        })
    return lines


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "modelLoaded": ocr_model is not None}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(MAX_BYTES + 1)
    await file.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Maximum receipt size is 10 MB.")
    if not data:
        raise HTTPException(400, "Empty upload.")
    images = decode_images(data, file.filename or "receipt")
    all_lines: list[dict[str, Any]] = []
    try:
        async with model_lock:
            model = await asyncio.to_thread(load_ocr)
            for page_num, image in enumerate(images, 1):
                results = await asyncio.to_thread(model.predict, image)
                for result in results:
                    all_lines.extend(parse_ocr_result(result, page_num))
    except Exception as exc:
        logger.exception("OCR processing failed for uploaded file")
        raise HTTPException(500, "PaddleOCR processing failed. See OCR server logs.") from exc
    return {
        "lines": all_lines,
        "rawText": "\n".join(row["text"] for row in all_lines),
        "avgConfidence": round(sum(row["confidence"] for row in all_lines) / len(all_lines), 4) if all_lines else 0,
        "pages": len(images),
    }
