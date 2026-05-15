// Minimal frontend using Leaflet. Sends routing requests to /api/directions which must be proxied to ORS.
(function(){
  const DENVER_CENTER = [39.7392, -104.9903];
  const GEOFENCE_RADIUS_M = 50000; // 50 km

  const map = L.map('map').setView(DENVER_CENTER, 11);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Geofence circle
  const geofence = L.circle(DENVER_CENTER, { radius: GEOFENCE_RADIUS_M, color: '#2a9d8f', weight:1, fill:false }).addTo(map);

  let origin = null;
  let dest = null;
  let originMarker, destMarker, routeLayer;
  let lastBike = null;
  let lastTransit = null;

  function pointInGeofence(latlng){
    const R = 6371000;
    const toRad = v => v * Math.PI / 180;
    const dLat = toRad(latlng.lat - DENVER_CENTER[0]);
    const dLon = toRad(latlng.lng - DENVER_CENTER[1]);
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(DENVER_CENTER[0]))*Math.cos(toRad(latlng.lat))*Math.sin(dLon/2)*Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const d = R * c;
    return d <= GEOFENCE_RADIUS_M;
  }

  function setOrigin(latlng){
    if (!pointInGeofence(latlng)){
      alert('Origin outside Denver Metro geofence. Please choose a point inside the circle.');
      return;
    }
    origin = latlng;
    if (originMarker) originMarker.setLatLng(latlng); else originMarker = L.marker(latlng, {title:'Origin'}).addTo(map).bindPopup('Origin');
  }

  function setDest(latlng){
    if (!pointInGeofence(latlng)){
      alert('Destination outside Denver Metro geofence. Please choose a point inside the circle.');
      return;
    }
    dest = latlng;
    if (destMarker) destMarker.setLatLng(latlng); else destMarker = L.marker(latlng, {title:'Destination', icon: L.icon({iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png', iconAnchor:[12,41]})}).addTo(map).bindPopup('Destination');
  }

  // Preset coordinates (lat, lng)
  const PRESETS = {
    downtown: { name: '16th St Mall', coord: L.latLng(39.7486, -104.9966) },
    union: { name: 'Union Station', coord: L.latLng(39.7526, -104.9998) },
    dtech: { name: 'Denver Tech Center', coord: L.latLng(39.6781, -104.9138) },
    centralpark: { name: 'Central Park', coord: L.latLng(39.7897, -104.8680) }
  };

  document.getElementById('presetSetOrigin').addEventListener('click', () => {
    const v = document.getElementById('presetSelect').value;
    if (!v || !PRESETS[v]) return alert('Select a preset first');
    setOrigin(PRESETS[v].coord);
  });
  document.getElementById('presetSetDest').addEventListener('click', () => {
    const v = document.getElementById('presetSelect').value;
    if (!v || !PRESETS[v]) return alert('Select a preset first');
    setDest(PRESETS[v].coord);
  });

  map.on('click', function(e){
    if (!origin) setOrigin(e.latlng);
    else if (!dest) setDest(e.latlng);
    else { setOrigin(e.latlng); dest = null; if (destMarker) { map.removeLayer(destMarker); destMarker = null } }
  });

  document.getElementById('clear').addEventListener('click', function(){
    origin = dest = null;
    if (originMarker) { map.removeLayer(originMarker); originMarker = null }
    if (destMarker) { map.removeLayer(destMarker); destMarker = null }
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null }
    document.getElementById('bikeResult').textContent = 'No route yet.';
  });

  async function routeBike(){
    if (!origin || !dest) { alert('Please set both origin and destination.'); return; }

    // Use public OSRM demo server for bike routing (no API key required).
    // Note: public demo servers may be rate-limited and are not for heavy production use.
    const start = `${origin.lng},${origin.lat}`;
    const end = `${dest.lng},${dest.lat}`;
    const profile = 'bike'; // OSRM profile name for bicycle routing
    const url = `https://router.project-osrm.org/route/v1/${profile}/${start};${end}?overview=full&geometries=geojson`;
    document.getElementById('bikeResult').textContent = 'Calculating...';
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        const txt = await resp.text();
        document.getElementById('bikeResult').textContent = 'Routing error: ' + resp.status + ' ' + txt;
        return;
      }
      const data = await resp.json();
      if (!data.routes || !data.routes.length) {
        document.getElementById('bikeResult').textContent = 'No route returned.';
        return;
      }
      const route = data.routes[0];
      const distance_m = route.distance;
      const duration_s = route.duration;
      const distance_km = distance_m ? (distance_m/1000).toFixed(2) : 'N/A';
      const minutes = duration_s ? Math.round(duration_s/60) : 'N/A';

      document.getElementById('bikeResult').textContent = `Distance: ${distance_km} km — Time: ${minutes} min`;
      lastBike = { distance_m, duration_s };
      
      // Also try the local pgRouting LTS-weighted router if available
      try {
        const resp2 = await fetch('http://localhost:8000/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: [origin.lng, origin.lat], destination: [dest.lng, dest.lat], alpha: 1.0 })
        });
        if (resp2.ok){
          const jr = await resp2.json();
          if (jr && jr.geojson){
            // display LTS route on map
            if (routeLayer) map.removeLayer(routeLayer);
            routeLayer = L.geoJSON(jr.geojson, { style: { color: '#e76f51', weight: 5, opacity: 0.9 } }).addTo(map);
            map.fitBounds(routeLayer.getBounds(), { padding: [20,20] });
            document.getElementById('routeResult').textContent = `LTS route: ${Math.round((jr.distance_m||0)/1000)} km — avg LTS ${jr.avg_lts ? jr.avg_lts.toFixed(2) : 'N/A'}`;
          }
        }
      } catch (err){
        // ignore if local router not available
      }
      // Estimate calories burned (simple formula: MET for cycling ~8.5, calories = MET * weight_kg * hours)
      const weight = Number(document.getElementById('weight').value) || 70;
      const hours = (duration_s || 0) / 3600;
      const MET = 8.5; // brisk cycling
      const calories = Math.round(MET * weight * hours);
      document.getElementById('bikeStats').textContent = `Estimated calories: ${calories} kcal • Avg speed ${(distance_km && duration_s) ? ((distance_km/(duration_s/3600)).toFixed(1)+' km/h') : 'N/A'}`;
      renderComparison();

      if (routeLayer) map.removeLayer(routeLayer);
      const geojson = { type: 'FeatureCollection', features: [ { type: 'Feature', geometry: route.geometry, properties: {} } ] };
      routeLayer = L.geoJSON(geojson, { style: { color: '#2a9d8f', weight: 5, opacity: 0.8 } }).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: [20,20] });
    } catch (err){
      console.error(err);
      document.getElementById('bikeResult').textContent = 'Error fetching route: ' + String(err);
    }
  }

  document.getElementById('routeBike').addEventListener('click', routeBike);

  // Decode polyline encoded with precision 1e6 (OTP default)
  function decodePolyline(encoded, precision) {
    precision = precision || 1e6;
    const coords = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
      let result = 1, shift = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63 - 1;
        result += byte << shift;
        shift += 5;
      } while (byte >= 0x1f);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);

      result = 1; shift = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63 - 1;
        result += byte << shift;
        shift += 5;
      } while (byte >= 0x1f);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);

      coords.push([lat / precision, lng / precision]);
    }
    return coords.map(c => [c[0], c[1]]);
  }

  async function routeTransit(){
    // Transit removed; we always prefer the LTS-weighted router. Keep function stub.
    alert('Transit routing has been disabled. Use the "Get Safer Route" button to compute LTS-weighted bike routes.');
  }

  function renderTransitAlternatives(){
    const container = document.getElementById('transitAlternatives');
    container.innerHTML = '';
    if (!lastTransit || !lastTransit.length) return;
    lastTransit.forEach((itin, idx) => {
      const dur = Math.round(itin.duration/60);
      const transfers = itin.transfers != null ? itin.transfers : (itin.legs ? Math.max(0, itin.legs.length - 1) : 'N/A');
      const btn = document.createElement('button');
      btn.textContent = `Option ${idx+1}: ${dur} min, ${transfers} transfers`;
      btn.addEventListener('click', () => selectTransitItinerary(idx));
      container.appendChild(btn);
    });
  }

  function selectTransitItinerary(idx){
    if (!lastTransit || !lastTransit[idx]) return;
    const itin = lastTransit[idx];
    // clear previous route
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null }
    const legGroup = L.layerGroup();
    itin.legs.forEach(leg => {
      if (leg.legGeometry && leg.legGeometry.points){
        const coords = decodePolyline(leg.legGeometry.points, 1e6).map(p => [p[0], p[1]]);
        const color = leg.mode === 'WALK' ? '#666' : '#2774ae';
        L.polyline(coords, { color, weight: 4, opacity: 0.9, dashArray: leg.mode === 'WALK' ? '4,8' : null }).addTo(legGroup);
      }
    });
    routeLayer = legGroup.addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [20,20] });

    // update transit details panel
    const resultsDiv = document.getElementById('transitResult');
    const durationMin = Math.round(itin.duration / 60);
    const transfers = itin.transfers != null ? itin.transfers : (itin.legs ? Math.max(0, itin.legs.length - 1) : 'N/A');
    resultsDiv.innerHTML = `<strong>Selected Option ${idx+1}</strong> — Duration: ${durationMin} min — Transfers: ${transfers}`;
    const legsHtml = itin.legs.map(leg => {
      const mode = leg.mode || '';
      const headsign = leg.headsign ? ` towards ${leg.headsign}` : '';
      const dur = Math.round(leg.duration/60);
      const from = leg.from && leg.from.name ? leg.from.name : '';
      const to = leg.to && leg.to.name ? leg.to.name : '';
      return `<div class="transit-leg"><strong>${mode}</strong>${headsign} — ${dur} min (${from} → ${to})</div>`;
    }).join('');
    resultsDiv.innerHTML += '<div>' + legsHtml + '</div>';

    renderComparison();
  }

  function renderComparison(){
    const summary = document.getElementById('compareSummary');
    const fill = document.getElementById('compareFill');
    if (!lastBike && !lastTransit){ summary.textContent = 'No comparison yet.'; fill.style.width = '0%'; return; }

    const bikeMin = lastBike ? (lastBike.duration_s/60) : Infinity;
    const transitMin = (lastTransit && lastTransit[0]) ? (lastTransit[0].duration/60) : Infinity;
    if (!isFinite(bikeMin) && !isFinite(transitMin)){ summary.textContent = 'No valid times.'; fill.style.width='0%'; return; }

    let better, ratio;
    if (bikeMin < transitMin){ better = 'Bike'; ratio = Math.min(1, bikeMin / Math.max(1, transitMin)); }
    else { better = 'Transit'; ratio = Math.min(1, transitMin / Math.max(1, bikeMin)); }

    summary.textContent = `${better} is faster — Bike: ${isFinite(bikeMin)?Math.round(bikeMin)+' min':'N/A'} • Transit: ${isFinite(transitMin)?Math.round(transitMin)+' min':'N/A'}`;
    // width percentage shows how close the winner is (closer to 100% means winner much faster)
    fill.style.width = (Math.round((1 - ratio) * 100)) + '%';
  }

})();
