// Rule-based accuracy scoring. It mirrors the guidance that IP geolocation is
// most reliable at country level, looser at city level, and weakest on
// mobile, VPN and proxy traffic. Heuristics are labelled as such in the output.

const VPN_HINT = /\b(vpn|proxy|tor|mullvad|nordvpn|expressvpn|surfshark|private internet access|protonvpn)\b/i;
const MOBILE_HINT = /\b(mobile|wireless|cellular|t-mobile|verizon wireless|vodafone|airtel|jio|telefonica|orange mobile)\b/i;
const HOSTING_HINT = /\b(hosting|data ?center|datacenter|cloud|amazon|aws|google cloud|digitalocean|hetzner|ovh|linode|vultr)\b/i;

/**
 * Infer connection flags from the organisation / ASN name (heuristic).
 * Real VPN/proxy/Tor detection needs a dedicated dataset; this is a best-effort signal.
 */
export function inferConnectionFlags(org = '') {
  return {
    vpn: VPN_HINT.test(org),
    mobile: MOBILE_HINT.test(org),
    hosting: HOSTING_HINT.test(org),
    method: 'heuristic-org-name',
  };
}

/**
 * @param {{ city?: string|null, latitude?: number|null, longitude?: number|null, country?: string|null, region?: string|null } | null} location
 * @param {{ vpn: boolean, mobile: boolean, hosting: boolean }} flags
 * @returns {{ level: 'high'|'medium'|'low'|'none', score: number, precision: string, notes: string[] }}
 */
export function assessAccuracy(location, flags = { vpn: false, mobile: false, hosting: false }) {
  if (!location || !location.country) {
    return { level: 'none', score: 0, precision: 'none', notes: ['No geolocation data for this address.'] };
  }

  const notes = [];
  let score;
  let precision;
  if (location.city && location.latitude != null && location.longitude != null) {
    precision = 'city';
    score = 75;
  } else if (location.region) {
    precision = 'region';
    score = 65;
  } else {
    precision = 'country';
    score = 90;
    notes.push('Only country-level precision is available for this address.');
  }

  if (precision === 'city') notes.push('City-level precision: tightest on fixed broadband in dense metros.');

  if (flags.vpn) {
    score -= 35;
    notes.push('Connection looks like a VPN or proxy; the IP may point to the provider, not the user.');
  }
  if (flags.mobile) {
    score -= 25;
    notes.push('Mobile carrier network; the IP often resolves to a carrier hub.');
  }
  if (flags.hosting) {
    score -= 15;
    notes.push('Hosting or cloud network; the location may be the data centre, not the end user.');
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low';
  return { level, score, precision, notes };
}
