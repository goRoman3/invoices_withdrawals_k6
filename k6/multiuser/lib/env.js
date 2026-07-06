// multiuser/lib/env.js — лёгкий ридер __ENV для мульти-юзер тестов.
// Не тянет lib/config.js, чтобы не требовать single-user креды (USERNAME/PASSWORD/OTP_SECRET).
// Все переменные — те же, что и у стандартного флоу (единый .env.local).

function env(name, def = '') {
  const v = __ENV[name];
  if (v === undefined || v === null) return def;
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s === '' ? def : s;
}

// --- API / Keycloak ---
export const API_BASE_URL      = env('BASE_URL');
export const KEYCLOAK_TOKEN_URL = env('KEYCLOAK_TOKEN_URL');
export const CLIENT_ID         = env('CLIENT_ID', 'crm-api');
export const CLIENT_SECRET     = env('CLIENT_SECRET');
export const SCOPE             = env('SCOPE', 'openid email profile roles organization:*');
export const OTP_FIELD         = env('OTP_FIELD', 'otp'); // поле OTP в теле логина KC

// --- Subproject ---
export const SUBPROJECT_ID     = env('SUBPROJECT_ID');
export const SUBPROJECT_HEADER = env('SUBPROJECT_HEADER', 'x-subproject-id');

// --- Бизнес-параметры ---
export const ASSET_UUID   = env('ASSET_UUID');
export const WD_RECIPIENT = env('WD_RECIPIENT');
export const WD_AMOUNT    = env('WD_AMOUNT', '50');
export const WD_AML       = env('WD_AML', 'HIGH');
export const PAYOUT_AML   = env('PAYOUT_AML', 'HIGH');

// --- Прогон мульти-юзер сценариев ---
export const MU_VUS      = env('MU_VUS');       // пусто => по числу юзеров в пуле
export const MU_DURATION = env('MU_DURATION', '2m');
