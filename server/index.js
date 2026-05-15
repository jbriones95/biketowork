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

  const url = `https://api.openrouteservice.org/v2/directions/${encodeURIComponent(profile)}/geojson`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ coordinates })
    });

    const data = await resp.text();
    // Forward status and body
    res.status(resp.status).contentType(resp.headers.get('content-type') || 'application/json').send(data);
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
