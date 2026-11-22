# IP Geolocation API

Look up city, region, country, coordinates, timezone, currency and connection flags for any IP address, with a rule-based accuracy score and an AI-written explanation. Built as a small, deployable showcase of AI-assisted API development.

- **Zero runtime dependencies**: plain Node.js 20+ (`node:http`, built-in `fetch`, `node:test`).
- **Pluggable data**: a live HTTP provider (default) or an offline sample dataset.
- **AI capability**: `POST /api/v1/ip/:ip/explain` asks Claude (`claude-haiku-5-5` by default) to explain a result in plain language. It falls back to a deterministic template when no API key is set, so the endpoint always works.
- **Deployable**: Dockerfile, GitHub Actions CI, Render blueprint.

## Quick start

```bash
npm test                              # 35 tests, no network needed
GEO_PROVIDER=static npm start         # offline sample data, http://localhost:3000
npm start                             # live provider (ipapi.co), needs internet
```

Open http://localhost:3000 for the demo UI.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/ip/:ip` | Lookup one IPv4/IPv6 address. Use `me` for the caller's address. |
| POST | `/api/v1/ip/batch` | Body `{"ips": [...]}`, up to 50 addresses. |
| POST | `/api/v1/ip/:ip/explain` | Plain-language explanation of the lookup (Claude, with template fallback). |
| GET | `/health` | Liveness check. |

Example:

```bash
curl http://localhost:3000/api/v1/ip/8.8.8.8
```

```json
{
  "ip": "8.8.8.8",
  "version": 4,
  "network": { "classification": "public" },
  "location": {
    "city": "Mountain View", "region": "California", "country": "United States",
    "countryCode": "US", "continent": "NA", "latitude": 37.386, "longitude": -122.0838,
    "timezone": "America/Los_Angeles", "currency": "USD", "postal": "94043", "flag": "🇺🇸"
  },
  "connection": {
    "org": "Google LLC", "asn": "AS15169",
    "flags": { "vpn": false, "mobile": false, "hosting": false, "method": "heuristic-org-name" }
  },
  "accuracy": { "level": "medium", "score": 75, "precision": "city", "notes": ["..."] },
  "meta": { "provider": "ipapi", "cached": false, "lookedUpAt": "2026-11-22T00:00:00.000Z" }
}
```

Errors use one shape: `{"error": {"code": "INVALID_IP", "message": "..."}}`. Codes include `INVALID_IP` (400), `INVALID_BODY` (400), `BATCH_TOO_LARGE` (413), `RATE_LIMITED` (429), `UPSTREAM_UNAVAILABLE` (502).

Private, loopback, link-local, multicast, reserved and documentation addresses return `200` with `location: null`, because they cannot be geolocated.

## How accuracy is scored

The score follows the accuracy guidance this project was built around: country is the most reliable level, city is looser, and mobile, VPN and proxy traffic is least reliable.

| Signal | Effect |
| --- | --- |
| Country only | 90 (precision: country) |
| Region, no city | 65 (precision: region) |
| City with coordinates | 75 (precision: city) |
| VPN/proxy hint | −35 |
| Mobile carrier hint | −25 |
| Hosting/cloud hint | −15 |

Levels: `high` ≥ 80, `medium` ≥ 55, `low` below that. VPN, mobile and hosting flags come from keywords in the organisation name. This is a **heuristic**, and the response says so (`method: "heuristic-org-name"`). Dedicated VPN, proxy and Tor datasets give much better signal.

## Configuration

All settings are environment variables. See [`.env.example`](.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `GEO_PROVIDER` | `ipapi` | `ipapi` (live) or `static` (offline sample) |
| `GEO_BASE_URL` | `https://ipapi.co` | Any provider with the same JSON shape |
| `CACHE_TTL_SECONDS` | `3600` | In-memory cache per address |
| `RATE_LIMIT_PER_MINUTE` | `60` | Per client IP. `0` disables. |
| `TRUST_PROXY` | `false` | Set `true` only behind a proxy you control |
| `ANTHROPIC_API_KEY` | empty | Enables Claude explanations. Keep it in the host's secret store. |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | |

## Data and accuracy caveats

- The **`static` provider** uses a handful of illustrative ranges. It exists for offline demos and deterministic tests. It is not authoritative.
- The **`ipapi` provider** calls a third-party free API. Check its terms and rate limits before using it in production. For production scale, plug in a licensed database (for example MaxMind GeoIP2 or a commercial IP-intelligence vendor) by implementing `lookup(parsed)` in `src/providers/`.
- IP geolocation is an estimate. Results on mobile, VPN and proxy networks can point to the carrier or provider rather than the user.

## Project layout

```
src/
  server.js          entry point and wiring
  app.js             HTTP routes, rate limiting, static files
  service.js         lookup use case (cache, provider, accuracy)
  ip.js              parsing, classification, CIDR matching, flag emoji
  confidence.js      accuracy scoring and connection heuristics
  ai.js              Claude explanation with template fallback
  cache.js           TTL cache
  config.js          environment configuration
  providers/         ipapi (live) and static (offline) providers
public/              demo UI (no build step)
test/                node:test suites
```

## Deploy

**Docker (any host):**

```bash
docker build -t ip-geolocation-api .
docker run -p 3000:3000 -e GEO_PROVIDER=ipapi ip-geolocation-api
```

**Render:** connect the repository. `render.yaml` is a Blueprint that uses the Dockerfile, sets the health check to `/health`, and marks `ANTHROPIC_API_KEY` as a secret to set in the dashboard.

Behind a reverse proxy, set `TRUST_PROXY=true` so rate limits and `/api/v1/ip/me` use the real client address.

**CI:** `.github/workflows/ci.yml` runs the test suite on Node 20 and 22, builds the Docker image, and smoke-tests the container.

## License

MIT
