// Entry point: wires config -> provider -> cache -> service -> HTTP.
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp, RateLimiter } from './app.js';
import { loadConfig } from './config.js';
import { TtlCache } from './cache.js';
import { IpapiProvider } from './providers/ipapi.js';
import { StaticProvider } from './providers/static.js';
import { GeoService } from './service.js';

export function buildProvider(config) {
  if (config.geoProvider === 'static') {
    return StaticProvider.fromFile(fileURLToPath(new URL('./data/sample-ranges.json', import.meta.url)));
  }
  return Promise.resolve(new IpapiProvider({ baseUrl: config.geoBaseUrl }));
}

export async function startServer(overrides = {}, env = process.env) {
  const config = { ...loadConfig(env), ...overrides };
  const provider = await buildProvider(config);
  const service = new GeoService({
    provider,
    cache: new TtlCache({ ttlMs: config.cacheTtlSeconds * 1000 }),
  });
  const handler = createApp({
    service,
    config,
    rateLimiter: config.rateLimitPerMinute > 0 ? new RateLimiter({ limit: config.rateLimitPerMinute }) : null,
  });

  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return { server, config };
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, config } = await startServer();
  console.log(`IP geolocation API listening on http://${config.host}:${config.port} (provider: ${config.geoProvider})`);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
