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

CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_outages_device ON outages(device_id, start_time);
CREATE INDEX IF NOT EXISTS idx_outages_end ON outages(end_time);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

CREATE TABLE IF NOT EXISTS schedule_days (
  date TEXT NOT NULL,
  group_name TEXT NOT NULL,
  slots TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, group_name)
);

CREATE TABLE IF NOT EXISTS telegram_chart (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  message_id INTEGER NOT NULL,
  week_start INTEGER NOT NULL,
  hash TEXT,
  pinned INTEGER NOT NULL DEFAULT 0
);
`;

// Its presence means the schema is up to date. Any schema change (new table, index or column)
// must add a new column here or the probe above will skip it.
const LATEST_COLUMN = 'pinned';

// Columns added after the initial release. ALTER fails if the column exists — that's fine.
const ALTERS = [
  'ALTER TABLE telegram_chart ADD COLUMN hash TEXT',
  'ALTER TABLE telegram_chart ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
];

let migrated = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (migrated) return;

  // Cron usually lands on a fresh isolate, so probe the newest column with one cheap
  // query instead of re-running every CREATE/ALTER each minute.
  try {
    await db.prepare(`SELECT ${LATEST_COLUMN} FROM telegram_chart LIMIT 0`).run();
    migrated = true;
    return;
  } catch {
    // schema is missing or outdated — migrate below
  }

  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  await db.batch(statements.map(sql => db.prepare(sql)));

  for (const sql of ALTERS) {
    try {
      await db.prepare(sql).run();
    } catch {
      // column already exists
    }
  }

  migrated = true;
}
