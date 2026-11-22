import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';

let server;
let base;

// Offline run: static provider, no AI key, generous rate limit.
before(async () => {
  const started = await startServer({ port: 0, host: '127.0.0.1', geoProvider: 'static', anthropicApiKey: '', rateLimitPerMinute: 1000 }, {});
  server = started.server;
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('GET /health reports ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /api/v1/ip/:ip returns a geolocation for a known public IP', async () => {
  const res = await fetch(`${base}/api/v1/ip/8.8.8.8`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.location.city, 'Mountain View');
  assert.equal(body.location.countryCode, 'US');
  assert.equal(body.accuracy.level, 'medium');
  assert.ok(body.connection.flags);
});

test('GET /api/v1/ip/:ip returns 400 for an invalid address', async () => {
  const res = await fetch(`${base}/api/v1/ip/not-an-ip`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_IP');
});

test('private addresses return 200 with no location', async () => {
  const body = await (await fetch(`${base}/api/v1/ip/10.0.0.5`)).json();
  assert.equal(body.location, null);
  assert.equal(body.network.classification, 'private');
});

test('GET /api/v1/ip/me resolves the caller address (loopback here, so no location)', async () => {
  const body = await (await fetch(`${base}/api/v1/ip/me`)).json();
  assert.equal(body.network.classification, 'loopback');
});

test('POST /api/v1/ip/batch returns one result per IP and marks invalid ones', async () => {
  const res = await fetch(`${base}/api/v1/ip/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ips: ['8.8.8.8', 'bogus', '2001:4860:4860::8888'] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 3);
  assert.equal(body.results[0].location.city, 'Mountain View');
  assert.equal(body.results[1].error, 'INVALID_IP');
  assert.equal(body.results[2].ip, '2001:4860:4860::8888');
});

test('batch rejects empty, oversized and malformed bodies', async () => {
  const post = (body, raw = false) => fetch(`${base}/api/v1/ip/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
  assert.equal((await post({ ips: [] })).status, 400);
  assert.equal((await post({ ips: Array(51).fill('8.8.8.8') })).status, 413);
  assert.equal((await post('{nope', true)).status, 400);
});

test('POST /explain falls back to a template when no API key is configured', async () => {
  const res = await fetch(`${base}/api/v1/ip/8.8.8.8/explain`, { method: 'POST' });
  assert.equal(res.status, 200);
  const { explanation } = await res.json();
  assert.equal(explanation.source, 'template');
  assert.match(explanation.text, /Mountain View/);
});

test('method and route errors are JSON', async () => {
  assert.equal((await fetch(`${base}/api/v1/ip/8.8.8.8`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${base}/api/v1/ip/batch`)).status, 405);
  assert.equal((await fetch(`${base}/api/v2/whatever`)).status, 404);
});

test('static files are served and path traversal is blocked', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /<!doctype html>/i);
  assert.equal((await fetch(`${base}/styles.css`)).status, 200);
  assert.equal((await fetch(`${base}/missing.txt`)).status, 404);
  const traversal = await fetch(`${base}/..%2F..%2Fpackage.json`);
  assert.notEqual(traversal.status, 200);
});

test('rate limiting returns 429 with retry-after once the window is used up', async () => {
  const limited = await startServer({ port: 0, host: '127.0.0.1', geoProvider: 'static', rateLimitPerMinute: 2 }, {});
  const url = `http://127.0.0.1:${limited.server.address().port}/api/v1/ip/8.8.8.8`;
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const blocked = await fetch(url);
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally {
    await new Promise((resolve) => limited.server.close(resolve));
  }
});
