"""Adapter-only tests; do not initialize/download any PaddleOCR model."""
import io
import unittest
from types import SimpleNamespace

from PIL import Image
from service import decode_images, parse_ocr_result


class DummyResult:
    json = {"res": {
        "rec_texts": ["CAFE MAHOGANY", "GRAND TOTAL", "470.00"],
        "rec_scores": [.98, .94, .96],
        "rec_boxes": [[5, 5, 160, 35], [5, 100, 170, 130], [180, 100, 260, 130]],
    }}


class OcrAdapterTests(unittest.TestCase):
    def test_groups_neighboring_boxes_into_a_line(self):
        lines = parse_ocr_result(DummyResult(), 1)
        self.assertEqual(lines[0]["text"], "CAFE MAHOGANY")
        self.assertEqual(lines[1]["text"], "GRAND TOTAL 470.00")
        self.assertEqual(lines[1]["page"], 1)

    def test_image_decoder_reads_real_png_bytes(self):
        stream = io.BytesIO()
        Image.new("RGB", (64, 96), "white").save(stream, format="PNG")
        result = decode_images(stream.getvalue(), "test.png")
        self.assertEqual(result[0].shape, (96, 64, 3))


if __name__ == '__main__':
    unittest.main()
