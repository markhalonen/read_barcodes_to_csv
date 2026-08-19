// Scan list with localStorage persistence.
//
// A session is 50-100 boxes walked around a warehouse; a screen lock, an
// accidental swipe, or Safari evicting a background tab must not lose it. Every
// mutation writes through to localStorage immediately.

const STORAGE_KEY = 'serial-scanner.scans.v1';

/** @typedef {{serial: string, source: 'scan'|'manual', at: string}} Record */

export class ScanStore extends EventTarget {
  #records = [];

  constructor() {
    super();
    this.#records = this.#load();
  }

  #load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (r) => r && typeof r.serial === 'string' && typeof r.at === 'string',
      );
    } catch {
      // Corrupt or unavailable storage (private mode, quota) — start empty
      // rather than breaking the app.
      return [];
    }
  }

  #persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#records));
    } catch {
      // Out of quota or storage disabled. The in-memory list still works for
      // this session, so keep going rather than throwing mid-scan.
    }
    this.dispatchEvent(new Event('change'));
  }

  /** Newest first — the most recent scan is what the user wants to see. */
  get records() {
    return [...this.#records].reverse();
  }

  get size() {
    return this.#records.length;
  }

  has(serial) {
    return this.#records.some((r) => r.serial === serial);
  }

  /**
   * Add a serial.
   * @returns {'added' | 'duplicate'}
   */
  add(serial, source) {
    if (this.has(serial)) return 'duplicate';
    this.#records.push({ serial, source, at: new Date().toISOString() });
    this.#persist();
    return 'added';
  }

  remove(serial) {
    const next = this.#records.filter((r) => r.serial !== serial);
    if (next.length === this.#records.length) return false;
    this.#records = next;
    this.#persist();
    return true;
  }

  clear() {
    this.#records = [];
    this.#persist();
  }
}
