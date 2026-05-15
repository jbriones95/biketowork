from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
import os
import json
from osm_lts import classify

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://osm:osm@localhost:5432/gis')

app = FastAPI()

# Allow CORS from local frontend/dev servers. For production, lock this down.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RouteRequest(BaseModel):
    origin: list  # [lon, lat]
    destination: list  # [lon, lat]
    alpha: float = 1.0  # LTS weight factor


def get_conn():
    return psycopg2.connect(DATABASE_URL)


@app.post('/route')
def route(req: RouteRequest):
    try:
        conn = get_conn()
        cur = conn.cursor()
        # find nearest edge endpoints to origin/destination
        cur.execute("""
        SELECT id, ST_AsText(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))) as pt
        FROM ways
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)
        LIMIT 1
        """, (req.origin[0], req.origin[1], req.origin[0], req.origin[1]))
        o = cur.fetchone()

        cur.execute("""
        SELECT id, ST_AsText(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))) as pt
        FROM ways
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)
        LIMIT 1
        """, (req.destination[0], req.destination[1], req.destination[0], req.destination[1]))
        d = cur.fetchone()

        if not o or not d:
            raise HTTPException(status_code=404, detail='no nearby ways')

        start_id = o[0]
        end_id = d[0]

        # The ways table must have columns: id, source, target, length_m, lts
        # Compute cost: length_m * (1 + alpha * (lts-1)/3)
        cur.execute("""
        SELECT seq, id1 as edge_id, cost FROM pgr_dijkstra(
          'SELECT id, source, target, (length_m * (1 + %s * ((lts-1)::double precision/3.0)))::double precision AS cost FROM ways', %s, %s, directed := false
        );
        """, (req.alpha, start_id, end_id))

        rows = cur.fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail='no route found')

        edge_ids = [r[1] for r in rows]
        # fetch geometries for edges and build an id->(geom,lts,length_m) map
        cur.execute('SELECT id, ST_AsGeoJSON(geom)::json as geom, lts, length_m FROM ways WHERE id = ANY(%s)', (edge_ids,))
        feats = cur.fetchall()
        fmap = {f[0]: {'geom': f[1], 'lts': f[2], 'length_m': f[3]} for f in feats}

        features = []
        total_m = 0.0
        lts_values = []
        # preserve path order using edge_ids
        for eid in edge_ids:
            meta = fmap.get(eid)
            if not meta:
                continue
            features.append({
                'type': 'Feature',
                'properties': {'id': eid, 'lts': meta['lts']},
                'geometry': meta['geom']
            })
            if meta.get('length_m'):
                total_m += meta['length_m']
            if meta.get('lts') is not None:
                lts_values.append(meta['lts'])

        avg_lts = (sum(lts_values) / len(lts_values)) if lts_values else None
        geojson = {'type':'FeatureCollection','features': features}
        return {'geojson': geojson, 'edge_count': len(features), 'distance_m': total_m, 'avg_lts': avg_lts}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
