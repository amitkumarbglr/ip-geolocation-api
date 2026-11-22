// Core use case: turn an IP into a normalised, scored lookup result.
import { parseIp, classifyIp, countryFlag } from './ip.js';
import { assessAccuracy, inferConnectionFlags } from './confidence.js';

export class GeoService {
  /**
   * @param {{ provider: { name: string, lookup: (p: {ip: string, version: number}) => Promise<any> }, cache?: { get: Function, set: Function } }} deps
   */
  constructor({ provider, cache = null, now = () => new Date() }) {
    this.provider = provider;
    this.cache = cache;
    this.now = now;
  }

  /**
   * @returns {Promise<object|null>} null when the input is not a valid IP
   */
  async lookup(input) {
    const parsed = parseIp(input);
    if (!parsed) return null;

    const classification = classifyIp(parsed);
    const base = {
      ip: parsed.ip,
      version: parsed.version,
      network: { classification },
    };

    if (classification !== 'public') {
      return {
        ...base,
        location: null,
        connection: { org: null, asn: null, flags: { vpn: false, mobile: false, hosting: false, method: 'n/a' } },
        accuracy: { level: 'none', score: 0, precision: 'none', notes: [`${classification} addresses are not geolocatable.`] },
        meta: { provider: null, cached: false, lookedUpAt: this.now().toISOString() },
      };
    }

    const cacheKey = `${parsed.version}:${parsed.ip}`;
    const cached = this.cache?.get(cacheKey);
    const raw = cached ? cached.raw : await this.provider.lookup(parsed);
    if (!cached && this.cache) this.cache.set(cacheKey, { raw, at: this.now().toISOString() });

    const location = raw
      ? {
          city: raw.city ?? null,
          region: raw.region ?? null,
          country: raw.country ?? null,
          countryCode: raw.countryCode ?? null,
          continent: raw.continent ?? null,
          latitude: raw.latitude ?? null,
          longitude: raw.longitude ?? null,
          timezone: raw.timezone ?? null,
          currency: raw.currency ?? null,
          postal: raw.postal ?? null,
          flag: countryFlag(raw.countryCode),
        }
      : null;

    const flags = inferConnectionFlags(raw?.org ?? '');
    return {
      ...base,
      location,
      connection: { org: raw?.org ?? null, asn: raw?.asn ?? null, flags },
      accuracy: assessAccuracy(location, flags),
      meta: {
        provider: this.provider.name,
        cached: Boolean(cached),
        lookedUpAt: cached ? cached.at : this.now().toISOString(),
      },
    };
  }
}
