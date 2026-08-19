import { parsePayload, parseManual, toCsv } from './serial.js';
import { initDecoder, decodeFrame } from './decoder.js';
import {
  startCamera,
  stopCamera,
  grabRoi,
  hasTorch,
  setTorch,
  DECODE_WIDTHS,
} from './camera.js';
import { ScanStore } from './store.js';
import { initFeedback, beepSuccess, beepDuplicate } from './feedback.js';

/** Minimum gap between decode attempts. ~12/s, comfortably above decode cost. */
const DECODE_INTERVAL_MS = 80;

/**
 * How long to ignore a serial after it is decoded.
 *
 * The camera stays pointed at a label for a second or so after it reads, which
 * at ~12 decodes/sec would otherwise fire a dozen duplicate beeps. Re-reading
 * the same label after this window still reports, so a deliberate rescan gives
 * feedback rather than seeming broken.
 */
const REPEAT_COOLDOWN_MS = 3000;

const el = (id) => document.getElementById(id);

const ui = {
  video: el('video'),
  frame: el('frame'),
  reticle: el('reticle'),
  hint: el('hint'),
  toast: el('toast'),
  startBtn: el('start-btn'),
  stopBtn: el('stop-btn'),
  torchBtn: el('torch-btn'),
  count: el('count'),
  list: el('list'),
  empty: el('empty'),
  manualInput: el('manual-input'),
  manualBtn: el('manual-btn'),
  manualError: el('manual-error'),
  exportBtn: el('export-btn'),
  copyBtn: el('copy-btn'),
  clearBtn: el('clear-btn'),
  error: el('error'),
};

const store = new ScanStore();
const canvas = document.createElement('canvas');

let stream = null;
let scanning = false;
let wakeLock = null;
let lastDecodeAt = 0;
let toastTimer = null;
let scaleIndex = 0;
/** serial -> performance.now() of last report, for REPEAT_COOLDOWN_MS. */
const recentlyReported = new Map();

// ---------------------------------------------------------------- rendering

function renderList() {
  const records = store.records;
  ui.count.textContent = String(records.length);
  ui.empty.hidden = records.length > 0;
  ui.exportBtn.disabled = records.length === 0;
  ui.copyBtn.disabled = records.length === 0;
  ui.clearBtn.disabled = records.length === 0;

  ui.list.replaceChildren(
    ...records.map((record, index) => {
      const row = document.createElement('li');
      row.className = 'row';

      const num = document.createElement('span');
      num.className = 'row-num';
      num.textContent = String(records.length - index);

      const serial = document.createElement('span');
      serial.className = 'row-serial';
      serial.textContent = record.serial;

      // Scans are checksum-verified; typed entries cannot be, and the list must
      // not imply otherwise. A tick is enough for the verified case and leaves
      // room for the full serial on a narrow phone.
      const tag = document.createElement('span');
      const verified = record.source === 'scan';
      tag.className = `row-tag row-tag--${record.source}`;
      tag.textContent = verified ? '✓' : 'typed';
      tag.title = verified ? 'Checksum verified' : 'Entered by hand — not checksum verified';
      tag.setAttribute('aria-label', tag.title);

      const remove = document.createElement('button');
      remove.className = 'row-remove';
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${record.serial}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        store.remove(record.serial);
        // Drop the cooldown too, so deleting a row and immediately rescanning
        // that label works instead of silently doing nothing.
        recentlyReported.delete(record.serial);
      });

      row.append(num, serial, tag, remove);
      return row;
    }),
  );
}

function toast(message, kind = 'ok') {
  ui.toast.textContent = message;
  ui.toast.className = `toast toast--${kind} toast--visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('toast--visible'), 1600);
}

function flash(kind) {
  ui.reticle.classList.remove('reticle--hit', 'reticle--dup');
  // Force reflow so the animation restarts on consecutive scans.
  void ui.reticle.offsetWidth;
  ui.reticle.classList.add(kind === 'duplicate' ? 'reticle--dup' : 'reticle--hit');
}

function showError(message) {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

// ------------------------------------------------------------------ capture

function recordSerial(serial, source) {
  const result = store.add(serial, source);
  if (result === 'duplicate') {
    flash('duplicate');
    beepDuplicate();
    toast(`Already scanned · ${serial}`, 'dup');
  } else {
    flash('hit');
    beepSuccess();
    toast(`Captured · ${serial}`, 'ok');
  }
  return result;
}

async function tick() {
  if (!scanning) return;

  const now = performance.now();
  if (now - lastDecodeAt >= DECODE_INTERVAL_MS) {
    lastDecodeAt = now;
    try {
      // Alternate decode scales frame to frame; see DECODE_WIDTHS.
      const width = DECODE_WIDTHS[scaleIndex++ % DECODE_WIDTHS.length];
      const frame = grabRoi(ui.video, canvas, width);
      if (frame) {
        for (const payload of await decodeFrame(frame)) {
          // Every accepted scan clears the Code 39 mod-43 checksum, so a
          // single frame is enough — no multi-frame agreement needed.
          const parsed = parsePayload(payload);
          if (!parsed) continue;

          const seenAt = recentlyReported.get(parsed.serial);
          if (seenAt !== undefined && now - seenAt < REPEAT_COOLDOWN_MS) continue;
          recentlyReported.set(parsed.serial, now);
          recordSerial(parsed.serial, 'scan');
        }
      }
    } catch (err) {
      console.error('decode failed', err);
    }
  }

  scheduleTick();
}

function scheduleTick() {
  if (!scanning) return;
  // requestVideoFrameCallback fires once per decoded video frame, which avoids
  // decoding the same frame twice. Safari 15.4+ and Chrome have it.
  if (typeof ui.video.requestVideoFrameCallback === 'function') {
    ui.video.requestVideoFrameCallback(() => tick());
  } else {
    requestAnimationFrame(() => tick());
  }
}

async function requestWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    // Not fatal — the screen may just dim while scanning.
  }
}

async function start() {
  showError('');
  ui.startBtn.disabled = true;
  ui.startBtn.textContent = 'Starting…';

  // Must happen inside the tap gesture or mobile browsers block audio.
  initFeedback();

  try {
    // Warm the wasm while the camera permission prompt is up.
    const decoderReady = initDecoder();
    stream = await startCamera(ui.video);
    await decoderReady;

    scanning = true;
    ui.frame.classList.add('frame--live');
    ui.startBtn.hidden = true;
    ui.stopBtn.hidden = false;
    // Both ends of the barcode, quiet zones included, must sit inside the box:
    // testing showed a barcode wider than the box is clipped and never decodes.
    ui.hint.textContent = 'Fit the whole barcode inside the box.';
    ui.torchBtn.hidden = !hasTorch(stream);
    ui.torchBtn.setAttribute('aria-pressed', 'false');

    requestWakeLock();
    scheduleTick();
  } catch (err) {
    console.error(err);
    showError(describeCameraError(err));
    ui.startBtn.hidden = false;
  } finally {
    ui.startBtn.disabled = false;
    ui.startBtn.textContent = 'Start scanning';
  }
}

function describeCameraError(err) {
  if (!window.isSecureContext) {
    return 'Camera access needs HTTPS. Open the GitHub Pages URL, not a file:// path.';
  }
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Camera permission was denied. Allow camera access for this site in your browser settings, then reload.';
    case 'NotFoundError':
      return 'No camera found on this device.';
    case 'NotReadableError':
      return 'The camera is in use by another app. Close it and try again.';
    default:
      return err?.message || 'Could not start the camera.';
  }
}

function stop() {
  scanning = false;
  stopCamera(stream);
  stream = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;

  ui.video.srcObject = null;
  ui.frame.classList.remove('frame--live');
  ui.startBtn.hidden = false;
  ui.stopBtn.hidden = true;
  ui.torchBtn.hidden = true;
  ui.hint.textContent = 'Camera off.';
}

// ------------------------------------------------------------------- export

function csvFilename() {
  // Local date, not the ISO/UTC one — a scan session is a local-time event.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `serials-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}

function exportCsv() {
  const csv = toCsv(store.records.slice().reverse()); // chronological
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = csvFilename();
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copySerials() {
  const text = store.records
    .slice()
    .reverse()
    .map((r) => r.serial)
    .join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${store.size} serial${store.size === 1 ? '' : 's'}`, 'ok');
  } catch {
    toast('Copy failed — use Export CSV', 'err');
  }
}

// -------------------------------------------------------------------- manual

function submitManual() {
  const serial = parseManual(ui.manualInput.value);
  if (!serial) {
    ui.manualError.textContent = 'Expected format: 2504-027-060-0026';
    ui.manualError.hidden = false;
    return;
  }
  ui.manualError.hidden = true;
  const result = recordSerial(serial, 'manual');
  if (result === 'added') ui.manualInput.value = '';
}

// ---------------------------------------------------------------------- init

ui.startBtn.addEventListener('click', start);
ui.stopBtn.addEventListener('click', stop);

ui.torchBtn.addEventListener('click', async () => {
  const on = ui.torchBtn.getAttribute('aria-pressed') === 'true';
  if (await setTorch(stream, !on)) {
    ui.torchBtn.setAttribute('aria-pressed', String(!on));
  }
});

ui.manualBtn.addEventListener('click', submitManual);
ui.manualInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitManual();
});
ui.manualInput.addEventListener('input', () => {
  ui.manualError.hidden = true;
});

ui.exportBtn.addEventListener('click', exportCsv);
ui.copyBtn.addEventListener('click', copySerials);
ui.clearBtn.addEventListener('click', () => {
  if (confirm(`Delete all ${store.size} scanned serials? This cannot be undone.`)) {
    store.clear();
    recentlyReported.clear();
  }
});

// Releasing the camera when the tab is hidden avoids iOS killing the stream in
// a way that leaves a frozen frame on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scanning) stop();
});

// The wake lock is dropped when the page is backgrounded; take it again.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && scanning && !wakeLock) requestWakeLock();
});

store.addEventListener('change', renderList);
renderList();
