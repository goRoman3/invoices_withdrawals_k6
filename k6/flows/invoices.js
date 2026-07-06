// k6/flows/invoices.js — создание инвойса с авто-перелогином при 401/403
import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from '../lib/config.js';
import { getAuthHeaders, refreshAuth } from '../lib/auth.js';
import { Counter } from 'k6/metrics';

export const invoices_ok = new Counter('invoices_ok');
export const invoices_err = new Counter('invoices_err');

function baseHeaders() {
  const auth = getAuthHeaders();
  return {
    'Cache-Control': 'no-cache',
    Accept: '*/*',
    accept: 'application/json',
    'Content-Type': 'application/json',
    ...auth,
    'X-Request-ID': `k6-${__VU}-${__ITER}-${Date.now()}`,
  };
}

export function buildInvoicePayload(overrides = {}) {
  const basePayload = {
    expectedFiatAmount: String(config.getNumber('EXPECTED_FIAT_AMOUNT', 50)),
    expectedAmount: null,
    fiatCurrencyCode: config.get('FIAT_CODE', 'USD'),
    expiresAt: config.get('EXPIRES_AT', '2025-12-31T23:59:59.999Z'),
    assetUuid: config.get('ASSET_UUID'),
    clientUuid: config.get('CLIENT_UUID'),
    note: config.get('INVOICE_NOTE', ''),
    name: config.get('INVOICE_NAME', 'GR8Tech'),
  };
  return { ...basePayload, ...overrides };
}

function postInvoiceOnce(url, payload, headers) {
  return http.post(url, JSON.stringify(payload), { headers, tags: { slo: true, op: 'create_invoice' } });
}

export function createInvoiceAndAddress() {
  const url = `${config.get('BASE_URL')}/invoices`;
  const payload = buildInvoicePayload();

  // первая попытка
  let headers = baseHeaders();
  let res = postInvoiceOnce(url, payload, headers);

  // если авторизация упала — перелогин и retry
  if (res.status === 401 || res.status === 403) {
    refreshAuth();
    sleep(0.2);
    headers = baseHeaders();
    res = postInvoiceOnce(url, payload, headers);
  }

  const ok = check(res, {
    'invoice creation status 2xx': (r) => r.status >= 200 && r.status < 300,
    'response has valid JSON': (r) => { try { JSON.parse(r.body); return true; } catch { return false; } },
  });

  if (!ok) {
    const dbg = { ...headers }; if (dbg.Authorization) dbg.Authorization = '***masked***';
    invoices_err.add(1);
    throw new Error(`Create invoice failed: ${res.status} - ${String(res.body).slice(0,300)}\nHeaders used: ${JSON.stringify(dbg)}`);
  }

  const data = res.json().data || res.json();
  const uuid = data?.uuid || data?.id;
  const address = data?.account?.address || data?.address;
  if (!uuid || !address) {
    invoices_err.add(1);
    throw new Error(`Invoice created but missing uuid or address. Status: ${res.status}`);
  }

  invoices_ok.add(1);
  return { uuid, address, payload, status: res.status, ts: new Date().toISOString() };
}
