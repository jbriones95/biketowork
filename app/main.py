from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import psycopg2
import os
import json
from osm_lts import classify

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://osm:osm@localhost:5432/gis')

app = FastAPI()

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
        # fetch geometries for edges
        cur.execute('SELECT id, ST_AsGeoJSON(geom)::json as geom, lts FROM ways WHERE id = ANY(%s)', (edge_ids,))
        feats = cur.fetchall()
        features = []
        total_m = 0
        for fid, geom, lts in feats:
            features.append({
                'type': 'Feature',
                'properties': {'id': fid, 'lts': lts},
                'geometry': geom
            })
        geojson = {'type':'FeatureCollection','features': features}
        return {'geojson': geojson, 'edge_count': len(features)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
