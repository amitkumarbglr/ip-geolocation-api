// HTTP layer. Plain node:http so the project has zero runtime dependencies.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainLookup } from './ai.js';
import { unmapIp } from './ip.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const MAX_BATCH = 50;
const MAX_BODY_BYTES = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Fixed-window, in-memory rate limiter keyed by client address. */
export class RateLimiter {
  constructor({ limit, windowMs = 60_000, now = () => Date.now() }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  /** @returns {{ allowed: boolean, remaining: number, resetMs: number }} */
  check(key) {
    const t = this.now();
    let w = this.hits.get(key);
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, w);
    }
    w.count += 1;
    if (this.hits.size > 10_000) this.hits.clear(); // crude bound on memory
    return {
      allowed: w.count <= this.limit,
      remaining: Math.max(0, this.limit - w.count),
      resetMs: w.resetAt - t,
    };
  }
}

export function createApp({ service, config, rateLimiter = null, fetchImpl = globalThis.fetch }) {
  const aiOptions = { apiKey: config.anthropicApiKey, model: config.anthropicModel, fetchImpl };

  function send(res, status, body, headers = {}) {
    const raw = typeof body === 'string' || Buffer.isBuffer(body);
    const payload = raw ? body : JSON.stringify(body, null, 2);
    res.writeHead(status, {
      'content-type': headers['content-type'] ?? 'application/json; charset=utf-8',
      'cache-control': headers['cache-control'] ?? 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    });
    res.end(payload);
  }

  const sendError = (res, status, code, message, extra = {}) =>
    send(res, status, { error: { code, message, ...extra } });

  function clientAddress(req) {
    if (config.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
    }
    return unmapIp(req.socket.remoteAddress ?? 'unknown');
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('Body must be valid JSON'), { status: 400 });
    }
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const full = normalize(join(PUBLIC_DIR, rel));
    if (!full.startsWith(PUBLIC_DIR + sep)) return sendError(res, 403, 'FORBIDDEN', 'Path outside public directory');
    try {
      const data = await readFile(full);
      return send(res, 200, data, {
        'content-type': MIME[extname(full)] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=300',
      });
    } catch {
      return sendError(res, 404, 'NOT_FOUND', 'No such route');
    }
  }

  async function handleLookup(req, res, rawIp) {
    const target = rawIp === 'me' ? clientAddress(req) : rawIp;
    const result = await service.lookup(target);
    if (!result) return sendError(res, 400, 'INVALID_IP', 'Not a valid IPv4 or IPv6 address', { input: rawIp });
    return send(res, 200, result);
  }

  async function handleBatch(req, res) {
    const body = await readJson(req);
    const ips = body.ips;
    if (!Array.isArray(ips) || ips.length === 0) {
      return sendError(res, 400, 'INVALID_BODY', 'Provide a non-empty "ips" array');
    }
    if (ips.length > MAX_BATCH) {
      return sendError(res, 413, 'BATCH_TOO_LARGE', `A batch may contain at most ${MAX_BATCH} addresses`);
    }
    const results = await Promise.all(
      ips.map(async (ip) => (await service.lookup(String(ip))) ?? { ip, error: 'INVALID_IP' }),
    );
    return send(res, 200, { count: results.length, results });
  }

  async function handleExplain(req, res, rawIp) {
    const result = await service.lookup(rawIp);
    if (!result) return sendError(res, 400, 'INVALID_IP', 'Not a valid IPv4 or IPv6 address', { input: rawIp });
    const explanation = await explainLookup(result, aiOptions);
    return send(res, 200, { ip: result.ip, explanation });
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const { pathname } = url;

      if (pathname === '/health') return send(res, 200, { status: 'ok' });

      if (rateLimiter && pathname.startsWith('/api/')) {
        const rl = rateLimiter.check(clientAddress(req));
        res.setHeader('x-ratelimit-limit', String(rateLimiter.limit));
        res.setHeader('x-ratelimit-remaining', String(rl.remaining));
        if (!rl.allowed) {
          res.setHeader('retry-after', String(Math.ceil(rl.resetMs / 1000)));
          return sendError(res, 429, 'RATE_LIMITED', 'Too many requests, slow down');
        }
      }

      if (pathname === '/api/v1/ip/batch') {
        if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST');
        return await handleBatch(req, res);
      }

      const explainMatch = pathname.match(/^\/api\/v1\/ip\/([^/]+)\/explain$/);
      if (explainMatch) {
        if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST');
        return await handleExplain(req, res, decodeURIComponent(explainMatch[1]));
      }

      const lookupMatch = pathname.match(/^\/api\/v1\/ip\/([^/]+)$/);
      if (lookupMatch) {
        if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET');
        return await handleLookup(req, res, decodeURIComponent(lookupMatch[1]));
      }

      if (pathname.startsWith('/api/')) return sendError(res, 404, 'NOT_FOUND', 'No such route');

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET');
      }
      return await serveStatic(res, pathname);
    } catch (err) {
      if (err.status) return sendError(res, err.status, err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', err.message);
      if (err.code === 'UPSTREAM_RATE_LIMIT') return sendError(res, 503, 'UPSTREAM_RATE_LIMIT', err.message);
      if (err.code === 'UPSTREAM_ERROR' || err.name === 'TimeoutError' || err.name === 'AbortError') {
        return sendError(res, 502, 'UPSTREAM_UNAVAILABLE', 'Geolocation provider is unavailable, try again later');
      }
      console.error('[error]', err);
      return sendError(res, 500, 'INTERNAL', 'Unexpected server error');
    }
  };
}
