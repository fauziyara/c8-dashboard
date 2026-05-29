// ══════════════════════════════════════════════════════════
//   C8 Dashboard — Auto Fetcher
//   Fetch rewards + balance → push to dashboard API
// ══════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import 'dotenv/config';
import axios from 'axios';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ─── Config ───
const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf-8'));
const BACKEND = config.api.backend_url;
const SWAP_API = config.api.swap_url;

const DASHBOARD_URL = 'http://127.0.0.1:3456';
const DASHBOARD_KEY = 'c8dashboard2025';
const VPS_ID = 'vps1-c8new';
const FETCH_INTERVAL = 30000; // 30 detik

const BASE_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'C8-Dashboard-Fetcher/1.0',
    'Origin': 'https://wallet.cantor8.tech',
    'Referer': 'https://wallet.cantor8.tech/',
};

// ─── Load Accounts ───
function loadAccounts() {
    const accounts = [];
    let i = 1;
    while (process.env[`ACCOUNT_${i}_MNEMONIC`]) {
        accounts.push({
            name: process.env[`ACCOUNT_${i}_NAME`] || `Account ${i}`,
            mnemonic: process.env[`ACCOUNT_${i}_MNEMONIC`].trim(),
            proxy: process.env[`ACCOUNT_${i}_PROXY`] || null,
        });
        i++;
    }
    return accounts;
}

// ─── HTTP ───
function createAxiosInstance() {
    return axios.create({
        timeout: 60000,
        headers: BASE_HEADERS,
    });
}

function createWalletApi(ax) {
    return {
        recoverAccount: (keys) =>
            ax.post(`${BACKEND}/accounts/recovery_v3`, { public_keys: keys }, { headers: BASE_HEADERS }).then(r => r.data),
        getBalance: (token) =>
            ax.get(`${BACKEND}/balance`, { headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` } }).then(r => r.data),
        getChallenge: (pid) =>
            ax.post(`${BACKEND}/auth/challenge`, { party_id: pid }, { headers: BASE_HEADERS }).then(r => r.data),
        login: (pid, ch, sig) =>
            ax.post(`${BACKEND}/auth/login`, { party_id: pid, challenge: ch, signature: sig }, { headers: BASE_HEADERS }).then(r => r.data),
    };
}

function createSwapApi(ax) {
    return {
        getLeaderboard: (address = null) =>
            ax.get(`${SWAP_API}/leaderboard`, {
                params: { limit: 50, includeRewards: true, includeAll: true, ...(address ? { address } : {}) },
                headers: BASE_HEADERS,
            }).then(r => r.data),
    };
}

// ─── Crypto ───
const derivation = config.derivation || { path_prefix: "m/501'/800245900'/0'", path_suffix: "0'", key_count: 20 };

function generateKeyPairs(mnemonic) {
    const seed = mnemonicToSeedSync(mnemonic, '');
    const hdkey = HDKey.fromMasterSeed(seed);
    const keyPairs = [];
    for (let i = 0; i < derivation.key_count; i++) {
        const path = `${derivation.path_prefix}/${i}'/${derivation.path_suffix}`;
        const child = hdkey.derive(path);
        const privateKey = child.privateKey;
        if (!privateKey || privateKey.length !== 32) throw new Error(`Key derivation failed at ${path}`);
        const publicKey = ed.getPublicKey(privateKey);
        keyPairs.push({ index: i, path, privateKey, publicKey, publicKeyHex: Buffer.from(publicKey).toString('hex') });
    }
    return keyPairs;
}

function signMessage(privateKey, message) {
    const msg = typeof message === 'string' ? new TextEncoder().encode(message) : message;
    return ed.sign(msg, privateKey);
}

function toHex(bytes) { return Buffer.from(bytes).toString('hex'); }

// ─── Retry ───
async function retry(fn, { maxRetries = 3, baseDelay = 2, label = '' } = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try { return await fn(); }
        catch (err) {
            if (attempt === maxRetries) throw err;
            const delay = baseDelay * Math.pow(2, attempt) + Math.random();
            console.log(`  ⚠️  ${label} attempt ${attempt + 1} failed, retry in ${delay.toFixed(1)}s...`);
            await new Promise(r => setTimeout(r, delay * 1000));
        }
    }
}

// ─── Fetch Reward ───
async function fetchReward(account) {
    const ax = createAxiosInstance();
    const walletApi = createWalletApi(ax);
    const swapApi = createSwapApi(ax);

    const keyPairs = generateKeyPairs(account.mnemonic);
    const recovery = await retry(() => walletApi.recoverAccount(keyPairs.map(k => k.publicKeyHex)), { label: `${account.name}:recover` });

    const matchIdx = (recovery.results || []).findIndex(r => r !== null);
    if (matchIdx === -1) throw new Error('No account found');

    const acct = recovery.results[matchIdx];
    const partyId = acct.party_id;
    const wallet = partyId;

    const lb = await retry(() => swapApi.getLeaderboard(partyId), { label: `${account.name}:leaderboard` });
    const me = lb?.requestedAddress || null;

    return {
        wallet,
        unclaimed: Number(me?.rewardAccruedCc ?? 0),
        claimed: Number(me?.rewardTotalCc ?? 0),
        rCC: Number(me?.rebate ?? 0),
    };
}

// ─── Fetch Balance ───
async function fetchBalance(account) {
    const ax = createAxiosInstance();
    const walletApi = createWalletApi(ax);

    const keyPairs = generateKeyPairs(account.mnemonic);
    const recovery = await retry(() => walletApi.recoverAccount(keyPairs.map(k => k.publicKeyHex)), { label: `${account.name}:recover` });

    const matchIdx = (recovery.results || []).findIndex(r => r !== null);
    if (matchIdx === -1) throw new Error('No account found');

    const acct = recovery.results[matchIdx];
    const partyId = acct.party_id;
    const keyPair = keyPairs[matchIdx];

    const authData = await retry(async () => {
        const { challenge } = await walletApi.getChallenge(partyId);
        const sig = toHex(signMessage(keyPair.privateKey, challenge));
        return await walletApi.login(partyId, challenge, sig);
    }, { label: `${account.name}:login` });

    const token = authData.access_token;
    const authHeaders = { ...BASE_HEADERS, Authorization: `Bearer ${token}` };

    // Fetch from both /balance and /holdings for complete coverage
    const [balance, holdingsResp] = await Promise.all([
        retry(() => walletApi.getBalance(token), { label: `${account.name}:balance` }),
        retry(() => ax.get(`${BACKEND}/holdings`, { headers: authHeaders }).then(r => r.data), { label: `${account.name}:holdings` }),
    ]);

    // Method 1: /balance endpoint (object format)
    const holdings = balance?.holdings || {};
    let cc = Number(holdings?.['Amulet']?.balance || holdings?.['CC (Amulet)']?.balance || holdings?.['CC']?.balance || 0);
    let rcc = Number(holdings?.['rCC']?.balance || 0);
    let usdcx = Number(holdings?.['USDCx']?.balance || holdings?.['USDCX']?.balance || 0);
    let ceth = Number(holdings?.['cETH']?.balance || holdings?.['CETH']?.balance || holdings?.['Ceth']?.balance || 0);

    // Method 2: /holdings endpoint (array format) — catches USDCx and other tokens
    const holdingsArray = holdingsResp?.holdings || [];
    if (Array.isArray(holdingsArray)) {
        for (const h of holdingsArray) {
            const id = (h.instrument_id?.id || '').toLowerCase();
            const amount = Number(h.amount || 0);
            if (id === 'usdcx' || id === 'usdc' || id.includes('usdc')) usdcx += amount;
            else if (id === 'ceth' || id === 'ceth') ceth += amount;
        }
    }

    return { CC: cc, rCC: rcc, USDCx: usdcx, cETH: ceth };
}

// ─── Fetch USD/IDR Rate ───
async function fetchUsdToIdr() {
    try {
        const resp = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 10000 });
        return resp.data?.rates?.IDR || 16500;
    } catch {
        return 16500;
    }
}

// ─── Fetch CC Price from Bybit ───
async function fetchCCPrice() {
    try {
        const resp = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot&symbol=CCUSDT', { timeout: 10000 });
        const data = resp.data?.result?.list?.[0];
        if (data) {
            return {
                price: parseFloat(data.lastPrice) || 0.16,
                change24h: parseFloat(data.price24hPcnt) || 0,
                high24h: parseFloat(data.highPrice24h) || 0,
                low24h: parseFloat(data.lowPrice24h) || 0,
                volume24h: parseFloat(data.turnover24h) || 0,
            };
        }
    } catch (err) {
        console.log(`  ⚠️  CC price fetch failed: ${err.message}`);
    }
    return { price: 0.16, change24h: 0, high24h: 0, low24h: 0, volume24h: 0 };
}

// ─── Fetch ETH Price from Bybit ───
async function fetchETHPrice() {
    try {
        const resp = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot&symbol=ETHUSDT', { timeout: 10000 });
        const data = resp.data?.result?.list?.[0];
        if (data) return parseFloat(data.lastPrice) || 2500;
    } catch (err) {
        console.log(`  ⚠️  ETH price fetch failed: ${err.message}`);
    }
    return 2500;
}

// ─── Fetch All ───
async function fetchAll(accounts) {
    const startTime = Date.now();
    const wallets = [];
    const lastWallets = new Map((lastPushedData?.wallets || []).filter(w => !w.error).map(w => [w.name, w]));
    let totalUnclaimed = 0, totalClaimed = 0, totalRCC = 0, totalCC = 0, totalUSDCx = 0, totalCETH = 0;
    let successCount = 0, failCount = 0;

    // Fetch prices first
    const ccPrice = await fetchCCPrice();
    const ethPrice = await fetchETHPrice();
    const usdToIdr = await fetchUsdToIdr();
    console.log(`  💰 CC Price: $${ccPrice.price} (${(ccPrice.change24h * 100).toFixed(2)}% 24h) | USD/IDR: ${usdToIdr}`);

    for (const acc of accounts) {
        try {
            console.log(`  📡 ${acc.name}...`);
            const [reward, balance] = await Promise.all([
                fetchReward(acc),
                fetchBalance(acc),
            ]);

            totalUnclaimed += reward.unclaimed;
            totalClaimed += reward.claimed;
            totalRCC += reward.rCC;
            totalCC += balance.CC;
            totalUSDCx += balance.USDCx;
            totalCETH += balance.cETH;
            successCount++;

            wallets.push({
                name: acc.name,
                wallet: reward.wallet,
                rewards: { unclaimed: reward.unclaimed, claimed: reward.claimed, rCC: reward.rCC },
                balance: { CC: balance.CC, rCC: balance.rCC, USDCx: balance.USDCx, cETH: balance.cETH },
            });
        } catch (err) {
            failCount++;
            // Keep last known data instead of showing error
            const lastData = lastWallets.get(acc.name);
            if (lastData) {
                wallets.push(lastData);
                console.log(`  ⚠️  ${acc.name}: API timeout, using cached data`);
            } else {
                wallets.push({ name: acc.name, error: err.message });
            }
            console.log(`  ❌ ${acc.name}: ${err.message}`);
        }
    }

    return {
        vps_id: VPS_ID,
        timestamp: new Date().toISOString(),
        fetchTime: Date.now() - startTime,
        wallets,
        summary: {
            total: accounts.length,
            success: successCount,
            failed: failCount,
            unclaimed: Math.round(totalUnclaimed * 100) / 100,
            claimed: Math.round(totalClaimed * 100) / 100,
            rCC: Math.round(totalRCC * 100) / 100,
            portfolio: Math.round((totalCC + totalUnclaimed + totalRCC) * 100) / 100,
            totalCC: Math.round(totalCC * 100) / 100,
            totalUSDCx: Math.round(totalUSDCx * 10000) / 10000,
            totalCETH: Math.round(totalCETH * 1000000) / 1000000,
        },
        price: ccPrice,
        ethPrice: ethPrice,
        usdToIdr: usdToIdr,
    };
}

// ─── Push to Dashboard ───
let lastPushedData = null;
async function pushToDashboard(data) {
    try {
        const resp = await axios.post(`${DASHBOARD_URL}/api/push`, data, {
            headers: { 'Content-Type': 'application/json', 'x-api-key': DASHBOARD_KEY },
            timeout: 10000,
        });
        lastPushedData = data;
        console.log(`  ✅ Pushed to dashboard (${resp.data.success ? 'OK' : 'FAIL'})`);
    } catch (err) {
        console.log(`  ❌ Push failed: ${err.message}`);
    }
}

// ─── Main Loop ───
async function main() {
    const accounts = loadAccounts();
    if (accounts.length === 0) {
        console.error('❌ No accounts found in .env');
        process.exit(1);
    }

    console.log('');
    console.log('  💰 C8 Dashboard Fetcher');
    console.log(`  📊 ${accounts.length} wallets`);
    console.log(`  🔄 Interval: ${FETCH_INTERVAL / 1000}s`);
    console.log(`  📡 Dashboard: ${DASHBOARD_URL}`);
    console.log('');

    while (true) {
        const ts = new Date().toLocaleTimeString('id-ID');
        console.log(`[${ts}] Fetching data...`);

        const data = await fetchAll(accounts);
        await pushToDashboard(data);

        const next = new Date(Date.now() + FETCH_INTERVAL).toLocaleTimeString('id-ID');
        console.log(`  ⏳ Next fetch: ${next}`);
        console.log('');

        await new Promise(r => setTimeout(r, FETCH_INTERVAL));
    }
}

main().catch(err => {
    console.error('❌ Fatal:', err.message);
    process.exit(1);
});
