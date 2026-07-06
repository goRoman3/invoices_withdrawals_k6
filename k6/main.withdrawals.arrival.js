// k6/main.withdrawals.arrival.js — темповая нагрузка для withdrawals
// Фазы: Stress-ramp → Hold → Spike(×3) → Mini-soak
// Цель по умолчанию: ~500/ч в пике (настраивается через ENV)
import { sleep } from 'k6';
import { config } from './lib/config.js';
import { createWithdrawalTwoStep } from './flows/withdrawals.js';

// ── helpers: per-hour → per-minute (целые для arrival-rate) ────────────────────
function perHourToPerMinInt(v) {
  const perMin = Number(v) / 60;
  return Math.max(1, Math.round(perMin)); // arrival-rate требует целые
}

// ── читаем настройки (перекрывай в .env.local при необходимости) ──────────────
// целевая нагрузка для withdrawals ~500/ч
const RAMP_START_H = config.getNumber('RAMP_START_PER_H', 350);  // старт высокий
const RAMP_END_H   = config.getNumber('RAMP_END_PER_H',   500);  // целевая 500/ч
const RAMP_MIN     = config.getNumber('RAMP_MIN',         15);   // 10–15м

const HOLD_MIN     = config.getNumber('HOLD_MIN',         20);   // 15–20м

const SPIKE_X      = config.getNumber('SPIKE_MULT',       3);    // Spike ×3
const SPIKE_MIN    = config.getNumber('SPIKE_MIN',        10);   // 10м

// mini-soak около 90% от пика, длительностью 30–60м
const SOAK_H       = config.getNumber('SOAK_PER_H',       Math.round(RAMP_END_H * 0.9));
const SOAK_MIN     = config.getNumber('SOAK_MIN',         30);

// ── расчёты минутных целевых/лимитов ───────────────────────────────────────────
const RAMP_START_M = perHourToPerMinInt(RAMP_START_H);
const RAMP_END_M   = perHourToPerMinInt(RAMP_END_H);
const SPIKE_M      = perHourToPerMinInt(RAMP_END_H * SPIKE_X);
const SOAK_M       = perHourToPerMinInt(SOAK_H);

// запас по VU (грубая оценка нужной параллельности)
const maxPerSec = Math.max(RAMP_END_H * SPIKE_X, SOAK_H) / 3600;
const MAX_VUS   = Math.ceil(maxPerSec * 2) + 10;

// ── тайминги фаз ────────────────────────────────────────────────────────────────
const rampDuration = `${RAMP_MIN}m`;
const holdStart    = `${RAMP_MIN}m`;
const holdDuration = `${HOLD_MIN}m`;
const spikeStart   = `${RAMP_MIN + HOLD_MIN}m`;
const spikeDuration= `${SPIKE_MIN}m`;
const soakStart    = `${RAMP_MIN + HOLD_MIN + SPIKE_MIN}m`;
const soakDuration = `${SOAK_MIN}m`;

// ── сценарии ───────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: RAMP_START_M,
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      stages: [{ target: RAMP_END_M, duration: rampDuration }],
      tags: { lane: 'withdrawals', phase: 'ramp' },
    },
    hold: {
      executor: 'constant-arrival-rate',
      startTime: holdStart,
      rate: RAMP_END_M,
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      duration: holdDuration,
      tags: { lane: 'withdrawals', phase: 'hold' },
    },
    spike: {
      executor: 'constant-arrival-rate',
      startTime: spikeStart,
      rate: SPIKE_M,
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      duration: spikeDuration,
      tags: { lane: 'withdrawals', phase: 'spike' },
    },
    soak: {
      executor: 'constant-arrival-rate',
      startTime: soakStart,
      rate: SOAK_M,
      timeUnit: '1m',
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      duration: soakDuration,
      tags: { lane: 'withdrawals', phase: 'soak' },
    },
  },
  thresholds: {
    'http_req_failed{slo:true}': ['rate<0.1'],
    http_req_duration: ['p(95)<5000'],
    // можно добавить бизнес-порог: ≥90% успешных withdraw за окно
    // 'checks{op:withdraw_send}': ['rate>0.9'],
  },
};

// ── бизнес-итерация: двухшаговый withdraw ──────────────────────────────────────
export default function () {
  createWithdrawalTwoStep();
  sleep(0); // темп задаёт arrival-rate
}
