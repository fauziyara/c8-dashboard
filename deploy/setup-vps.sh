#!/bin/bash
# ═══════════════════════════════════
#   VPS Setup — Install Dependencies
# ═══════════════════════════════════
set -e

echo "[1/5] Update packages..."
sudo apt-get update -qq

echo "[2/5] Install Node.js (if needed)..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v)"

echo "[3/5] Install Nginx (if needed)..."
if ! command -v nginx &> /dev/null; then
  sudo apt-get install -y -qq nginx
fi
sudo systemctl enable nginx
echo "  Nginx: installed"

echo "[4/5] Install PM2..."
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2
fi
echo "  PM2: $(pm2 -v)"

echo "[5/5] Install Certbot (SSL)..."
if ! command -v certbot &> /dev/null; then
  sudo apt-get install -y -qq certbot python3-certbot-nginx
fi
echo "  Certbot: installed"

echo ""
echo "✅ VPS setup complete!"
echo ""
