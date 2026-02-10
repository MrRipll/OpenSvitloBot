# OpenSvitloBot

Open-source, self-deployable power outage monitoring system for Ukrainian households.

Deploy your own instance on Cloudflare Workers (free tier) and monitor power outages with ESP8266/ESP32 devices and Telegram notifications.

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

## Deploy Your Own (5 minutes, no coding)

### Step 1 — Create your own copy

Click **"Use this template"** → **"Create a new repository"** at the top of this page.
Name it anything you like (e.g. `my-svitlobot`) and make it **public**.

### Step 2 — Create a Cloudflare account

Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (free).

### Step 3 — Create a D1 database

1. In Cloudflare dashboard, go to **Workers & Pages → D1 SQL Database**
2. Click **Create**
3. Name it `opensvitlobot-db`, pick a region close to you
4. Click **Create**
5. Copy the **Database ID** (you'll need it in Step 5)

### Step 4 — Create a Cloudflare API token

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use the **"Edit Cloudflare Workers"** template
4. Click **Continue to summary** → **Create Token**
5. Copy the token (you'll need it in Step 5)

### Step 5 — Set up GitHub secrets

In **your new repo** go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | The API token from Step 4 |
| `CLOUDFLARE_D1_DATABASE_ID` | The Database ID from Step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | From Cloudflare dashboard URL: `dash.cloudflare.com/<THIS_PART>/...` |

### Step 6 — Deploy

Go to **Actions** tab in your repo, select **"Deploy Worker"**, click **"Run workflow"**.
The Worker will be deployed and the database tables will be created automatically.

Your Worker URL will be: `https://opensvitlobot.<your-subdomain>.workers.dev`

### Step 7 — Set up Telegram notifications

In Cloudflare dashboard go to **Workers & Pages → opensvitlobot → Settings → Variables and Secrets** and add:

| Secret | How to get it |
|--------|--------------|
| `TELEGRAM_BOT_TOKEN` | Create a bot via [@BotFather](https://t.me/BotFather) on Telegram |
| `TELEGRAM_CHAT_ID` | Send a message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` |

### Step 8 — Register a device

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

### Step 9 — Flash an ESP device

**Option A: Web Installer** (no IDE needed)
- Visit the [Web Installer](https://MrRipll.github.io/OpenSvitloBot/firmware/web-installer/) in Chrome/Edge
- Select your board, connect via USB, flash
- Configure via Serial Monitor (115200 baud)

**Option B: Arduino IDE**
- Open `firmware/esp8266/opensvitlobot.ino` or `firmware/esp32/opensvitlobot.ino`
- Upload to your board
- Configure via Serial Monitor

### Step 10 — View the dashboard

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
