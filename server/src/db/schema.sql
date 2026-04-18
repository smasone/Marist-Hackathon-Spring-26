-- Development schema for the parking demo backend.
-- parking_snapshots = point-in-time occupancy readings per lot (joined to parking_lots).

CREATE TABLE IF NOT EXISTS parking_lots (
  id SERIAL PRIMARY KEY,
  lot_code VARCHAR(64) NOT NULL UNIQUE,
  lot_name VARCHAR(255) NOT NULL,
  zone_type VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS parking_snapshots (
  id SERIAL PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES parking_lots (id) ON DELETE CASCADE,
  occupancy_percent NUMERIC(5, 2) NOT NULL
    CHECK (occupancy_percent >= 0 AND occupancy_percent <= 100),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parking_snapshots_lot_snapshot
  ON parking_snapshots (lot_id, snapshot_at);
