// k6/flows/withdrawals.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from '../lib/config.js';
import { getAuthHeaders, refreshAuth } from '../lib/auth.js';
import { fetchOtp } from '../lib/otp_provider.js'; // NEW
import { Counter } from 'k6/metrics';

export const withdraw_calc_ok = new Counter('withdraw_calc_ok');
export const withdraw_send_ok = new Counter('withdraw_send_ok');
export const withdraw_send_err = new Counter('withdraw_send_err');

function baseHeaders() {
  const auth = getAuthHeaders();
  const subHeader = config.get('SUBPROJECT_HEADER', 'x-subproject-id');
  const subId = config.get('SUBPROJECT_ID', '');
  return {
    'Cache-Control': 'no-cache',
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...auth,
    ...(subId ? { [subHeader]: subId } : {}),
    'User-Agent': `k6-load-test/1.0 (VU: ${__VU})`,
  };
}

function payloadCalc() {
  return {
    assetUuid: config.get('ASSET_UUID'),
    expectedAssetAmount: String(config.get('WD_AMOUNT', '10')),
    recipientAddress: config.get('WD_RECIPIENT', 'TAPPzcoEzAdaG6fR8rsrRTmi9avbMuuRH3'),
    amlRiskLevel: config.get('WD_AML', 'MEDIUM'),
    memo: null,
    note: null,
    clientAddressUuid: null,
    type: 'DEFAULT',
  };
}

export function createWithdrawalTwoStep() {
  const baseUrl = config.get('BASE_URL');
  const calcUrl = `${baseUrl}/withdrawal/calculate`;
  const sendUrl = `${baseUrl}/withdrawal`;

  // ===== 1) CALCULATE (с OTP) =====
  let headers = baseHeaders();
  headers['X-OTP'] = fetchOtp(); // NEW

  let calcRes = http.post(calcUrl, JSON.stringify(payloadCalc()), { headers, tags: { slo: true, op: 'withdraw_calc' }});

  if (calcRes.status === 401 || calcRes.status === 403) {
    refreshAuth();
    sleep(0.2);
    headers = baseHeaders();
    headers['X-OTP'] = fetchOtp(); // NEW
    calcRes = http.post(calcUrl, JSON.stringify(payloadCalc()), { headers, tags: { slo: true, op: 'withdraw_calc' }});
  }

  const calcOk = check(calcRes, {
    'calc 2xx': (r) => r.status >= 200 && r.status < 300,
    'calc is JSON': (r) => { try { JSON.parse(r.body); return true; } catch { return false; } },
  });

  if (!calcOk) {
    const dbg = { ...headers }; if (dbg.Authorization) dbg.Authorization = '***masked***';
    throw new Error(`Withdraw calc failed: ${calcRes.status} - ${String(calcRes.body).slice(0,300)}\nHeaders: ${JSON.stringify(dbg)}`);
  }

  withdraw_calc_ok.add(1);
  const calcData = calcRes.json().data || calcRes.json();
  const networkFee = String(calcData?.fees?.networkFees?.networkFee || calcData?.fees?.networkFee || '0');

  // ===== 2) WITHDRAW (с OTP) =====
  const sendPayload = {
    amlRiskLevel: config.get('WD_AML', 'MEDIUM'),
    assetUuid: config.get('ASSET_UUID'),
    expectedAssetAmount: String(config.get('WD_AMOUNT', '10')),
    memo: null,
    note: null,
    recipientAddress: config.get('WD_RECIPIENT', 'TAPPzcoEzAdaG6fR8rsrRTmi9avbMuuRH3'),
    networkFee,
    clientAddressUuid: null,
    type: 'DEFAULT',
  };

  headers = baseHeaders();
  headers['X-OTP'] = fetchOtp(); // NEW

  let sendRes = http.post(sendUrl, JSON.stringify(sendPayload), { headers, tags: { slo: true, op: 'withdraw_send' }});

  if (sendRes.status === 401 || sendRes.status === 403) {
    refreshAuth();
    sleep(0.2);
    headers = baseHeaders();
    headers['X-OTP'] = fetchOtp(); // NEW
    sendRes = http.post(sendUrl, JSON.stringify(sendPayload), { headers, tags: { slo: true, op: 'withdraw_send' }});
  }

  const sendOk = check(sendRes, {
    'send 2xx': (r) => r.status >= 200 && r.status < 300,
    'send is JSON': (r) => { try { JSON.parse(r.body); return true; } catch { return false; } },
  });

  if (!sendOk) {
    const dbg = { ...headers }; if (dbg.Authorization) dbg.Authorization = '***masked***';
    withdraw_send_err.add(1);
    throw new Error(`Withdraw send failed: ${sendRes.status} - ${String(sendRes.body).slice(0,300)}\nHeaders: ${JSON.stringify(dbg)}`);
  }

  withdraw_send_ok.add(1);
  return sendRes.json().data || sendRes.json();
}
