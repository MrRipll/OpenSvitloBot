const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT DEFAULT '',
  status TEXT DEFAULT 'unknown',
  last_ping INTEGER,
  last_status_change INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_pings_device_time ON pings(device_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_outages_device ON outages(device_id, start_time);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

CREATE TABLE IF NOT EXISTS schedule_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_chart (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  message_id INTEGER NOT NULL,
  week_start INTEGER NOT NULL
);
`;

let migrated = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (migrated) return;

  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const sql of statements) {
    await db.prepare(sql).run();
  }

  migrated = true;
}
