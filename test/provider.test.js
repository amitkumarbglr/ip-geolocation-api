import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IpapiProvider } from '../src/providers/ipapi.js';
import { parseIp } from '../src/ip.js';

const ip = parseIp('8.8.8.8');

test('ipapi provider maps the upstream payload to the internal shape', async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({
      city: 'Mountain View', region: 'California', country_name: 'United States', country_code: 'US',
      continent_code: 'NA', latitude: 37.4, longitude: -122.1, timezone: 'America/Los_Angeles',
      currency: 'USD', postal: '94043', org: 'GOOGLE', asn: 'AS15169', network: '8.8.8.0/24',
    }), { status: 200 });
  };
  const provider = new IpapiProvider({ baseUrl: 'https://geo.example/', fetchImpl });
  const out = await provider.lookup(ip);
  assert.equal(requestedUrl, 'https://geo.example/8.8.8.8/json/');
  assert.equal(out.city, 'Mountain View');
  assert.equal(out.countryCode, 'US');
  assert.equal(out.latitude, 37.4);
  assert.equal(out.asn, 'AS15169');
});

test('ipapi provider returns null for upstream error payloads', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: true, reason: 'Reserved IP' }), { status: 200 });
  assert.equal(await new IpapiProvider({ fetchImpl }).lookup(ip), null);
});

test('ipapi provider surfaces 429 and 5xx as typed errors', async () => {
  const limited = new IpapiProvider({ fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(limited.lookup(ip), { code: 'UPSTREAM_RATE_LIMIT' });
  const broken = new IpapiProvider({ fetchImpl: async () => new Response('', { status: 503 }) });
  await assert.rejects(broken.lookup(ip), { code: 'UPSTREAM_ERROR' });
});
