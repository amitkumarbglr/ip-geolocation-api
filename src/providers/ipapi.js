// Live provider that calls a public IP geolocation HTTP API (ipapi.co by default).
// Swap the URL or implement another class with the same `lookup(parsed)` method.
// Free tiers are rate limited; check the provider's terms before commercial use.

export class IpapiProvider {
  name = 'ipapi';

  constructor({ baseUrl = 'https://ipapi.co', timeoutMs = 3000, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async lookup(parsed) {
    const res = await this.fetch(`${this.baseUrl}/${encodeURIComponent(parsed.ip)}/json/`, {
      headers: { accept: 'application/json', 'user-agent': 'ip-geolocation-api-showcase/1.0' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (res.status === 429) {
      const err = new Error('Upstream geolocation provider rate limit reached');
      err.code = 'UPSTREAM_RATE_LIMIT';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Upstream geolocation provider returned HTTP ${res.status}`);
      err.code = 'UPSTREAM_ERROR';
      throw err;
    }

    const data = await res.json();
    if (data.error) return null; // e.g. reserved or unknown address

    return {
      city: data.city || null,
      region: data.region || null,
      country: data.country_name || null,
      countryCode: data.country_code || null,
      continent: data.continent_code || null,
      latitude: typeof data.latitude === 'number' ? data.latitude : null,
      longitude: typeof data.longitude === 'number' ? data.longitude : null,
      timezone: data.timezone || null,
      currency: data.currency || null,
      postal: data.postal || null,
      org: data.org || null,
      asn: data.asn || null,
      network: data.network || null,
    };
  }
}
