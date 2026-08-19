// Text fallback for labels the barcode decoder cannot read.
//
// PaddleOCR PP-OCRv4 via onnxruntime-web. Chosen after measuring it against
// Tesseract.js on the sample labels: the serials are printed in a font with
// slashed zeros and the last group is often double-struck, which Tesseract
// misread as 8 in 77 of 80 preprocessing/page-segmentation combinations —
// and ensemble voting across those combinations landed on a *wrong* answer.
// PaddleOCR read every sample correctly from the raw frame, no preprocessing.
//
// Everything here is loaded lazily. The models and runtime are ~38 MB, so
// nothing is fetched until the user actually asks for a text read.

const BASE = new URL('../vendor/ocr/', import.meta.url).href;

/**
 * Widths the frame is read at.
 *
 * Not "as large as possible": PP-OCRv4's detector rescales its input to a
 * ~960px longest side internally, and its own resampling is worse than doing
 * the downscale ourselves. Feeding it a 1920px frame made it misread the
 * blurriest sample as `...080-6052` — confidently, at 0.95.
 *
 * Three widths rather than one because there is no check character here to
 * validate against. Reading at several scales and requiring the answers to
 * agree is the closest available substitute.
 *
 * The widths sit in the band that measured clean: across the sample labels
 * every read between 640px and 1040px was correct, while every misread
 * (`...100-0626`, `...080-6052`) happened at 1200px or above.
 */
const OCR_WIDTHS = [800, 900, 1000];

let ocrPromise = null;

/**
 * Load the runtime and models. Safe to call repeatedly; the work happens once.
 * @param {(stage: string) => void} [onProgress]
 */
export function initOcr(onProgress) {
  ocrPromise ??= (async () => {
    onProgress?.('Loading text reader…');
    const { Ocr, ortEnv } = await import(`${BASE}ocr.bundle.mjs`);

    // SharedArrayBuffer requires COOP/COEP headers that GitHub Pages cannot
    // send, so multi-threading would fail to initialise. Ask for one thread.
    ortEnv.wasm.numThreads = 1;
    ortEnv.wasm.wasmPaths = BASE;

    onProgress?.('Loading models…');
    return Ocr.create({
      models: {
        detectionPath: `${BASE}models/ch_PP-OCRv4_det_infer.onnx`,
        recognitionPath: `${BASE}models/ch_PP-OCRv4_rec_infer.onnx`,
        classifierPath: `${BASE}models/ch_ppocr_mobile_v2.0_cls_infer.onnx`,
        dictionaryPath: `${BASE}models/ppocr_keys_v1.txt`,
      },
    });
  })().catch((err) => {
    ocrPromise = null; // let a later attempt retry rather than failing forever
    throw err;
  });
  return ocrPromise;
}

/** Serial as printed on the label: nnnn-nnn-nnn-nnnn. */
const SERIAL_RE = /\d{4}-\d{3}-\d{3}-\d{4}/;

/**
 * OCR one rendering of the frame and return the line shaped like a serial.
 *
 * The label also carries a part number and a French caption, so we cannot take
 * the highest-confidence line — it is matched on the serial's shape.
 */
async function readOnce(ocr, source, width) {
  const scaled = document.createElement('canvas');
  scaled.width = width;
  scaled.height = Math.max(1, Math.round((source.height * width) / source.width));
  const ctx = scaled.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, scaled.width, scaled.height);

  // ImageRaw.open() takes a URL, so hand it the frame as a data URL.
  const lines = await ocr.detect(scaled.toDataURL('image/jpeg', 0.92));
  for (const line of lines) {
    const match = line.text.replace(/\s+/g, '').match(SERIAL_RE);
    if (match) return { serial: match[0], confidence: line.mean ?? line.score ?? 0 };
  }
  return null;
}

/**
 * Read the printed serial from a frame.
 *
 * Reads at several scales and only returns a result when every scale that read
 * anything agrees. A disagreement means the frame is marginal, and returning
 * nothing sends the user back for a better shot — far better than handing them
 * a plausible wrong serial, which is precisely how OCR fails on these labels.
 *
 * @param {HTMLCanvasElement} source frame to read, at native ROI resolution
 * @returns {Promise<{serial: string, confidence: number, agreed: number} | null>}
 */
export async function readSerial(source, onProgress) {
  const ocr = await initOcr(onProgress);
  onProgress?.('Reading…');

  const reads = [];
  for (const width of OCR_WIDTHS) {
    const result = await readOnce(ocr, source, width);
    if (result) reads.push(result);
  }
  if (!reads.length) return null;

  const distinct = new Set(reads.map((r) => r.serial));
  if (distinct.size > 1) return null; // scales disagree — don't guess

  return {
    serial: reads[0].serial,
    confidence: Math.max(...reads.map((r) => r.confidence)),
    agreed: reads.length,
  };
}
