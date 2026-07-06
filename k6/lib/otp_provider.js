// k6/lib/otp_provider.js — берём текущий OTP c локального Node-сервера
import http from 'k6/http';
import { config } from './config.js';

const DEFAULT_URL = 'http://127.0.0.1:8787/otp';

export function fetchOtp() {
  const url = config.get('OTP_PROVIDER_URL', DEFAULT_URL);
  const res = http.get(url, { timeout: '2s', tags: { op: 'fetch_otp' } });
  if (res.status !== 200) {
    throw new Error(`OTP provider HTTP ${res.status}: ${res.body}`);
  }
  let code = '';
  try {
    const j = res.json();
    code = String(j.otp || '').trim();
  } catch (_) {
    // fallback: попытка из строки
    const m = String(res.body || '').match(/"otp"\s*:\s*"(\d{6})"/);
    code = m ? m[1] : '';
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`OTP provider returned invalid code: '${code}'`);
  }
  return code;
}
