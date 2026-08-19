# Serial Scanner

A phone-camera scanner for the Code 39 serial-number labels on Roberts Gordon
cartons. Point the camera at the barcode, it logs the serial, and you export a
CSV. Runs entirely in the browser — static files, no backend, no uploads.

Deploy target is GitHub Pages.

## The label

```
Serial No.                                    NAT
No. de série            ║█║▌│█║▌║█│▌║█│▌║█║▌│
2504-027-060-0026          *2504-027-060-0026D*
```

- Serial format is `nnnn-nnn-nnn-nnnn` (4-3-3-4, 17 characters).
- The barcode is **Code 39**, carrying the serial plus a **mod-43 check
  character** (the trailing `D` above), wrapped in `*` delimiters.

That check character is why this app can be trusted. Every scan is verified
against it, so a misread is rejected rather than silently written to your CSV,
and a single video frame is enough — there's no waiting for several frames to
agree.

## Using it

1. Open the site on your phone and tap **Start scanning**.
2. **Fit the whole barcode inside the box**, both ends included.
3. It beeps and adds the serial. Move to the next carton.
4. Tap **Export CSV** when done.

Getting *too close* is the most common failure: if the barcode is wider than the
aim box it gets clipped and will never decode. Back off slightly.

If the barcode won't catch, tap **Barcode won't read? Read the digits** — that
runs OCR on the printed serial instead. It has no check character to verify
against, so those rows are tagged `OCR` and marked `ocr` in the CSV.

Anything that still won't read can be typed into
**Add by hand**. Typed entries are tagged `TYPED` in the list and marked
`manual` in the CSV, because they have not been checksum-verified.

That field accepts whatever you type; it never rejects input. Dashes are
optional — 14 bare digits are grouped into `nnnn-nnn-nnn-nnnn` automatically, so
it can be typed straight through. It is the fallback for labels the scanner
cannot read, so turning entries away would defeat its purpose.

Scans are saved to `localStorage` as you go, so a screen lock or an accidental
refresh will not lose the session. They stay on the device; nothing is uploaded.

### CSV output

```csv
serial,source,scanned_at
2504-027-060-0026,scan,2026-08-19T16:23:19.262Z
2504-027-060-0030,manual,2026-08-19T16:23:50.500Z
```

`source` is `scan` (checksum-verified) or `manual` (typed by hand).

## Deploying to GitHub Pages

Push to a repo and enable Pages on the branch root — there is no build step.

```bash
git init && git add -A && git commit -m "Serial scanner"
git branch -M main
git remote add origin git@github.com:USER/REPO.git
git push -u origin main
```

Then in **Settings → Pages**, set Source to *Deploy from a branch*, branch
`main`, folder `/ (root)`.

**Camera access requires HTTPS.** The GitHub Pages URL works. Opening
`index.html` from the filesystem does not — the camera will refuse to start.

## Local development

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>. `localhost` counts as a secure context, so
the camera works there too.

## How it works

| File | Role |
| --- | --- |
| `src/serial.js` | Payload parsing, mod-43 checksum, CSV generation |
| `src/decoder.js` | zxing-wasm setup and frame decoding |
| `src/ocr.js` | PaddleOCR fallback for unreadable barcodes |
| `src/camera.js` | Camera start/stop, torch, aim-box cropping |
| `src/store.js` | Scan list with `localStorage` write-through |
| `src/feedback.js` | Beeps and haptics |
| `src/app.js` | Scan loop and UI wiring |

Two details worth knowing before changing anything:

- **The app decodes only the aim box, not the whole frame.** `grabRoi` mirrors
  the `object-fit: cover` geometry of the preview so the decoded region matches
  what the box shows. The box's size in `styles.css` and `ROI` in `camera.js`
  must stay in sync.
- **The scan loop alternates decode scales** (`DECODE_WIDTHS`). Resampling thin
  Code 39 bars aliases at particular scale factors — on the sample labels a crop
  would decode at 900px and fail at 640px, or the reverse. Alternating across
  frames catches both within ~150 ms.

### Decoder

[`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) (zxing-cpp compiled to
WebAssembly), vendored under `vendor/zxing/` so the site is self-contained and
keeps working offline once cached. See `vendor/zxing/VERSION.txt` for the
version and the files it came from.

It was chosen over `@zxing/library` (the pure-JS port) and Quagga2 after
measuring all three against sample photos: on the same image zxing-wasm decoded
in ~20 ms where the JS port needed a 51-variant scale/rotation sweep and 4.7 s.

### OCR fallback

`src/ocr.js`, loaded only when the button is tapped — the runtime and models are
~38 MB, cached after the first use.

**PaddleOCR PP-OCRv4** on onnxruntime-web, chosen after measuring it against
Tesseract.js on these labels. Tesseract managed 3 correct reads out of 80
preprocessing/page-segmentation combinations; every error landed in the
double-struck last group, reading the slashed zeros as `8`. Ensembling made it
worse — the plurality answer across all 80 runs was *wrong*:

```
14x  2602-027-100-8826      <- plurality winner, wrong
 9x  2602-027-100-0826
 5x  2602-027-100-8026
 3x  2602-027-100-0026      <- correct, 4th place
```

PaddleOCR read every sample correctly from the raw frame with no preprocessing,
including the blurriest label, which no barcode decoder has ever managed.

Two things that matter if you touch this:

- **Bigger input is not better.** PP-OCRv4 rescales internally to ~960px and its
  resampling is worse than doing the downscale first. Every measured misread
  (`...100-0626`, `...080-6052`) happened at 1200px or above; everything from
  640px to 1040px was correct. Hence `OCR_WIDTHS`.
- **There is no checksum here.** OCR reads the printed digits, which carry no
  check character, and confidence is not a substitute — the misreads scored
  0.95. Instead the frame is read at three scales and a result is only returned
  when they agree. On the samples that gives 10/10 correct with nothing wrong
  accepted; a disagreement asks the user to retake rather than guessing.

## Browser support

Needs `getUserMedia` and WebAssembly: iOS Safari 15+, Chrome/Android, desktop
Chrome/Edge/Safari. Torch control is Android-only; iOS does not expose it.

The repo carries ~40 MB of vendored runtimes and models. Barcode scanning needs
only ~1 MB of that; the rest is the OCR fallback and is not fetched until you
use it.
