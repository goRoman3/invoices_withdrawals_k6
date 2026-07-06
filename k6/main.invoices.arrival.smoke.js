// k6/main.invoices.arrival.smoke.js — smoke → ramp → hold → spike → soak (инвойсы/мин)
import { sleep } from 'k6';
import { createInvoiceAndAddress } from './flows/invoices.js';
import { config } from './lib/config.js';

// === helpers: per-hour -> per-minute (INT) ===
function perHourToPerMinInt(v) {
  const perMin = Number(v) / 60;
  return Math.max(1, Math.round(perMin)); // arrival-rate требует целые при '1m'
}

// === читаем настройки из ENV (в час) ===
const SMOKE_H    = config.getNumber('SMOKE_PER_H',       1200); // мгновенная проверка
const SMOKE_MIN  = config.getNumber('SMOKE_MIN',         1);    // 1–2 минуты хватает

const RAMP_START_H = config.getNumber('RAMP_START_PER_H', 600);
const RAMP_END_H   = config.getNumber('RAMP_END_PER_H',   1200);
const RAMP_MIN     = config.getNumber('RAMP_MIN',         15);

const HOLD_MIN     = config.getNumber('HOLD_MIN',         20);

const SPIKE_X      = config.getNumber('SPIKE_MULT',       3);
const SPIKE_MIN    = config.getNumber('SPIKE_MIN',        10);

const SOAK_H       = config.getNumber('SOAK_PER_H',       900);
const SOAK_MIN     = config.getNumber('SOAK_MIN',         30);

// === расчёт целочисленных rate/target в минуту ===
const SMOKE_M      = perHourToPerMinInt(SMOKE_H);
const RAMP_START_M = perHourToPerMinInt(RAMP_START_H);
const RAMP_END_M   = perHourToPerMinInt(RAMP_END_H);
const SPIKE_M      = perHourToPerMinInt(RAMP_END_H * SPIKE_X);
const SOAK_M       = perHourToPerMinInt(SOAK_H);

// верхняя оценка RPS для подбора VU (с запасом)
const maxPerSec = Math.max(RAMP_END_H * SPIKE_X, SOAK_H, SMOKE_H) / 3600;
const MAX_VUS   = Math.ceil(maxPerSec * 2) + 10;

// тайминги фаз
const smokeStart   = '0s';
const smokeDuration= `${SMOKE_MIN}m`;

const rampStart    = `${SMOKE_MIN}m`;
const rampDuration = `${RAMP_MIN}m`;

const holdStart    = `${SMOKE_MIN + RAMP_MIN}m`;
const holdDuration = `${HOLD_MIN}m`;

const spikeStart   = `${SMOKE_MIN + RAMP_MIN + HOLD_MIN}m`;
const spikeDuration= `${SPIKE_MIN}m`;

const soakStart    = `${SMOKE_MIN + RAMP_MIN + HOLD_MIN + SPIKE_MIN}m`;
const soakDuration = `${SOAK_MIN}m`;

export const options = {
  scenarios: {
    // 0) SMOKE: быстрая проверка, чтобы увидеть работу сразу
    smoke: {
      executor: 'constant-arrival-rate',
      startTime: smokeStart,
      rate: SMOKE_M,            // инвойсов в МИНУТУ (целое)
      timeUnit: '1m',
      duration: smokeDuration,
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      tags: { phase: 'smoke' },
    },

    // 1) Stress-ramp: от RAMP_START_M до RAMP_END_M
    ramp: {
      executor: 'ramping-arrival-rate',
      startTime: rampStart,
      startRate: RAMP_START_M,
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: RAMP_END_M, duration: rampDuration }, // INT target
      ],
      tags: { phase: 'ramp' },
    },

    // 2) Hold: держим целевой темп
    hold: {
      executor: 'constant-arrival-rate',
      startTime: holdStart,
      rate: RAMP_END_M,         // INT rate
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      duration: holdDuration,
      tags: { phase: 'hold' },
    },

    // 3) Spike: кратковременный всплеск X3
    spike: {
      executor: 'constant-arrival-rate',
      startTime: spikeStart,
      rate: SPIKE_M,            // INT rate
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      duration: spikeDuration,
      tags: { phase: 'spike' },
    },

    // 4) Mini-soak: короткая «пропитка»
    soak: {
      executor: 'constant-arrival-rate',
      startTime: soakStart,
      rate: SOAK_M,             // INT rate
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      duration: soakDuration,
      tags: { phase: 'soak' },
    },
  },
  thresholds: {
    'http_req_failed{slo:true}': ['rate<0.1'],
    http_req_duration: ['p(95)<5000'],
    checks: ['rate>0.9'],
  },
};

export default function () {
  createInvoiceAndAddress();
  sleep(0); // темп задаётся arrival-экзекьюторами
}
