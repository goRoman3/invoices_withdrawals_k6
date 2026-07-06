// multiuser/withdrawal.test.js — мульти-юзер стресс: двухшаговый withdrawal.
// Каждый VU логинится под своим юзером пула и генерит собственный OTP.
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { generateTOTP } from '../lib/totp.js';
import { login } from './lib/login.js';
import { users } from './lib/users.local.js';
import {
  API_BASE_URL, SUBPROJECT_ID, SUBPROJECT_HEADER,
  ASSET_UUID, WD_RECIPIENT, WD_AMOUNT, WD_AML, MU_VUS, MU_DURATION,
} from './lib/env.js';

const VUS = Number(MU_VUS) || users.length;

export const options = {
  vus: VUS,
  duration: MU_DURATION,
  thresholds: {
    'http_req_failed{slo:true}': ['rate<0.1'],
    http_req_duration: ['p(95)<5000'],
  },
};

export const withdraw_calc_ok  = new Counter('withdraw_calc_ok');
export const withdraw_calc_err = new Counter('withdraw_calc_err');
export const withdraw_send_ok  = new Counter('withdraw_send_ok');
export const withdraw_send_err = new Counter('withdraw_send_err');
export const withdraw_calc_t   = new Trend('withdraw_calc', true);
export const withdraw_t        = new Trend('withdraw', true);
export const network_fee       = new Trend('network_fee');

export function setup() {
  console.log('=== Withdrawal (multi-user) ===');
  console.log(`VUs: ${VUS}, duration: ${MU_DURATION}, users in pool: ${users.length}`);
  console.log(`Started at: ${new Date().toISOString()}`);
}

export default function () {
  const prefix = `[VU ${__VU}] [Iter ${__ITER}]:`;
  const user = users[(__VU - 1) % users.length];

  const access_token = login(user, generateTOTP(user.otpSecret));

  const withdrawalBody = {
    assetUuid: ASSET_UUID,
    expectedAssetAmount: String(WD_AMOUNT),
    recipientAddress: WD_RECIPIENT,
    amlRiskLevel: WD_AML,
    memo: null,
    note: null,
    clientAddressUuid: null,
    type: 'DEFAULT',
  };

  const baseHeaders = (extra = {}) => ({
    Authorization: `Bearer ${access_token}`,
    [SUBPROJECT_HEADER]: SUBPROJECT_ID,
    'Content-Type': 'application/json',
    ...extra,
  });

  // ===== 1) CALCULATE =====
  const calcRes = http.post(`${API_BASE_URL}/withdrawal/calculate`, JSON.stringify(withdrawalBody), {
    headers: baseHeaders(),
    tags: { slo: true, op: 'withdraw_calc' },
  });
  withdraw_calc_t.add(calcRes.timings.waiting);

  const calc = calcRes.json();
  if (!calc || calc.error || !calc.data) {
    console.error(`${prefix} withdraw calc failed - ${calc && calc.error ? calc.error.message : calcRes.status}`);
    withdraw_calc_err.add(1);
    return;
  }
  const fee = calc.data.fees.networkFees.networkFee;
  network_fee.add(fee);
  withdraw_calc_ok.add(1);

  // ===== 2) WITHDRAW =====
  const sendRes = http.post(`${API_BASE_URL}/withdrawal`, JSON.stringify({ ...withdrawalBody, networkFee: fee }), {
    headers: baseHeaders({ 'x-otp': generateTOTP(user.otpSecret) }),
    tags: { slo: true, op: 'withdraw_send' },
  });
  withdraw_t.add(sendRes.timings.waiting);

  const sent = sendRes.json();
  if (!sent || sent.error || !sent.data) {
    console.error(`${prefix} withdraw send failed - ${sent && sent.error ? sent.error.message : sendRes.status}`);
    withdraw_send_err.add(1);
    return;
  }
  withdraw_send_ok.add(1);
}

export function teardown() {
  console.log(`=== Withdrawal (multi-user) finished at ${new Date().toISOString()} ===`);
}
