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

Anything that won't read — a scuffed or out-of-focus label — can be typed into
**Add by hand**. Typed entries are tagged `TYPED` in the list and marked
`manual` in the CSV, because they have not been checksum-verified.

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

### Why there is no OCR fallback

An earlier version read the printed digits with Tesseract when the barcode
failed. It was removed: the labels use slashed zeros (Ø), which Tesseract
misread as `8` — turning `2602-027-080-0052` into `2602-027-080-8052`. The
checksum caught it, but a fallback that is usually wrong is not a fallback. In
live scanning a bad frame costs nothing, so retrying and typing the rare
unreadable label is both simpler and more trustworthy.

Note that badly out-of-focus labels may not decode at all — no free decoder read
the blurriest sample in 300+ preprocessing variants. Type those by hand.

## Browser support

Needs `getUserMedia` and WebAssembly: iOS Safari 15+, Chrome/Android, desktop
Chrome/Edge/Safari. Torch control is Android-only; iOS does not expose it.
