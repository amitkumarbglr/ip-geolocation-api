// Small in-memory TTL cache with a size cap (oldest entry evicted first).
export class TtlCache {
  constructor({ ttlMs = 3600_000, maxEntries = 10_000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
  }

  get size() {
    return this.map.size;
  }
}
