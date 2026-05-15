/*
 Cloudflare Worker proxy for ORS and OTP
 Exposes POST /api/directions and POST /api/transit
 Secrets (set via `wrangler secret put NAME`): ORS_API_KEY, OTP_BASE_URL, ORS_BASE_URL (optional)
*/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (pathname.startsWith('/api/directions') && request.method === 'POST') {
        const apiKey = env.ORS_API_KEY;
        if (!apiKey) return jsonError('ORS_API_KEY not configured', 500);

        const body = await request.json();
        const profile = body && body.profile;
        const coordinates = body && body.coordinates;
        if (!profile || !coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
          return jsonError('Request must include profile and coordinates [[lon,lat],[lon,lat]]', 400);
        }

        const ORS_BASE = (env.ORS_BASE_URL || 'https://api.openrouteservice.org').replace(/\/$/, '');
        const postUrl = `${ORS_BASE}/v2/directions/${encodeURIComponent(profile)}/geojson`;

        // Try POST
        let resp = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json, application/geo+json'
          },
          body: JSON.stringify({ coordinates })
        });

        let text = await resp.text();
        if (resp.status === 405) {
          // Fallback to GET start/end
          const start = `${coordinates[0][0]},${coordinates[0][1]}`;
          const end = `${coordinates[1][0]},${coordinates[1][1]}`;
          const getUrl = `${ORS_BASE}/v2/directions/${encodeURIComponent(profile)}?start=${start}&end=${end}`;
          resp = await fetch(getUrl, { method: 'GET', headers: { 'Authorization': apiKey, 'Accept': 'application/json, application/geo+json' } });
          text = await resp.text();
        }

        if (!resp.ok) {
          return jsonError('ORS returned non-OK status', 502, { status: resp.status, body: text });
        }

        const headers = new Headers(CORS_HEADERS);
        const ct = resp.headers.get('content-type');
        if (ct) headers.set('Content-Type', ct);
        return new Response(text, { status: resp.status, headers });
      }

      if (pathname.startsWith('/api/transit') && request.method === 'POST') {
        const OTP_BASE = env.OTP_BASE_URL;
        if (!OTP_BASE) return jsonError('OTP_BASE_URL not configured', 500);

        const body = await request.json();
        const coordinates = body && body.coordinates;
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
          return jsonError('Request must include coordinates [[lon,lat],[lon,lat]]', 400);
        }

        const from = coordinates[0];
        const to = coordinates[1];
        const fromPlace = `${from[1]},${from[0]}`;
        const toPlace = `${to[1]},${to[0]}`;
        const url = `${OTP_BASE.replace(/\/$/, '')}/otp/routers/default/plan?fromPlace=${encodeURIComponent(fromPlace)}&toPlace=${encodeURIComponent(toPlace)}&mode=TRANSIT,WALK&numItineraries=3`;

        const resp = await fetch(url, { method: 'GET' });
        const text = await resp.text();
        if (!resp.ok) return jsonError('OTP returned non-OK status', 502, { status: resp.status, body: text });

        const headers = new Headers(CORS_HEADERS);
        const ct = resp.headers.get('content-type');
        if (ct) headers.set('Content-Type', ct);
        return new Response(text, { status: resp.status, headers });
      }

      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      return jsonError('Worker proxy error', 500, { details: String(err) });
    }
  }
};

function jsonError(message, status = 500, extra = {}) {
  const body = Object.assign({ error: message }, extra);
  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}
