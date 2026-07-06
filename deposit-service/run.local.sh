#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -f .env.local ]; then
export $(grep -v '^#' .env.local | xargs)
fi
: "${TRON_PRIVATE_KEY:?TRON_PRIVATE_KEY is required}"
: "${TRON_PRO_API_KEY:?TRON_PRO_API_KEY is required}"
: "${TOKEN_CONTRACT:?TOKEN_CONTRACT is required}"

# --- OTP microservice (Node) ---
: "${OTP_SERVER_PORT:=8787}"
: "${OTP_PROVIDER_URL:=http://127.0.0.1:${OTP_SERVER_PORT}/otp}"

OTP_SERVER_PID=""
if command -v node >/dev/null 2>&1; then
  if [[ -f "${SCRIPT_DIR}/tools/totp-node/server.js" ]]; then
    echo "Starting local OTP server on ${OTP_PROVIDER_URL}"
    # пробрасываем OTP_SECRET в окружение сервера
    ( OTP_SECRET="${OTP_SECRET}" OTP_SERVER_PORT="${OTP_SERVER_PORT}" \
      node "${SCRIPT_DIR}/tools/totp-node/server.js" \
      >/dev/null 2>&1 ) &
    OTP_SERVER_PID=$!
    # подождём готовности (микро-таймаут)
    sleep 0.2
  else
    echo "WARN: tools/totp-node/server.js not found; OTP_PROVIDER_URL will be ignored"
  fi
else
  echo "WARN: node is not installed; OTP_PROVIDER_URL will be ignored"
fi

# ensure cleanup
cleanup() {
  if [[ -n "${OTP_SERVER_PID}" ]]; then
    kill "${OTP_SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# пробросим URL провайдера в k6
export OTP_PROVIDER_URL

exec node server.js