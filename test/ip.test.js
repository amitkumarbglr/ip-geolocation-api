import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIp, classifyIp, cidrContains, countryFlag, ipv6Words, unmapIp } from '../src/ip.js';

test('parseIp accepts IPv4 and IPv6 and rejects junk', () => {
  assert.deepEqual(parseIp(' 8.8.8.8 '), { ip: '8.8.8.8', version: 4 });
  assert.deepEqual(parseIp('2001:4860:4860::8888'), { ip: '2001:4860:4860::8888', version: 6 });
  assert.equal(parseIp('999.1.1.1'), null);
  assert.equal(parseIp('example.com'), null);
  assert.equal(parseIp(undefined), null);
});

test('classifyIp identifies routing scope for IPv4', () => {
  const cases = {
    '8.8.8.8': 'public',
    '10.1.2.3': 'private',
    '172.16.0.1': 'private',
    '172.32.0.1': 'public',
    '192.168.1.1': 'private',
    '100.64.0.1': 'private',
    '127.0.0.1': 'loopback',
    '169.254.1.1': 'link-local',
    '224.0.0.1': 'multicast',
    '255.255.255.255': 'reserved',
    '203.0.113.9': 'documentation',
  };
  for (const [ip, expected] of Object.entries(cases)) {
    assert.equal(classifyIp(ip), expected, ip);
  }
});

test('classifyIp identifies routing scope for IPv6 and mapped IPv4', () => {
  assert.equal(classifyIp('::1'), 'loopback');
  assert.equal(classifyIp('::'), 'unspecified');
  assert.equal(classifyIp('fe80::1'), 'link-local');
  assert.equal(classifyIp('fd00::1'), 'private');
  assert.equal(classifyIp('ff02::1'), 'multicast');
  assert.equal(classifyIp('2001:db8::1'), 'documentation');
  assert.equal(classifyIp('2001:4860:4860::8888'), 'public');
  assert.equal(classifyIp('::ffff:192.168.0.10'), 'private');
  assert.equal(classifyIp('::ffff:8.8.4.4'), 'public');
});

test('classifyIp throws on non-IP input', () => {
  assert.throws(() => classifyIp('nope'), TypeError);
});

test('ipv6Words expands compressed and embedded-IPv4 forms', () => {
  assert.deepEqual(ipv6Words('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(ipv6Words('2001:db8::'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(ipv6Words('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
});

test('cidrContains matches within the prefix and rejects outside it', () => {
  assert.equal(cidrContains('8.8.8.0/24', '8.8.8.200'), true);
  assert.equal(cidrContains('8.8.8.0/24', '8.8.9.1'), false);
  assert.equal(cidrContains('8.8.8.8/32', '8.8.8.8'), true);
  assert.equal(cidrContains('2001:4860:4860::/48', '2001:4860:4860::8888'), true);
  assert.equal(cidrContains('8.8.8.0/24', '2001:4860:4860::8888'), false, 'family mismatch');
  assert.equal(cidrContains('8.8.8.0/40', '8.8.8.1'), false, 'invalid prefix');
});

test('countryFlag builds regional-indicator emoji', () => {
  assert.equal(countryFlag('us'), '\u{1F1FA}\u{1F1F8}');
  assert.equal(countryFlag('GB'), '\u{1F1EC}\u{1F1E7}');
  assert.equal(countryFlag('USA'), null);
  assert.equal(countryFlag(null), null);
});

test('unmapIp strips the IPv4-mapped prefix only', () => {
  assert.equal(unmapIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(unmapIp('2001:db8::1'), '2001:db8::1');
});
