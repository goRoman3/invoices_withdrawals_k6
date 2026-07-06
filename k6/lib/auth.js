// k6/lib/auth.js — централизованный login/refresh + базовые заголовки
import http from 'k6/http';
import { sleep } from 'k6';
import { config } from './config.js';
import { generateTOTP } from './totp.js';

const STATE = { token: '', exp: 0 }; // exp — epoch seconds

function nowSec() { return Math.floor(Date.now() / 1000); }
function haveKC() {
  return !!(config.get('KEYCLOAK_TOKEN_URL') && config.get('CLIENT_ID') &&
            config.get('USERNAME') && config.get('PASSWORD'));
}

export function currentOtp() {
  const manual = config.get('OTP_MANUAL', '');
  if (manual) return manual;
  const secret = config.get('OTP_SECRET', '');
  return secret ? generateTOTP(secret) : '';
}

function loginKC() {
  const url = config.get('KEYCLOAK_TOKEN_URL');
  const form = {
    grant_type: 'password',
    client_id: config.get('CLIENT_ID'),
    username: config.get('USERNAME'),
    password: config.get('PASSWORD'),
    scope: config.get('SCOPE', 'openid email profile roles organization:*'),
  };
  const otp = currentOtp();
  const otpField = config.get('OTP_FIELD', 'totp');
  if (otp) form[otpField] = otp;

  const body = Object.keys(form).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`).join('&');
  const res = http.post(url, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    tags: { op: 'kc_login', slo: true },
  });

  if (res.status !== 200) {
    throw new Error(`Keycloak login failed: ${res.status} - ${String(res.body).slice(0,300)}`);
  }
  const j = res.json();
  const access = j.access_token;
  const ttl = Number(j.expires_in || 1800);
  if (!access) throw new Error(`Keycloak login: empty access_token. Body: ${res.body}`);

  STATE.token = access;
  STATE.exp = nowSec() + Math.max(30, ttl - 10); // небольшой запас
  return STATE.token;
}

export function ensureValidToken() {
  if (!STATE.token) {
    const manual = config.get('ACCESS_TOKEN_MANUAL', '');
    if (manual) {
      STATE.token = manual;
      STATE.exp = nowSec() + 900; // если exp не знаем — обновим через ~15 мин
    }
  }
  if (nowSec() >= STATE.exp && haveKC()) {
    loginKC();
    sleep(0.05);
  }
  return STATE.token;
}

export function refreshAuth() {
  if (!haveKC()) { STATE.token = ''; STATE.exp = 0; return ''; }
  const t = loginKC();
  sleep(0.05);
  return t;
}

export function getAuthHeaders(extra = {}) {
  const t = ensureValidToken();
  const headers = {
    'Authorization': t ? `Bearer ${t}` : '',
    'User-Agent': `k6-load-test/1.0 (VU: ${__VU || 0})`,
  };
  // x-subproject-id если задан
  const subHeader = config.get('SUBPROJECT_HEADER', 'x-subproject-id');
  const subId = config.get('SUBPROJECT_ID', '');
  if (subHeader && subId) headers[subHeader] = subId;

  // смержим дополнительное (например X-OTP)
  return Object.assign(headers, extra);
}
