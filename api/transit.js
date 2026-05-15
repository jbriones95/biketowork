const fetch = require('node-fetch');

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const OTP_BASE = process.env.OTP_BASE_URL;
  if (!OTP_BASE) return res.status(500).json({ error: 'OTP_BASE_URL not configured' });

  const body = req.body || (req._body && req._body.post);
  const coordinates = body && body.coordinates;
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
    return res.status(400).json({ error: 'Request must include coordinates [[lon,lat],[lon,lat]]' });
  }

  const from = coordinates[0];
  const to = coordinates[1];
  const fromPlace = `${from[1]},${from[0]}`;
  const toPlace = `${to[1]},${to[0]}`;
  const url = `${OTP_BASE.replace(/\/$/, '')}/otp/routers/default/plan?fromPlace=${encodeURIComponent(fromPlace)}&toPlace=${encodeURIComponent(toPlace)}&mode=TRANSIT,WALK&numItineraries=3`;

  try {
    const resp = await fetch(url, { method: 'GET' });
    const text = await resp.text();
    if (!resp.ok) return res.status(502).json({ error: 'OTP returned non-OK', status: resp.status, body: text });
    const contentType = resp.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);
    return res.status(resp.status).send(text);
  } catch (err) {
    console.error('transit proxy error', err);
    return res.status(500).json({ error: 'Proxy error', details: String(err) });
  }
};
