// k6/main.withdrawals.arrival.smoke.js — arrival-rate SMOKE для withdraw
import { sleep } from 'k6';
import { createWithdrawalTwoStep } from './flows/withdrawals.js';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-arrival-rate',
      // 20 в час ~ 1 каждые 3 минуты → округлим на минуту:
      rate: 1,           // 1 withdrawal / minute
      timeUnit: '1m',
      duration: '2m',    // быстрая проверка
      preAllocatedVUs: 4,
      maxVUs: 8,
      tags: { phase: 'smoke_withdrawals' },
    },
  },
  thresholds: {
    'http_req_failed{slo:true}': ['rate<0.1'],
    http_req_duration: ['p(95)<5000'],
  },
};

export default function () {
  createWithdrawalTwoStep();
  sleep(0);
}
