// k6/main.chained.js — scenarios + SLO thresholds
import { check, sleep } from 'k6';
import { createInvoiceAndAddress } from './flows/invoices.js';
import { config } from './lib/config.js';

const vus = config.getNumber('VUS', 1);
const iterations = config.getNumber('ITERATIONS', 0); // 0 => use stages

const baseThresholds = {
  http_req_duration: ['p(95)<5000'],
  'http_req_failed{slo:true}': ['rate<0.1'],
  checks: ['rate>0.9'],
};

export const options = (iterations > 0)
  ? {
      scenarios: {
        shared_iters: {
          executor: 'shared-iterations',
          iterations: iterations,
          vus: vus,
          maxDuration: config.get('MAX_DURATION', '10m'),
        },
      },
      thresholds: baseThresholds,
    }
  : {
      vus: vus,
      stages: [
        { duration: '30s', target: vus },
        { duration: '1m', target: vus },
        { duration: '30s', target: 0 },
      ],
      thresholds: baseThresholds,
    };

export function setup() {
  console.log('Test configuration:');
  console.log(`- VUs: ${vus}`);
  console.log(`- Iterations: ${iterations}`);
  console.log(`- Base URL: ${config.get('BASE_URL')}`);
  console.log('Setup completed successfully');
  return { startTime: new Date().toISOString() };
}

export default function (data) {
  console.log(`Starting iteration for VU ${__VU}, iteration ${__ITER}`);

  const result = createInvoiceAndAddress();

  const checks = check(result, {
    'invoice created successfully': (r) => r.uuid && r.uuid.length > 0,
    'deposit address received':     (r) => r.address && r.address.length > 0,
    'invoice UUID is valid format': (r) => /^[0-9a-f-]{36}$/.test(r.uuid),
    'response time reasonable':     (r) => r.duration < 10000,
  });

  if (checks) console.log(`✓ VU${__VU} Created invoice ${result.uuid} → ${result.address}`);
  else        console.error(`✗ VU${__VU} Failed to create invoice`);

  sleep(config.getNumber('ITERATION_DELAY', 1));
}

export function teardown(data) {
  console.log(`Test completed. Started at: ${data.startTime}`);
}
