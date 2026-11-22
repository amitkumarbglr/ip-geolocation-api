import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainLookup, templateExplanation, DEFAULT_MODEL } from '../src/ai.js';

const sample = {
  ip: '8.8.8.8',
  network: { classification: 'public' },
  location: { city: 'Mountain View', region: 'California', country: 'United States', latitude: 37.3, longitude: -122.0 },
  connection: { org: 'Google LLC', asn: 'AS15169', flags: { vpn: false, mobile: true, hosting: false, method: 'heuristic-org-name' } },
  accuracy: { level: 'medium', score: 50, precision: 'city', notes: [] },
};

test('template explanation mentions location, precision and risky connection flags', () => {
  const text = templateExplanation(sample);
  assert.match(text, /Mountain View, California, United States/);
  assert.match(text, /city-level/);
  assert.match(text, /mobile/);
});

test('template explanation handles non-geolocatable addresses', () => {
  const text = templateExplanation({ ...sample, ip: '10.0.0.1', location: null, network: { classification: 'private' } });
  assert.match(text, /cannot be geolocated/);
});

test('without an API key the template is used and no network call is made', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  const out = await explainLookup(sample, { apiKey: '', fetchImpl });
  assert.equal(out.source, 'template');
  assert.equal(called, false);
});

test('with an API key the model response is returned and the request is well formed', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'It is in California.' }] }), { status: 200 });
  };
  const out = await explainLookup(sample, { apiKey: 'test-key', fetchImpl });
  assert.equal(out.source, 'model');
  assert.equal(out.text, 'It is in California.');
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.init.headers['x-api-key'], 'test-key');
  assert.equal(captured.body.model, DEFAULT_MODEL);
  assert.equal(captured.body.messages[0].content, JSON.stringify(sample));
});

test('model failures fall back to the template with a reason', async () => {
  const fetchImpl = async () => new Response('boom', { status: 500 });
  const out = await explainLookup(sample, { apiKey: 'test-key', fetchImpl });
  assert.equal(out.source, 'template');
  assert.match(out.reason, /HTTP 500/);
});
