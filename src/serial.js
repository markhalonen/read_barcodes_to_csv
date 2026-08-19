// Serial-number parsing and validation for Roberts Gordon "NAT" labels.
//
// The label carries a Code 39 barcode whose payload is the serial number
// followed by a mod-43 check character, wrapped in the Code 39 start/stop
// delimiter:
//
//     *2504-027-060-0026D*
//      \_______________/\/
//        serial (17ch)  check char
//
// Verified against sample labels IMG_5613/14/15/16: the trailing character is
// always the standard Code 39 mod-43 checksum of the serial. We gate every
// accepted scan on that checksum, which makes a false positive effectively
// impossible and lets us trust a single video frame instead of waiting for
// several frames to agree.

/** Code 39 alphabet. A character's index is its mod-43 checksum value. */
const CODE39_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

/** Serial format: nnnn-nnn-nnn-nnnn */
export const SERIAL_RE = /^\d{4}-\d{3}-\d{3}-\d{4}$/;

/**
 * Code 39 mod-43 check character for `serial`.
 * Returns null if the string contains a character outside the Code 39 set.
 */
export function checkChar(serial) {
  let sum = 0;
  for (const ch of serial) {
    const value = CODE39_ALPHABET.indexOf(ch);
    if (value === -1) return null;
    sum += value;
  }
  return CODE39_ALPHABET[sum % 43];
}

/**
 * Parse a raw Code 39 payload into a validated serial number.
 *
 * Accepts the payload with or without the `*` delimiters, since decoders differ
 * on whether they strip them.
 *
 * @returns {{serial: string, check: string} | null} null if the payload is not
 *   a well-formed, checksum-valid serial.
 */
export function parsePayload(raw) {
  if (typeof raw !== 'string') return null;

  const body = raw.trim().replace(/^\*/, '').replace(/\*$/, '').toUpperCase();
  // 17 serial characters + 1 check character.
  if (body.length !== 18) return null;

  const serial = body.slice(0, 17);
  const check = body.slice(17);

  if (!SERIAL_RE.test(serial)) return null;
  if (checkChar(serial) !== check) return null;

  return { serial, check };
}

/**
 * Validate a hand-typed serial. Manual entries have no check character to
 * verify against, so we only enforce the format — the UI marks these as
 * `manual` so they stay visually distinct from checksum-verified scans.
 *
 * Tolerates spaces and en/em dashes, which phone keyboards produce readily.
 */
export function parseManual(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/\s+/g, '').replace(/[‐-―]/g, '-');
  return SERIAL_RE.test(cleaned) ? cleaned : null;
}

/** RFC 4180 CSV field escaping. */
function csvField(value) {
  const str = String(value ?? '');
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Render scan records as CSV.
 * @param {Array<{serial: string, source: string, at: string}>} records
 */
export function toCsv(records) {
  const rows = [['serial', 'source', 'scanned_at']];
  for (const r of records) rows.push([r.serial, r.source, r.at]);
  // CRLF line endings: Excel is happiest with them, everything else copes.
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
