#!/usr/bin/env bash
# k6/run.local.sh — запуск k6 с prelogin (OTP из Node) и автоподъёмом локального OTP-сервера
set -Eeuo pipefail

# ---------- utils ----------
mask() {
  local s="${1:-}"; local n=${#s}
  if (( n == 0 )); then echo ""; return; fi
  if (( n <= 12 )); then echo "****"; else echo "${s:0:6}***${s: -6}"; fi
}
abs_path() {
  local p="$1"
  if [[ "$p" = /* ]]; then echo "$p"; else echo "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"; fi
}

# ---------- dirs ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------- env (.env.local / .env) ----------
ENV_FILE=""
if [[ -f "${SCRIPT_DIR}/.env.local" ]]; then
  ENV_FILE="${SCRIPT_DIR}/.env.local"
elif [[ -f "${SCRIPT_DIR}/.env" ]]; then
  ENV_FILE="${SCRIPT_DIR}/.env"
fi
if [[ -n "${ENV_FILE}" ]]; then
  echo "Using env file: $(basename "$ENV_FILE")"
  set +u; set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a; set -u
else
  echo "No .env.local or .env found — relying on shell ENV."
fi

# ---------- defaults ----------
: "${K6_SCRIPT:=main.invoices.arrival.js}"
: "${VUS:=1}"
: "${ITERATIONS:=1}"
: "${BASE_URL:=}"

# KC / OTP
: "${ACCESS_TOKEN_MANUAL:=}"
: "${KEYCLOAK_TOKEN_URL:=}"
: "${CLIENT_ID:=}"
: "${CLIENT_SECRET:=}"
: "${USERNAME:=}"
: "${PASSWORD:=}"
: "${SCOPE:=openid email profile roles organization:*}"

: "${OTP_SECRET:=}"
: "${OTP_MANUAL:=}"
: "${OTP_FIELD:=totp}"               # totp | otp (имя поля у KC)
: "${OTP_MODE:=body}"                # для prelogin — body
: "${OTP_HEADER_NAME:=X-OTP}"

# пути к Node-утилитам
: "${NODE_TOTP_JS:=${ROOT_DIR}/tools/totp-node/totp.js}"
: "${NODE_OTP_SERVER_JS:=${ROOT_DIR}/tools/totp-node/server.js}"
: "${OTP_SERVER_PORT:=8787}"
: "${OTP_PROVIDER_URL:=http://127.0.0.1:${OTP_SERVER_PORT}/otp}"

# бизнес-переменные
: "${ASSET_UUID:=}"
: "${CLIENT_UUID:=}"
: "${SUBPROJECT_NAME:=}"
: "${SUBPROJECT_ID:=}"
: "${SUBPROJECT_HEADER:=x-subproject-id}"

# ---------- resolve k6 script ----------
if [[ ! -f "$K6_SCRIPT" ]]; then
  if [[ -f "${SCRIPT_DIR}/${K6_SCRIPT#./}" ]]; then
    K6_SCRIPT="${SCRIPT_DIR}/${K6_SCRIPT#./}"
  fi
fi
K6_SCRIPT="$(abs_path "$K6_SCRIPT")"
if [[ ! -f "$K6_SCRIPT" ]]; then
  echo "ERROR: k6 script not found: $K6_SCRIPT"
  exit 3
fi
echo "Resolved k6 script: ${K6_SCRIPT}"

# ---------- log env snapshot ----------
echo "ENV seen by launcher:"
echo "  BASE_URL=${BASE_URL:-}"
echo "  ASSET_UUID=${ASSET_UUID:-}"
echo "  CLIENT_UUID=${CLIENT_UUID:-}"
echo "  ACCESS_TOKEN_MANUAL=${ACCESS_TOKEN_MANUAL:+(set)}"
echo "  KEYCLOAK_TOKEN_URL=${KEYCLOAK_TOKEN_URL:-}"
echo "  USERNAME=${USERNAME:-}"
echo "  SCOPE=${SCOPE:-}"
echo "  SUBPROJECT_ID=${SUBPROJECT_ID:-}"
echo "  SUBPROJECT_HEADER=${SUBPROJECT_HEADER:-}"
echo "  OTP_PROVIDER_URL=${OTP_PROVIDER_URL:-}"

echo "Running k6 with VUS=${VUS} ITERATIONS=${ITERATIONS} BASE_URL=${BASE_URL}"

# ---------- Prelogin (если нет ACCESS_TOKEN_MANUAL) ----------
if [[ -z "${ACCESS_TOKEN_MANUAL}" ]]; then
  # генерим OTP только из Node totp.js
  OTP_CODE=""
  if [[ -n "${OTP_SECRET}" && -z "${OTP_MANUAL}" && -f "${NODE_TOTP_JS}" && "$(command -v node || true)" ]]; then
    OTP_CODE="$(node "${NODE_TOTP_JS}" --secret "${OTP_SECRET}" --raw 2>/dev/null || true)"
  fi
  if [[ -z "${OTP_CODE}" && -n "${OTP_MANUAL}" ]]; then
    OTP_CODE="${OTP_MANUAL}"
  fi
  if [[ -n "${OTP_CODE}" ]]; then
    echo "Prelogin OTP (current 30s window): ${OTP_CODE}"
  fi

  if [[ -n "${KEYCLOAK_TOKEN_URL}" && -n "${CLIENT_ID}" && -n "${USERNAME}" && -n "${PASSWORD}" ]]; then
    echo "Prelogin: ${USERNAME} (scope='${SCOPE}')"
    declare -a CURL_ARGS=(
      -sS -X POST "${KEYCLOAK_TOKEN_URL}"
      -H 'Content-Type: application/x-www-form-urlencoded'
      --data-urlencode "grant_type=password"
      --data-urlencode "client_id=${CLIENT_ID}"
      --data-urlencode "username=${USERNAME}"
      --data-urlencode "password=${PASSWORD}"
      --data-urlencode "scope=${SCOPE}"
    )
    [[ -n "${CLIENT_SECRET}" ]] && CURL_ARGS+=( --data-urlencode "client_secret=${CLIENT_SECRET}" )
    [[ -n "${OTP_CODE}" ]]      && CURL_ARGS+=( --data-urlencode "${OTP_FIELD}=${OTP_CODE}" )

    KC_RES="$(curl "${CURL_ARGS[@]}" || true)"

    ACCESS_TOKEN=""
    if command -v jq >/dev/null 2>&1; then
      ACCESS_TOKEN="$(printf '%s' "${KC_RES}" | jq -r 'try .access_token // empty')"
    fi
    if [[ -z "${ACCESS_TOKEN}" ]]; then
      ACCESS_TOKEN="$(printf '%s' "${KC_RES}" | tr -d '\n' | awk -F'"access_token":"' '{if (NF>1) print $2}' | awk -F'"' '{print $1}')"
    fi
    if [[ -z "${ACCESS_TOKEN}" ]]; then
      echo "Prelogin FAILED. Response:"
      printf '%s\n' "${KC_RES}"
      exit 2
    fi
    export ACCESS_TOKEN_MANUAL="${ACCESS_TOKEN}"
    echo "Prelogin OK: ACCESS_TOKEN_MANUAL=$(mask "${ACCESS_TOKEN_MANUAL}")"
  fi
fi

# ---------- start local OTP server (Node) ----------
OTP_SERVER_PID=""
OTP_SERVER_LOG="${TMPDIR:-/tmp}/otp-server.$$.log"

start_otp_server() {
  if ! command -v node >/dev/null 2>&1; then
    echo "WARN: node is not installed; OTP_PROVIDER_URL will be ignored"
    return
  fi
  if [[ ! -f "${NODE_OTP_SERVER_JS}" ]]; then
    echo "WARN: OTP server not found at ${NODE_OTP_SERVER_JS}; skipping"
    return
  fi
  echo "Starting local OTP server on ${OTP_PROVIDER_URL}"
  ( OTP_SECRET="${OTP_SECRET}" OTP_SERVER_PORT="${OTP_SERVER_PORT}" \
    node "${NODE_OTP_SERVER_JS}" >"${OTP_SERVER_LOG}" 2>&1 ) &
  OTP_SERVER_PID=$!

  for i in {1..40}; do
    if curl -fsS "${OTP_PROVIDER_URL}" >/dev/null 2>&1; then
      echo "OTP server is up (pid=${OTP_SERVER_PID})"
      return
    fi
    if ! kill -0 "${OTP_SERVER_PID}" >/dev/null 2>&1; then
      echo "ERROR: OTP server crashed during startup. Last log lines:"
      tail -n 50 "${OTP_SERVER_LOG}" || true
      exit 4
    fi
    sleep 0.15
  done
  echo "WARN: OTP server did not respond in time; showing logs:"
  tail -n 50 "${OTP_SERVER_LOG}" || true
}

stop_otp_server() {
  if [[ -n "${OTP_SERVER_PID}" ]]; then
    kill "${OTP_SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

trap 'stop_otp_server' EXIT
start_otp_server

# ---------- export to k6 ----------
export VUS ITERATIONS BASE_URL
export ACCESS_TOKEN_MANUAL
export KEYCLOAK_TOKEN_URL CLIENT_ID CLIENT_SECRET USERNAME PASSWORD SCOPE
export OTP_SECRET OTP_MANUAL OTP_FIELD OTP_MODE OTP_HEADER_NAME
export OTP_PROVIDER_URL NODE_TOTP_JS
export ASSET_UUID CLIENT_UUID
export SUBPROJECT_NAME SUBPROJECT_ID SUBPROJECT_HEADER

# ---------- run k6 ----------
k6 run "${K6_SCRIPT}"
