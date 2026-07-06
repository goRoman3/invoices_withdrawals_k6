// multiuser/payout.test.js — мульти-юзер стресс: массовый payout из CSV (multipart).
// Каждый VU логинится под своим юзером пула и генерит собственный OTP.
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';
import { generateTOTP } from '../lib/totp.js';
import { login } from './lib/login.js';
import { users } from './lib/users.local.js';
import {
  API_BASE_URL, SUBPROJECT_ID, SUBPROJECT_HEADER,
  ASSET_UUID, PAYOUT_AML, MU_VUS, MU_DURATION,
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

export const payout_calc_ok  = new Counter('payout_calc_ok');
export const payout_calc_err = new Counter('payout_calc_err');
export const payout_send_ok  = new Counter('payout_send_ok');
export const payout_send_err = new Counter('payout_send_err');
export const payout_calc_t   = new Trend('payout_calc', true);
export const payout_t        = new Trend('payout', true);
export const network_fee     = new Trend('network_fee');

const file = open('./data/payout.csv');

export function setup() {
  console.log('=== Payout (multi-user) ===');
  console.log(`VUs: ${VUS}, duration: ${MU_DURATION}, users in pool: ${users.length}`);
  console.log(`Started at: ${new Date().toISOString()}`);
}

export default function () {
  const prefix = `[VU ${__VU}] [Iter ${__ITER}]:`;
  const user = users[(__VU - 1) % users.length];

  const access_token = login(user, generateTOTP(user.otpSecret));

  const commonHeaders = (extra = {}) => ({
    Authorization: `Bearer ${access_token}`,
    [SUBPROJECT_HEADER]: SUBPROJECT_ID,
    ...extra,
  });

  // ===== 1) CALCULATE =====
  const calcForm = new FormData();
  calcForm.append('file', http.file(file, 'payout.csv'));
  calcForm.append('assetUuid', ASSET_UUID);
  calcForm.append('amlRiskLevel', PAYOUT_AML);

  const calcRes = http.post(`${API_BASE_URL}/payout/calculate`, calcForm.body(), {
    headers: commonHeaders({ 'Content-Type': `multipart/form-data; boundary=${calcForm.boundary}` }),
    tags: { slo: true, op: 'payout_calc' },
  });
  payout_calc_t.add(calcRes.timings.waiting);

  const calc = calcRes.json();
  if (!calc || calc.error || !calc.data) {
    console.error(`${prefix} payout calc failed - ${calc && calc.error ? calc.error.message : calcRes.status}`);
    payout_calc_err.add(1);
    return;
  }
  const fee = calc.data.fees.networkFees.networkFee;
  network_fee.add(fee);
  payout_calc_ok.add(1);

  // ===== 2) CREATE =====
  const createForm = new FormData();
  createForm.append('file', http.file(file, 'payout.csv'));
  createForm.append('assetUuid', ASSET_UUID);
  createForm.append('amlRiskLevel', PAYOUT_AML);
  createForm.append('networkFee', String(fee));
  createForm.append('label', `${prefix} ${new Date().toISOString()}`);

  const createRes = http.post(`${API_BASE_URL}/payout/create`, createForm.body(), {
    headers: commonHeaders({
      'Content-Type': `multipart/form-data; boundary=${createForm.boundary}`,
      'x-otp': generateTOTP(user.otpSecret),
    }),
    tags: { slo: true, op: 'payout_send' },
  });
  payout_t.add(createRes.timings.waiting);

  const created = createRes.json();
  if (!created || created.error || !created.data) {
    console.error(`${prefix} payout create failed - ${created && created.error ? created.error.message : createRes.status}`);
    payout_send_err.add(1);
    return;
  }
  payout_send_ok.add(1);
}

export function teardown() {
  console.log(`=== Payout (multi-user) finished at ${new Date().toISOString()} ===`);
}
