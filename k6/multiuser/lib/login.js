// multiuser/lib/login.js — Keycloak password-login под конкретного юзера пула.
import http from 'k6/http';
import { KEYCLOAK_TOKEN_URL, CLIENT_ID, CLIENT_SECRET, SCOPE, OTP_FIELD } from './env.js';

export function login(user, otp) {
  const form = {
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username: user.username,
    password: user.password,
    scope: SCOPE,
  };
  if (otp) form[OTP_FIELD] = otp;

  const body = Object.keys(form)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`)
    .join('&');

  const res = http.post(KEYCLOAK_TOKEN_URL, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    tags: { op: 'kc_login', slo: true },
  });

  const j = res.json();
  const access = j && j.access_token;
  if (!access) {
    throw new Error(`KC login failed for ${user.username}: ${res.status} - ${String(res.body).slice(0, 200)}`);
  }
  return access;
}
