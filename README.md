# OpenSvitloBot

Open-source, self-deployable power outage monitoring system for Ukrainian households.

Deploy your own instance on Cloudflare Workers (free tier) and monitor power outages with ESP8266/ESP32 devices and Telegram notifications.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/MrRipll/OpenSvitloBot)

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

## Quick Start

### 1. Deploy to Cloudflare (one click)

Click the **Deploy to Cloudflare** button above. Log in with a free Cloudflare account and follow the prompts. The database tables are created automatically on first request.

### 2. Set up Telegram notifications

In the Cloudflare dashboard go to **Workers & Pages > opensvitlobot > Settings > Variables and Secrets** and add:

| Secret | How to get it |
|--------|--------------|
| `TELEGRAM_BOT_TOKEN` | Create a bot via [@BotFather](https://t.me/BotFather) on Telegram |
| `TELEGRAM_CHAT_ID` | Send a message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` |

### 3. Register a Device

```bash
curl -X POST https://your-worker.workers.dev/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Living Room", "group_name": "Apartment"}'
```

Save the `key` from the response — you'll need it for the ESP device.

### 4. Flash an ESP Device

**Option A: Web Installer** (no IDE needed)
- Visit the [Web Installer](https://MrRipll.github.io/OpenSvitloBot/firmware/web-installer/) in Chrome/Edge
- Select your board, connect via USB, flash
- Configure via Serial Monitor (115200 baud)

**Option B: Arduino IDE**
- Open `firmware/esp8266/opensvitlobot.ino` or `firmware/esp32/opensvitlobot.ino`
- Upload to your board
- Configure via Serial Monitor

### 5. View Dashboard

Visit the [Dashboard](https://MrRipll.github.io/OpenSvitloBot/dashboard/) and enter your Worker URL.

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

## Project Structure

```
worker/          Cloudflare Worker (TypeScript)
dashboard/       Static dashboard (GitHub Pages)
firmware/        ESP8266 & ESP32 Arduino sketches
  web-installer/ Browser-based firmware flasher
.github/         CI/CD workflows
```

## Cost

| Devices | Monthly Cost |
|---------|-------------|
| 1–50 | **$0** (Cloudflare free tier) |
| 50–7000 | **$5** (Workers paid) |

## License

MIT
