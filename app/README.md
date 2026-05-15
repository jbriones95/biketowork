Local pgRouting router with LTS weighting

Run with Docker Compose (this will download a large Colorado OSM extract):

1. Start the stack (first run will import OSM into PostGIS, which can take a long time):

   docker compose up --build

2. After importer finishes, run classification & build inside the router container:

   docker compose exec router python classify_and_build.py

3. Start the router (if not already): it listens on port 8000

API
- POST /route {"origin":[lon,lat],"destination":[lon,lat],"alpha":1.0}
