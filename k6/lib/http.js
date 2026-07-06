// k6/lib/http.js — HTTP helpers; slo:true по умолчанию для бизнес-запросов
import http from 'k6/http';
import { sleep } from 'k6';
import { config } from './config.js';

function shouldRetry(status) {
  return status >= 500 || status === 408 || status === 429;
}
function exponentialBackoff(attempt, baseMs) {
  return Math.min(baseMs * Math.pow(2, attempt), 30000);
}

export function httpRequest(method, url, body = null, params = {}, options = {}) {
  const retries = options.retries !== undefined ? options.retries : config.getNumber('HTTP_RETRIES', 2);
  const baseBackoff = options.backoffMs !== undefined ? options.backoffMs : 250;

  let lastResponse, lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = exponentialBackoff(attempt - 1, baseBackoff);
        console.log(`Retry ${attempt}/${retries} after ${backoffMs}ms delay`);
        sleep(backoffMs / 1000);
      }
      const requestParams = {
        ...params,
        tags: { slo: 'true', ...(params.tags || {}), attempt: String(attempt) },
      };

      switch (method.toUpperCase()) {
        case 'GET':    lastResponse = http.get(url, requestParams); break;
        case 'POST':   lastResponse = http.post(url, body, requestParams); break;
        case 'PUT':    lastResponse = http.put(url, body, requestParams); break;
        case 'DELETE': lastResponse = http.del(url, body, requestParams); break;
        default: throw new Error(`Unsupported HTTP method: ${method}`);
      }

      if (!shouldRetry(lastResponse.status)) return lastResponse;
      console.warn(`HTTP ${method} ${url} failed with ${lastResponse.status}, attempt ${attempt + 1}/${retries + 1}`);
    } catch (err) {
      lastError = err;
      console.warn(`HTTP ${method} ${url} error: ${err.message}, attempt ${attempt + 1}/${retries + 1}`);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error(`All ${retries + 1} attempts failed for ${method} ${url}`);
}

export const httpGet = (url, params = {}, options = {}) => httpRequest('GET', url, null, params, options);
export const httpPost = (url, body, params = {}, options = {}) => httpRequest('POST', url, body, params, options);
export const httpPut = (url, body, params = {}, options = {}) => httpRequest('PUT', url, body, params, options);
export const httpDelete = (url, body = null, params = {}, options = {}) => httpRequest('DELETE', url, body, params, options);
