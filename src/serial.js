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
 * Clean up a hand-typed serial.
 *
 * Deliberately permissive: this is the fallback for labels the scanner cannot
 * read, so refusing input that doesn't match SERIAL_RE would leave no way to
 * record a damaged or unusual label. Anything non-empty is accepted and tagged
 * `manual`, which already marks it as not checksum-verified.
 *
 * Two conveniences, neither of which can reject input:
 *  - spaces and en/em dashes (what phone keyboards produce) are normalised
 *  - a bare run of 14 digits is grouped into nnnn-nnn-nnn-nnnn, so the serial
 *    can be typed on a numeric keypad without hunting for a dash key
 *
 * @returns {string | null} null only when the input is empty
 */
export function normalizeManual(input) {
  if (typeof input !== 'string') return null;

  const cleaned = input.trim().replace(/\s+/g, '').replace(/[‐-―]/g, '-');
  if (!cleaned) return null;

  const digits = cleaned.replace(/-/g, '');
  if (/^\d{14}$/.test(digits)) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}-${digits.slice(10)}`;
  }
  return cleaned;
}

/** RFC 4180 CSV field escaping. */
function csvField(value) {
  const str = String(value ?? '');
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Render scan records as CSV.
 *
 * `source` distinguishes what can be trusted: `scan` cleared the Code 39
 * checksum, while `ocr` and `manual` could not be verified and are worth a
 * glance before the CSV is relied on.
 *
 * @param {Array<{serial: string, source: string, at: string}>} records
 */
export function toCsv(records) {
  const rows = [['serial', 'source', 'scanned_at']];
  for (const r of records) rows.push([r.serial, r.source, r.at]);
  // CRLF line endings: Excel is happiest with them, everything else copes.
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
