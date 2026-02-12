# OpenSvitloBot

Power outage monitoring system for Ukrainian households. Cloudflare Workers + D1 + ESP8266/ESP32 + Telegram notifications.

---

## How It Works

```
ESP Device ──[HTTPS ping every 15s]──► Cloudflare Worker
                                            │
                                       Store in D1 DB
                                            │
                                  Cron check every 1 min
                                            │
                                  No ping for 45s?
                                       ╱        ╲
                                    YES           NO
                                     │             │
                              Telegram alert    All good
                              "outage!"
```

When a device comes back online, you get a recovery notification with the outage duration.

## Deploy

1. Clone the repo
2. Add repository secrets in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | [Create token](https://dash.cloudflare.com/profile/api-tokens) — **"Edit Cloudflare Workers"** template + **D1 Edit** permission |
| `API_KEY` | Any random string — used to authenticate all requests to the Worker |
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Send a message to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates` |

3. Push to `main` — or run **Deploy Worker** manually from Actions

D1 database is created automatically on first deploy. Every push to `main` that touches `worker/` triggers a redeploy.

### Verify

```
https://your-worker.workers.dev/api/status?key=YOUR_API_KEY
```

The device is auto-created on first ping. ESP firmware should ping `/ping?key=YOUR_API_KEY`.

### Flash an ESP device

**Option A: Web Installer** (no IDE needed)
- Visit the [Web Installer](https://mrripll.github.io/OpenSvitloBot/) in Chrome/Edge
- Select your board, connect via USB, flash
- Configure via Serial Monitor (115200 baud)

**Option B: Arduino IDE**
- Open `firmware/esp8266/esp8266.ino` or `firmware/esp32/esp32.ino`
- Upload to your board
- Configure via Serial Monitor

### View the dashboard

Enable GitHub Pages in your repo: **Settings → Pages → Source: GitHub Actions**.

Then go to **Actions → Deploy Dashboard → Run workflow**.

Your dashboard: `https://<your-username>.github.io/<repo-name>/`

Enter your Worker URL and you'll see live device status.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ping?key=API_KEY` | Device heartbeat |
| `GET` | `/api/status?key=API_KEY` | Current device status |
| `GET` | `/api/devices?key=API_KEY` | Device list |
| `GET` | `/api/outages?key=API_KEY&days=7` | Outage history |
| `GET` | `/api/stats?key=API_KEY&period=7d` | Aggregated statistics |

## Telegram Notifications

- **Outage detected**: `⚡ Living Room (Apartment) — power outage at 14:32`
- **Power restored**: `✅ Living Room (Apartment) — power back at 15:17 (was off 45 min)`
- **Weekly report**: Chart image with uptime % and outage stats (via GitHub Actions)

## Cost

| Devices | Monthly Cost |
|---------|-------------|
| 1–50 | **$0** (Cloudflare free tier) |
| 50–7000 | **$5** (Workers paid) |

## License

MIT
