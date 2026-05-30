#!/bin/bash
# Parse C8 bot screen output to JSON
# Used by fetcher.mjs to get bot-specific swap count, rank, status

SCREEN_NAME="c8sebelas"
TMPFILE="/tmp/bot_screen_parse.txt"

# Capture screen output
screen -S "$SCREEN_NAME" -p 0 -X hardcopy "$TMPFILE" 2>/dev/null

if [ ! -f "$TMPFILE" ]; then
    echo '{"error":"screen not found"}'
    exit 1
fi

python3 << 'PYEOF'
import re, json

with open('/tmp/bot_screen_parse.txt', 'rb') as f:
    raw = f.read()

text = raw.replace(b'\x00', b'').decode('utf-8', errors='replace')
text = re.sub(r'\x1b\[[0-9;]*m', '', text)

lines = text.split('\n')
wallets = []
tot = None

for line in lines:
    cleaned = line.replace('\x02', '  ').strip()
    
    m = re.match(r'^(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([+-][\d.]+)\s+#(\d+)\s+(.+)$', cleaned)
    if m:
        wallets.append({
            'num': int(m.group(1)),
            'cc': float(m.group(2)),
            'usdcx': float(m.group(3)),
            'ceth': float(m.group(4)),
            'rcc': float(m.group(5)),
            'swap': int(m.group(6)),
            'uptime': m.group(7),
            'reward': float(m.group(8)),
            'drew': m.group(9),
            'rank': int(m.group(10)),
            'status': m.group(11).strip()
        })
    
    m2 = re.match(r'^TOT\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S*)\s+([\d.]+)\s+([+-][\d.]+)', cleaned)
    if m2:
        tot = {
            'cc': float(m2.group(1)),
            'usdcx': float(m2.group(2)),
            'ceth': float(m2.group(3)),
            'rcc': float(m2.group(4)),
            'swap': int(m2.group(5)),
            'uptime': m2.group(6),
            'reward': float(m2.group(7)),
            'drew': m2.group(8)
        }

result = {'wallets': wallets, 'tot': tot, 'count': len(wallets)}
print(json.dumps(result))
PYEOF
