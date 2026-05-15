const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend from docs/
app.use(express.static(path.join(__dirname, '..', 'docs')));

// Simple proxy for OpenRouteService directions
app.post('/api/directions', async (req, res) => {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ORS_API_KEY not configured on server. See README.' });
  }

  const { profile, coordinates } = req.body;
  if (!profile || !coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
    return res.status(400).json({ error: 'Request must include profile and coordinates [[lon,lat],[lon,lat]]' });
  }

  const ORS_BASE = (process.env.ORS_BASE_URL || 'https://api.openrouteservice.org').replace(/\/$/, '');
  const url = `${ORS_BASE}/v2/directions/${encodeURIComponent(profile)}/geojson`;

  try {
    // Try POST first (ORS standard for /geojson). Include Accept header.
    console.log(`[proxy] POST ${url}`);
    let resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/geo+json'
      },
      body: JSON.stringify({ coordinates })
    });
    let bodyText = await resp.text();
    console.log(`[proxy] response ${resp.status} ${resp.statusText} (POST)`);
    if (resp.status === 405) {
      // Some ORS deployments reject POST on this path; fallback to GET with start/end query params.
      const start = `${coordinates[0][0]},${coordinates[0][1]}`;
      const end = `${coordinates[1][0]},${coordinates[1][1]}`;
      const getUrl = `${ORS_BASE}/v2/directions/${encodeURIComponent(profile)}?start=${start}&end=${end}`;
      console.log(`[proxy] fallback GET ${getUrl}`);
      resp = await fetch(getUrl, { method: 'GET', headers: { 'Authorization': apiKey, 'Accept': 'application/json, application/geo+json' } });
      bodyText = await resp.text();
      console.log(`[proxy] response ${resp.status} ${resp.statusText} (GET)`);
    }

    // If non-2xx, include remote body in our error for diagnosis (safe: doesn't include the API key)
    if (!resp.ok) {
      console.error('[proxy] non-ok response from ORS:', resp.status, bodyText);
      return res.status(502).json({ error: 'ORS returned non-OK status', status: resp.status, body: bodyText });
    }

    // Forward successful response
    res.status(resp.status).contentType(resp.headers.get('content-type') || 'application/json').send(bodyText);
  } catch (err) {
    console.error('Proxy error', err);
    res.status(500).json({ error: 'Proxy error', details: String(err) });
  }
});

// Proxy for OpenTripPlanner plan API
app.post('/api/transit', async (req, res) => {
  const otpBase = process.env.OTP_BASE_URL;
  if (!otpBase) {
    return res.status(500).json({ error: 'OTP_BASE_URL not configured on server. See README.' });
  }

  const { coordinates } = req.body;
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
    return res.status(400).json({ error: 'Request must include coordinates [[lon,lat],[lon,lat]]' });
  }

  const from = coordinates[0];
  const to = coordinates[1];
  const fromPlace = `${from[1]},${from[0]}`;
  const toPlace = `${to[1]},${to[0]}`;

  // Build OTP plan URL. Request a few itineraries and include transit and walking.
  const url = `${otpBase.replace(/\/$/, '')}/otp/routers/default/plan?fromPlace=${encodeURIComponent(fromPlace)}&toPlace=${encodeURIComponent(toPlace)}&mode=TRANSIT,WALK&numItineraries=3`;

  try {
    const resp = await fetch(url, { method: 'GET' });
    const data = await resp.text();
    res.status(resp.status).contentType(resp.headers.get('content-type') || 'application/json').send(data);
  } catch (err) {
    console.error('Transit proxy error', err);
    res.status(500).json({ error: 'Transit proxy error', details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
