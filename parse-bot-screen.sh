#!/bin/bash
# Parse ALL C8 bot screens to JSON
# For Tencent VPS with multiple bot screens

TMPDIR="/tmp/bot_screens"
mkdir -p "$TMPDIR"

# Get all c8 screen names
SCREENS=$(screen -ls 2>/dev/null | grep -oP '\d+\.c8\w+' | sed 's/^[0-9]*\.//' | sort)

if [ -z "$SCREENS" ]; then
    echo '{"error":"no c8 screens found","wallets":[],"tot":null,"count":0}'
    exit 0
fi

# Capture each screen
for name in $SCREENS; do
    screen -S "$name" -p 0 -X hardcopy "$TMPDIR/$name.txt" 2>/dev/null
done

# Parse all with Python
python3 << 'PYEOF'
import re, json, os, glob

tmpdir = '/tmp/bot_screens'
all_wallets = []
screens_parsed = 0

for filepath in sorted(glob.glob(os.path.join(tmpdir, '*.txt'))):
    screen_name = os.path.basename(filepath).replace('.txt', '')
    
    with open(filepath, 'rb') as f:
        raw = f.read()
    
    text = raw.replace(b'\x00', b'').decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    
    lines = text.split('\n')
    found = False
    
    for line in lines:
        cleaned = line.replace('\x02', '  ').strip()
        
        m = re.match(r'^(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([+-][\d.]+)\s+#(\d+)\s+(.+)$', cleaned)
        if m:
            all_wallets.append({
                'screen': screen_name,
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
            found = True
    
    if found:
        screens_parsed += 1

# Calculate totals
tot = None
if all_wallets:
    tot = {
        'cc': round(sum(w['cc'] for w in all_wallets), 2),
        'usdcx': round(sum(w['usdcx'] for w in all_wallets), 4),
        'ceth': round(sum(w['ceth'] for w in all_wallets), 8),
        'rcc': round(sum(w['rcc'] for w in all_wallets), 4),
        'swap': sum(w['swap'] for w in all_wallets),
        'reward': round(sum(w['reward'] for w in all_wallets), 2),
        'drew_val': round(sum(float(w['drew'].replace('+','')) for w in all_wallets), 2),
    }
    tot['drew'] = f"+{tot['drew_val']}" if tot['drew_val'] >= 0 else str(tot['drew_val'])

result = {
    'wallets': all_wallets,
    'tot': tot,
    'count': len(all_wallets),
    'screens': screens_parsed
}
print(json.dumps(result))
PYEOF
