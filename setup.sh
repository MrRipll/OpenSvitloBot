#!/bin/bash
# OpenSvitloBot — One-command setup script
# Usage: bash setup.sh

set -e

echo "=== OpenSvitloBot Setup ==="
echo ""

# Check prerequisites
if ! command -v npx &> /dev/null; then
  echo "Error: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

cd worker
npm install

# Login to Cloudflare if needed
echo ""
echo "Logging in to Cloudflare..."
npx wrangler whoami 2>/dev/null || npx wrangler login

# Create D1 database
echo ""
echo "Creating D1 database..."
DB_OUTPUT=$(npx wrangler d1 create opensvitlobot-db 2>&1) || {
  echo "Database may already exist, continuing..."
  DB_OUTPUT=""
}

DB_ID=$(echo "$DB_OUTPUT" | grep 'database_id' | sed 's/.*= "\(.*\)"/\1/')

if [ -n "$DB_ID" ]; then
  echo "Database created with ID: $DB_ID"

  # Write local config with the real database ID
  cat > .wrangler.toml <<EOF
name = "opensvitlobot"
main = "src/index.ts"
compatibility_date = "2024-05-12"

[triggers]
crons = ["* * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "opensvitlobot-db"
database_id = "$DB_ID"

[vars]
CORS_ORIGIN = "*"
EOF

  echo "Wrote .wrangler.toml with database ID"
else
  echo "Could not extract database ID. Edit worker/.wrangler.toml manually."
  echo "Run: npx wrangler d1 list  — to find your database ID"
fi

# Initialize schema
echo ""
echo "Initializing database schema..."
npx wrangler d1 execute opensvitlobot-db --remote --file=./schema.sql

# Deploy worker
echo ""
echo "Deploying worker..."
npx wrangler deploy -c .wrangler.toml

# Set Telegram secrets
echo ""
echo "=== Telegram Setup ==="
echo "Enter your Telegram Bot Token (from @BotFather):"
npx wrangler secret put TELEGRAM_BOT_TOKEN

echo ""
echo "Enter your Telegram Chat ID:"
npx wrangler secret put TELEGRAM_CHAT_ID

echo ""
echo "=== Setup Complete ==="
echo "Your worker is deployed! Check the URL above."
echo "Next: flash an ESP device and register it with POST /api/register"
