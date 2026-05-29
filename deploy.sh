#!/bin/bash
# C8 Dashboard - Quick Deploy Script
# Jalankan di VPS baru: bash deploy.sh

set -e

echo "🚀 C8 Dashboard Deploy"

# Install Node.js if not installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check .env
if [ ! -f .env ]; then
    echo "⚠️  .env not found! Copy .env.example to .env and add your mnemonics:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# Start services
echo "🚀 Starting services..."
pm2 delete c8-dashboard 2>/dev/null || true
pm2 delete c8-fetcher 2>/dev/null || true
pm2 start server.js --name c8-dashboard
pm2 start fetcher.mjs --name c8-fetcher
pm2 save

echo ""
echo "✅ Deploy complete!"
echo "📊 Dashboard: http://localhost:3456"
echo ""
echo "Next steps:"
echo "1. Setup nginx: sudo cp deploy/nginx.conf /etc/nginx/sites-available/c8"
echo "2. Enable site: sudo ln -s /etc/nginx/sites-available/c8 /etc/nginx/sites-enabled/"
echo "3. Setup SSL: sudo certbot --nginx -d yourdomain.com"
echo "4. PM2 startup: pm2 startup && pm2 save"
