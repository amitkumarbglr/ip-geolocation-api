// IP parsing and classification. Pure functions, no I/O.
import { isIP } from 'node:net';

/**
 * Validate and normalise an IP string.
 * @returns {{ ip: string, version: 4 | 6 } | null}
 */
export function parseIp(input) {
  if (typeof input !== 'string') return null;
  const ip = input.trim().toLowerCase();
  const version = isIP(ip);
  if (version === 0) return null;
  return { ip, version };
}

/** Strip the IPv4-mapped prefix that Node reports for dual-stack sockets. */
export function unmapIp(ip) {
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip;
}

function ipv4Octets(ip) {
  return ip.split('.').map(Number);
}

/** Expand an IPv6 address (including :: and an embedded IPv4 tail) to 8 16-bit words. */
export function ipv6Words(ip) {
  let s = ip;
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a, b, c, d] = tail.split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const zeros = new Array(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((h) => parseInt(h || '0', 16));
}

/**
 * Classify an address by its routing scope.
 * @returns {'public'|'private'|'loopback'|'link-local'|'multicast'|'reserved'|'unspecified'|'documentation'}
 */
export function classifyIp(input) {
  const parsed = typeof input === 'string' ? parseIp(input) : input;
  if (!parsed) throw new TypeError(`Not an IP address: ${input}`);
  if (parsed.version === 4) return classifyIPv4(parsed.ip);

  const w = ipv6Words(parsed.ip);
  if (w.every((x) => x === 0)) return 'unspecified';
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return 'loopback';
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
    return classifyIPv4(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
  }
  if ((w[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((w[0] & 0xfe00) === 0xfc00) return 'private';
  if ((w[0] & 0xff00) === 0xff00) return 'multicast';
  if (w[0] === 0x2001 && w[1] === 0x0db8) return 'documentation';
  return 'public';
}

function classifyIPv4(ip) {
  const [a, b, c] = ipv4Octets(ip);
  if (a === 0 || a === 255) return 'reserved';
  if (a === 10) return 'private';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // carrier-grade NAT
  if (a === 192 && b === 0 && c === 2) return 'documentation';
  if (a === 198 && b === 51 && c === 100) return 'documentation';
  if (a === 203 && b === 0 && c === 113) return 'documentation';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

/** Only publicly routable addresses can be geolocated meaningfully. */
export function isGeolocatable(input) {
  return classifyIp(input) === 'public';
}

/** Convert an IP to a BigInt so CIDR membership is a single mask comparison. */
export function ipToBigInt(parsed) {
  if (parsed.version === 4) {
    return ipv4Octets(parsed.ip).reduce((acc, o) => (acc << 8n) | BigInt(o), 0n);
  }
  return ipv6Words(parsed.ip).reduce((acc, w) => (acc << 16n) | BigInt(w), 0n);
}

/** Does `cidr` (e.g. "8.8.8.0/24" or "2001:db8::/32") contain `ip`? */
export function cidrContains(cidr, ip) {
  const [net, lenStr] = cidr.split('/');
  const netParsed = parseIp(net);
  const ipParsed = typeof ip === 'string' ? parseIp(ip) : ip;
  if (!netParsed || !ipParsed || netParsed.version !== ipParsed.version) return false;

  const bits = netParsed.version === 4 ? 32n : 128n;
  const prefix = BigInt(lenStr ?? bits.toString());
  if (prefix < 0n || prefix > bits) return false;
  const hostBits = bits - prefix;
  const mask = ((1n << bits) - 1n) ^ ((1n << hostBits) - 1n);
  return (ipToBigInt(netParsed) & mask) === (ipToBigInt(ipParsed) & mask);
}

/** Turn an ISO 3166-1 alpha-2 code into its regional-indicator flag emoji. */
export function countryFlag(countryCode) {
  if (typeof countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  return [...countryCode.toUpperCase()]
    .map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65))
    .join('');
}
