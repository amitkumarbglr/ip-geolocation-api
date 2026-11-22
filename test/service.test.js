import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeoService } from '../src/service.js';
import { TtlCache } from '../src/cache.js';
import { StaticProvider } from '../src/providers/static.js';
import { assessAccuracy, inferConnectionFlags } from '../src/confidence.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dataPath = fileURLToPath(new URL('../src/data/sample-ranges.json', import.meta.url));
const ranges = JSON.parse(await readFile(dataPath, 'utf8'));

test('static provider returns the most specific matching range', async () => {
  const provider = new StaticProvider([
    { cidr: '10.0.0.0/8', city: 'Wide', country: 'X', countryCode: 'XX' },
    { cidr: '10.1.0.0/16', city: 'Narrow', country: 'X', countryCode: 'XX' },
  ]);
  const hit = await provider.lookup({ ip: '10.1.2.3', version: 4 });
  assert.equal(hit.city, 'Narrow');
  assert.equal(hit.network, '10.1.0.0/16');
  assert.equal(await provider.lookup({ ip: '11.0.0.1', version: 4 }), null);
});

test('service returns a full result for a public IP from the static dataset', async () => {
  const service = new GeoService({ provider: new StaticProvider(ranges), now: () => new Date('2026-01-01T00:00:00Z') });
  const r = await service.lookup('8.8.8.8');
  assert.equal(r.ip, '8.8.8.8');
  assert.equal(r.version, 4);
  assert.equal(r.network.classification, 'public');
  assert.equal(r.location.city, 'Mountain View');
  assert.equal(r.location.countryCode, 'US');
  assert.equal(r.location.flag, '\u{1F1FA}\u{1F1F8}');
  assert.equal(r.accuracy.precision, 'city');
  assert.equal(r.accuracy.level, 'medium');
  assert.equal(r.meta.provider, 'static');
  assert.equal(r.meta.cached, false);
  assert.equal(r.meta.lookedUpAt, '2026-01-01T00:00:00.000Z');
});

test('service returns null location for private addresses without calling the provider', async () => {
  let calls = 0;
  const provider = { name: 'spy', lookup: async () => { calls += 1; return null; } };
  const service = new GeoService({ provider });
  const r = await service.lookup('192.168.1.1');
  assert.equal(r.location, null);
  assert.equal(r.accuracy.level, 'none');
  assert.equal(calls, 0);
});

test('service returns null for invalid input', async () => {
  const service = new GeoService({ provider: new StaticProvider(ranges) });
  assert.equal(await service.lookup('not-an-ip'), null);
});

test('service caches provider results', async () => {
  let calls = 0;
  const provider = { name: 'spy', lookup: async () => { calls += 1; return { country: 'Japan', countryCode: 'JP' }; } };
  const service = new GeoService({ provider, cache: new TtlCache({ ttlMs: 60_000 }) });
  const first = await service.lookup('203.0.114.5');
  const second = await service.lookup('203.0.114.5');
  assert.equal(calls, 1);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
});

test('TtlCache expires entries and caps its size', () => {
  let t = 0;
  const cache = new TtlCache({ ttlMs: 100, maxEntries: 2, now: () => t });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3); // evicts 'a'
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('c'), 3);
  t = 101;
  assert.equal(cache.get('b'), undefined);
});

test('connection flags are inferred from the org name', () => {
  assert.equal(inferConnectionFlags('NordVPN S.A.').vpn, true);
  assert.equal(inferConnectionFlags('Verizon Wireless').mobile, true);
  assert.equal(inferConnectionFlags('DigitalOcean LLC').hosting, true);
  assert.deepEqual(
    (({ vpn, mobile, hosting }) => ({ vpn, mobile, hosting }))(inferConnectionFlags('Example Broadband')),
    { vpn: false, mobile: false, hosting: false },
  );
});

test('accuracy drops for VPN, mobile and hosting and reports none without data', () => {
  const loc = { city: 'Paris', region: 'IDF', country: 'France', latitude: 48.8, longitude: 2.3 };
  const base = assessAccuracy(loc, { vpn: false, mobile: false, hosting: false });
  const vpn = assessAccuracy(loc, { vpn: true, mobile: false, hosting: false });
  assert.equal(base.precision, 'city');
  assert.ok(vpn.score < base.score);
  assert.equal(assessAccuracy(null).level, 'none');

  const countryOnly = assessAccuracy({ country: 'France', countryCode: 'FR' });
  assert.equal(countryOnly.precision, 'country');
  assert.equal(countryOnly.level, 'high');
});
