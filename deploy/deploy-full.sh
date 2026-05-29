#!/bin/bash
# ═══════════════════════════════════
#   C8 Dashboard — One-Click Deploy
# ═══════════════════════════════════
set -e
cd /opt/c8-dashboard

echo ""
echo "╔═══════════════════════════════════╗"
echo "║    C8 DASHBOARD DEPLOYER v2       ║"
echo "╚═══════════════════════════════════╝"
echo ""

# 1. Install deps
echo "[1/4] npm install..."
npm install --production 2>&1 | tail -3

# 2. Setup Nginx
echo ""
echo "[2/4] Nginx config..."
sudo cp deploy/nginx.conf /etc/nginx/sites-available/c8-dashboard
sudo ln -sf /etc/nginx/sites-available/c8-dashboard /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "  ✅ Nginx configured"

# 3. SSL
echo ""
echo "[3/4] SSL certificate..."
if [ -f /etc/letsencrypt/live/karditohir.online/fullchain.pem ]; then
  echo "  ✅ SSL already exists"
else
  echo "  ⚠️  Getting SSL cert..."
  sudo certbot --nginx -d karditohir.online -d www.karditohir.online --non-interactive --agree-tos --email admin@karditohir.online || echo "  ⚠️  SSL failed — run manually: sudo certbot --nginx -d karditohir.online"
fi

# 4. PM2
echo ""
echo "[4/4] Starting PM2..."
pm2 delete c8-dashboard 2>/dev/null || true

# Copy .env.production to .env
cp .env.production .env

pm2 start server.js --name c8-dashboard --cwd /opt/c8-dashboard --env production
pm2 save
echo "  ✅ PM2 started"

echo ""
echo "╔═══════════════════════════════════╗"
echo "║      DEPLOY COMPLETE! ✅          ║"
echo "╠═══════════════════════════════════╣"
echo "║  https://karditohir.online        ║"
echo "║  Command: /command                ║"
echo "║  Logs: pm2 logs c8-dashboard      ║"
echo "╚═══════════════════════════════════╝"
echo ""
