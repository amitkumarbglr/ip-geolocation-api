// Environment-driven configuration. Every value has a safe default.
export function loadConfig(env = process.env) {
  const int = (value, fallback) => {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    geoProvider: (env.GEO_PROVIDER || 'ipapi').toLowerCase(), // 'ipapi' | 'static'
    geoBaseUrl: env.GEO_BASE_URL || 'https://ipapi.co',
    cacheTtlSeconds: int(env.CACHE_TTL_SECONDS, 3600),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 60),
    trustProxy: env.TRUST_PROXY === 'true',
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  };
}
