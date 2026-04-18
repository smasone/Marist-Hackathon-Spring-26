-- Development schema for the parking demo backend.
-- Matches table names used by src/services/parkingAnalyticsService.ts
-- (parking_lots + parking_observations).

CREATE TABLE IF NOT EXISTS parking_lots (
  id SERIAL PRIMARY KEY,
  lot_code VARCHAR(64) NOT NULL UNIQUE,
  lot_name VARCHAR(255) NOT NULL,
  zone_type VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS parking_observations (
  id SERIAL PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES parking_lots (id) ON DELETE CASCADE,
  occupancy_percent NUMERIC(5, 2) NOT NULL
    CHECK (occupancy_percent >= 0 AND occupancy_percent <= 100),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parking_observations_lot_observed
  ON parking_observations (lot_id, observed_at);
