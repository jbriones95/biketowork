"""
Script to classify OSM ways using osm-lts and prepare the ways table with length and LTS.
Run after importing OSM into a `ways` table with geometry (geom) in SRID 4326.
"""
import psycopg2
import os
from osm_lts import classify
from psycopg2.extras import execute_values

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://osm:osm@db:5432/gis')


def ensure_columns(conn):
    cur = conn.cursor()
    cur.execute("ALTER TABLE IF EXISTS ways ADD COLUMN IF NOT EXISTS length_m double precision;")
    cur.execute("ALTER TABLE IF EXISTS ways ADD COLUMN IF NOT EXISTS lts integer;")
    conn.commit()


def compute_lengths(conn):
    cur = conn.cursor()
    cur.execute("UPDATE ways SET length_m = ST_Length(ST_Transform(geom,3857)) WHERE length_m IS NULL;")
    conn.commit()


def classify_rows(conn, batch=1000):
    cur = conn.cursor()
    cur.execute('SELECT id, tags FROM ways WHERE lts IS NULL LIMIT %s', (batch,))
    rows = cur.fetchall()
    updates = []
    for rid, tags in rows:
        try:
            if not tags:
                l = None
            else:
                lobj = classify(tags)
                l = int(lobj) if lobj is not None else None
        except Exception:
            l = None
        updates.append((l, rid))

    if updates:
        execute_values(cur, 'UPDATE ways AS w SET lts = u.l FROM (VALUES %s) AS u(l, id) WHERE u.id = w.id', updates)
        conn.commit()
    return len(updates)


def main():
    conn = psycopg2.connect(DATABASE_URL)
    ensure_columns(conn)
    compute_lengths(conn)
    while True:
        n = classify_rows(conn, batch=2000)
        print('Updated', n)
        if n == 0:
            break


if __name__ == '__main__':
    main()
