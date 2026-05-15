const fetch = require('node-fetch');

// Vercel Serverless Function: proxies to ORS
module.exports = async function (req, res) {
  // Allow CORS from anywhere (adjust as needed)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ORS_API_KEY not configured' });

  const body = req.body || (req._body && req._body.post);
  const profile = body && body.profile;
  const coordinates = body && body.coordinates;
  if (!profile || !coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
    return res.status(400).json({ error: 'Request must include profile and coordinates [[lon,lat],[lon,lat]]' });
  }

  const ORS_BASE = (process.env.ORS_BASE_URL || 'https://api.openrouteservice.org').replace(/\/$/, '');
  const url = `${ORS_BASE}/v2/directions/${encodeURIComponent(profile)}/geojson`;

  try {
    // POST
    let resp = await fetch(url, {
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
      const start = `${coordinates[0][0]},${coordinates[0][1]}`;
      const end = `${coordinates[1][0]},${coordinates[1][1]}`;
      const getUrl = `${ORS_BASE}/v2/directions/${encodeURIComponent(profile)}?start=${start}&end=${end}`;
      resp = await fetch(getUrl, { method: 'GET', headers: { 'Authorization': apiKey, 'Accept': 'application/json, application/geo+json' } });
      text = await resp.text();
    }

    if (!resp.ok) {
      return res.status(502).json({ error: 'ORS returned non-OK status', status: resp.status, body: text });
    }

    const contentType = resp.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);
    return res.status(resp.status).send(text);
  } catch (err) {
    console.error('directions proxy error', err);
    return res.status(500).json({ error: 'Proxy error', details: String(err) });
  }
};
