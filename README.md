# BikeToWork — Bike vs Transit Planner (OSM)

This project is a small web app that compares bicycle travel times (using OpenStreetMap tiles) and provides a placeholder for transit routing. It is geofenced to the Denver Metro area.

Key points
- The OpenRouteService (ORS) API key MUST be kept private. This repository does NOT contain any keys.
- A small local Express proxy reads the ORS key from the environment and forwards routing requests. That keeps the key off the public frontend and is suitable for local development.
- The frontend is static and located in `docs/` so it can be published to GitHub Pages. If you want to publish to GitHub Pages and still keep the key private, you must NOT enable routing from the public site — instead run the local proxy and use the local site.
- The frontend is static and located in `docs/` so it can be published to GitHub Pages. If you prefer a zero-server setup, bike routing now uses the public OSRM demo endpoint (no key required). Transit still requires a provider.
- Serverless functions are included under `api/` so you can deploy the proxy to Vercel (or Netlify functions) and keep your ORS/OTP keys private in the cloud. See the Deploy section.
 - The frontend is static and located in `docs/` so it can be published to GitHub Pages. Bike routing uses the public OSRM demo endpoint (no key required). Transit still requires a provider.

Local development

1. Copy .env.example to .env and set your ORS key there (do NOT commit this file):

   ORS_API_KEY=your_api_key_here
   ORS_BASE_URL=https://api.openrouteservice.org
   OTP_BASE_URL=http://localhost:8080

2. Install dependencies and start the server (the server serves the static frontend and provides a secure proxy):

   npm install
   npm start

For local development with automatic restarts when server code changes run:

   npm run dev

For a managed local background process that restarts automatically and can be controlled with pm2:

   npm install -g pm2
   npm run pm2-start
   npm run pm2-logs


3. Open `http://localhost:3000` in your browser.

How it works
- The frontend (docs/) uses Leaflet and OSM tiles. It restricts origin/destination to a Denver metro geofence.
- When you request a bike route, the frontend POSTs to `/api/directions` on the same server. The server attaches the ORS API key from environment and forwards the request to OpenRouteService.

Publishing to GitHub Pages
- The static site is ready under `docs/`. If you want to publish to GitHub Pages, push the branch and enable Pages to serve from `docs/` in the repository settings.
- NOTE: Because GitHub Pages is static and public, do not embed your ORS key there. Either keep the routing feature disabled on the public site or provide your own secure proxy.

Serverless deployment (Vercel or Cloudflare Workers)

Vercel (easy):
1. Install Vercel CLI and login: `npm i -g vercel` then `vercel login`.
2. From this repo root run `vercel` and follow prompts, or connect the GitHub repo in the Vercel dashboard.
3. Set these environment variables in the Vercel project settings (not in the repo):
   - ORS_API_KEY (your OpenRouteService key)
   - OTP_BASE_URL (your OTP instance URL, if you use OTP)
   - ORS_BASE_URL (optional, defaults to https://api.openrouteservice.org)
4. Configure the Vercel build to output static files from the `docs/` folder. Vercel will automatically map `/api/*` to the serverless functions in `api/`.

Cloudflare Workers (no server, edge-deployed):
1. Install Wrangler: `npm i -g wrangler` and login: `wrangler login`.
2. Set these secrets in your Cloudflare account for the Worker:
   - ORS_API_KEY (use `wrangler secret put ORS_API_KEY`)
   - OTP_BASE_URL (use `wrangler secret put OTP_BASE_URL`)
3. Build and publish the site and worker with Wrangler. The simplest approach is to publish the static site to Workers Sites and include the worker script. Use `wrangler publish` from the `cloudflare` folder after configuring `wrangler.toml` (example included).
4. The Worker will serve `docs/` as the static site and expose `/api/directions` and `/api/transit` endpoints that the frontend can call. This keeps keys private at the edge.

I included a Cloudflare Worker example in `cloudflare/worker.js` and an example `wrangler.toml`. You'll need to adapt the wrangler config for your account and set secrets with `wrangler secret put`.

Extending transit routing
- ORS does not provide public-transit routing. To add transit comparisons, you'll need a transit routing provider (e.g. OpenTripPlanner, Google Directions Transit) and a similar secure proxy pattern.
 - This repository includes a proxy pattern for OpenTripPlanner (OTP). Set OTP_BASE_URL in your .env to your OTP instance (for local OTP this might be http://localhost:8080).
