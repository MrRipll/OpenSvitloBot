export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  API_KEY: string;
  OUTAGE_GROUP: string;
  CORS_ORIGIN: string;
}

export interface Device {
  id: string;
  name: string;
  group_name: string;
  status: 'online' | 'offline' | 'unknown';
  last_ping: number | null;
  last_status_change: number | null;
  created_at: number;
}

export interface Ping {
  id: number;
  device_id: string;
  timestamp: number;
}

export interface Outage {
  id: number;
  device_id: string;
  start_time: number;
  end_time: number | null;
  duration: number | null;
}
