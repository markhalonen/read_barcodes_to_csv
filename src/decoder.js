// Barcode decoding via zxing-wasm (zxing-cpp compiled to WebAssembly).
//
// The library is vendored under vendor/zxing/ so the site is self-contained on
// GitHub Pages — no CDN dependency, and it keeps working offline once the
// browser has cached the ~1 MB wasm.

import { readBarcodes, prepareZXingModule } from '../vendor/zxing/reader/index.js';

const WASM_URL = new URL('../vendor/zxing/zxing_reader.wasm', import.meta.url).href;

/**
 * Decoder options.
 *
 * `tryRotate` is off: the aim box is a wide horizontal slot, so the barcode is
 * always roughly level, and skipping the rotated passes keeps each frame fast.
 * `tryDownscale` is on because on the sample photos the barcode frequently
 * decoded at a smaller scale than the native one.
 */
const READER_OPTIONS = {
  formats: ['Code39'],
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
};

let readyPromise = null;

/** Fetch and instantiate the wasm module. Safe to call repeatedly. */
export function initDecoder() {
  readyPromise ??= prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) },
    fireImmediately: true,
  });
  return readyPromise;
}

/**
 * Decode Code 39 symbols from an ImageData frame.
 * @returns {Promise<string[]>} raw payload texts (may be empty)
 */
export async function decodeFrame(imageData) {
  await initDecoder();
  const results = await readBarcodes(imageData, READER_OPTIONS);
  return results.map((r) => r.text);
}
