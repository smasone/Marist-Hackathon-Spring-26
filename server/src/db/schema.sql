-- Development schema aligned to current Neon project tables.

CREATE TABLE IF NOT EXISTS lots (
  lotid INTEGER PRIMARY KEY,
  lotname TEXT NOT NULL UNIQUE,
  altname TEXT UNIQUE,
  allowsresidents BOOLEAN NOT NULL,
  allowscommuters BOOLEAN NOT NULL,
  allowsfaculty BOOLEAN NOT NULL,
  allowsvisitors BOOLEAN NOT NULL,
  CHECK (lotname <> altname)
);

CREATE TABLE IF NOT EXISTS spaces (
  spacenum INTEGER PRIMARY KEY,
  lotid INTEGER NOT NULL REFERENCES lots(lotid),
  ishandicap BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  spacenum INTEGER NOT NULL REFERENCES spaces(spacenum),
  entrancetime TIMESTAMP NOT NULL,
  exittime TIMESTAMP NOT NULL,
  PRIMARY KEY (spacenum, entrancetime),
  CHECK (entrancetime < exittime)
);

CREATE TABLE IF NOT EXISTS buildings (
  buildingid INTEGER PRIMARY KEY,
  buildingname TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS lotdistances (
  lotid INTEGER NOT NULL REFERENCES lots(lotid),
  buildingid INTEGER NOT NULL REFERENCES buildings(buildingid),
  distancescore INTEGER NOT NULL,
  PRIMARY KEY (lotid, buildingid)
);

CREATE INDEX IF NOT EXISTS idx_spaces_lotid ON spaces(lotid);
CREATE INDEX IF NOT EXISTS idx_history_spacenum_entrance ON history(spacenum, entrancetime);
CREATE INDEX IF NOT EXISTS idx_history_entrance ON history(entrancetime);
