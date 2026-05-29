#!/bin/bash
# Auto-deploy from GitHub
# Dipanggil oleh webhook atau cron

cd /home/ubuntu/c8-dashboard

echo "[$(date)] Pulling latest..."
git pull origin main --force

echo "[$(date)] Restarting..."
pm2 restart c8-dashboard
pm2 restart c8-fetcher

echo "[$(date)] Done!"
