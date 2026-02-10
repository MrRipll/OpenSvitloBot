# OpenSvitloBot

Power outage monitoring system for Ukrainian households. Cloudflare Workers + D1 + ESP8266/ESP32 + Telegram notifications.

---

## How It Works

```
ESP Device ──[HTTPS ping every 60s]──► Cloudflare Worker
                                            │
                                       Store in D1 DB
                                            │
                                  Cron check every 1 min
                                            │
                                  No ping for 5 min?
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
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Send a message to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates` |

3. Push to `master` — or run **Deploy Worker** manually from Actions

D1 database is created automatically on first deploy. Every push to `master` that touches `worker/` triggers a redeploy.

### Register a device

Open your browser and go to:
```
https://your-worker.workers.dev/api/status
```
If you see `{"devices":[],...}` — it's working!

Register a device (replace the URL):
```
curl -X POST https://your-worker.workers.dev/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Living Room", "group_name": "Apartment"}'
```

Save the `key` from the response — you'll need it for the ESP device.

### Flash an ESP device

**Option A: Web Installer** (no IDE needed)
- Visit the [Web Installer](https://MrRipll.github.io/OpenSvitloBot/firmware/web-installer/) in Chrome/Edge
- Select your board, connect via USB, flash
- Configure via Serial Monitor (115200 baud)

**Option B: Arduino IDE**
- Open `firmware/esp8266/opensvitlobot.ino` or `firmware/esp32/opensvitlobot.ino`
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
| `GET` | `/ping?key=DEVICE_KEY` | Device heartbeat |
| `GET` | `/api/status` | Current status of all devices |
| `GET` | `/api/devices` | List registered devices |
| `GET` | `/api/outages?days=7` | Outage history |
| `GET` | `/api/stats?period=7d` | Aggregated statistics |
| `POST` | `/api/register` | Register new device |

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
