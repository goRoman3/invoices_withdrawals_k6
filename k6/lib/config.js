// k6/lib/config.js — чтение ENV + условная валидация
import { fail } from 'k6';

function readEnv(name, def = '') {
  // __ENV доступен в k6
  const v = __ENV[name];
  if (v === undefined || v === null) return def;
  // чистим кавычки/пробелы
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function toBool(v, def = false) {
  const s = (v ?? '').toString().trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return def;
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// ISO-строка «сейчас + N дней» — для дефолтного expiresAt, чтобы он не протухал
function isoInDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Собираем конфиг единообразно
const cfg = {
  // --- базовое API ---
  BASE_URL: readEnv('BASE_URL'),

  // --- Keycloak / OAuth ---
  ACCESS_TOKEN_MANUAL: readEnv('ACCESS_TOKEN_MANUAL'), // если задан — логин не обязателен
  KEYCLOAK_TOKEN_URL: readEnv('KEYCLOAK_TOKEN_URL'),
  CLIENT_ID: readEnv('CLIENT_ID'),
  CLIENT_SECRET: readEnv('CLIENT_SECRET'),
  USERNAME: readEnv('USERNAME'),
  PASSWORD: readEnv('PASSWORD'),
  SCOPE: readEnv('SCOPE', 'openid email profile roles organization:*'),

  // --- OTP ---
  OTP_MANUAL: readEnv('OTP_MANUAL'),     // если задан — SECRET не обязателен
  OTP_SECRET: readEnv('OTP_SECRET'),
  OTP_FIELD: readEnv('OTP_FIELD', 'totp'),       // totp | otp
  OTP_MODE: readEnv('OTP_MODE', 'body'),         // body | header
  OTP_HEADER_NAME: readEnv('OTP_HEADER_NAME', 'X-OTP'),

  // --- Subproject ---
  SUBPROJECT_NAME: readEnv('SUBPROJECT_NAME'),
  SUBPROJECT_ID: readEnv('SUBPROJECT_ID'),
  SUBPROJECT_HEADER: readEnv('SUBPROJECT_HEADER', 'x-subproject-id'),

  // --- Инвойсы ---
  ASSET_UUID: readEnv('ASSET_UUID'),
  CLIENT_UUID: readEnv('CLIENT_UUID'),
  EXPECTED_FIAT_AMOUNT: readEnv('EXPECTED_FIAT_AMOUNT', '99'),
  FIAT_CODE: readEnv('FIAT_CODE', 'USD'),
  // Если EXPIRES_AT не задан в ENV — берём «сейчас + EXPIRES_IN_DAYS» (по умолчанию 30 дней)
  EXPIRES_AT: readEnv('EXPIRES_AT') || isoInDays(toNum(readEnv('EXPIRES_IN_DAYS', 30), 30)),
  INVOICE_NAME: readEnv('INVOICE_NAME', 'GR8Tech'),
  INVOICE_NOTE: readEnv('INVOICE_NOTE', ''),

  // --- Ретраи/тюнинг/отладка ---
  HTTP_RETRIES: toNum(readEnv('HTTP_RETRIES', 2)),
  INVOICE_RETRIES: toNum(readEnv('INVOICE_RETRIES', 1)),
  LIST_RETRIES: toNum(readEnv('LIST_RETRIES', 1)),
  DEBUG_AUTH_HEADERS: toBool(readEnv('DEBUG_AUTH_HEADERS', false)),
};

function validate() {
  const missing = [];

  // База для любых запросов
  if (!cfg.BASE_URL) missing.push('API.BASE_URL');

  // Для бизнес-логики инвойсов — эти два обязательны всегда
  if (!cfg.ASSET_UUID) missing.push('Invoice.ASSET_UUID');
  if (!cfg.CLIENT_UUID) missing.push('Invoice.CLIENT_UUID');

  // Если НЕТ заранее выданного токена — тогда нужен логин
  const needLogin = !cfg.ACCESS_TOKEN_MANUAL;
  if (needLogin) {
    if (!cfg.KEYCLOAK_TOKEN_URL) missing.push('Keycloak.KEYCLOAK_TOKEN_URL');
    if (!cfg.CLIENT_ID) missing.push('Keycloak.CLIENT_ID');
    if (!cfg.USERNAME) missing.push('Keycloak.USERNAME');
    if (!cfg.PASSWORD) missing.push('Keycloak.PASSWORD');

    // OTP обязателен только если ты не задаёшь OTP_MANUAL
    if (!cfg.OTP_MANUAL && !cfg.OTP_SECRET) {
      // укажем мягко, как опционально-обязательное поле
      missing.push('Keycloak.OTP_SECRET (или задайте OTP_MANUAL)');
    }
  }

  if (missing.length) {
    fail(`Configuration errors:\n- ${missing.join('\n- ')}`);
  }
}

validate();

export const config = {
  get: (k, def = '') => (cfg[k] !== undefined ? cfg[k] : def),
  getNumber: (k, def = 0) => toNum(cfg[k], def),
  getBoolean: (k, def = false) => toBool(cfg[k], def),
};
