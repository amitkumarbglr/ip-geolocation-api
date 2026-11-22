// Offline provider backed by a bundled JSON file of CIDR ranges.
// The bundled data is ILLUSTRATIVE ONLY. It exists so the API runs without
// network access and so tests are deterministic. Use a real database in production.
import { readFile } from 'node:fs/promises';
import { cidrContains } from '../ip.js';

export class StaticProvider {
  name = 'static';

  /** @param {Array<object>} ranges entries with a `cidr` key plus location fields */
  constructor(ranges) {
    this.ranges = ranges;
  }

  static async fromFile(path) {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return new StaticProvider(raw);
  }

  async lookup(parsed) {
    // Most specific (longest prefix) range wins.
    let best = null;
    for (const range of this.ranges) {
      if (!cidrContains(range.cidr, parsed)) continue;
      const len = Number(range.cidr.split('/')[1] ?? 0);
      if (!best || len > best.len) best = { len, range };
    }
    if (!best) return null;
    const { cidr, ...location } = best.range;
    return { ...location, network: cidr, org: location.org ?? null, asn: location.asn ?? null };
  }
}
