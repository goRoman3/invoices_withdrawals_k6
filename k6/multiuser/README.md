# multiuser — мульти-юзер стресс-тесты

Перенесено из отдельного проекта `k6-tests`. Отличие от стандартного флоу (`../flows`, `../main.*`):
каждый VU логинится под **своим** аккаунтом из пула и генерит собственный OTP — так не упираемся
в лимиты/OTP одного пользователя при большом числе VU.

## Флоу
- `payout.test.js` — массовый payout из CSV (`data/payout.csv`): `/payout/calculate` → `/payout/create` (multipart).
- `withdrawal.test.js` — двухшаговый withdrawal: `/withdrawal/calculate` → `/withdrawal`.

## Настройка
1. Пул юзеров (реальные креды, в `.gitignore`):
   ```bash
   cp lib/users.example.js lib/users.local.js   # и подставь username/password/otpSecret
   ```
2. Общие переменные берутся из `../.env.local` (см. `../.env.example`):
   `BASE_URL`, `KEYCLOAK_TOKEN_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `SUBPROJECT_ID`,
   `ASSET_UUID`, `WD_RECIPIENT`, `WD_AMOUNT`, `WD_AML`, `PAYOUT_AML`, `MU_VUS`, `MU_DURATION`.

## Запуск
Из папки `k6/` (скрипт сам подхватит `.env.local`):
```bash
K6_SCRIPT=multiuser/payout.test.js     bash ./run.local.sh
K6_SCRIPT=multiuser/withdrawal.test.js bash ./run.local.sh
```
`MU_VUS` пусто → число VU = размеру пула юзеров. Метрики можно слать в InfluxDB через `K6_OUT` (см. `../monitoring`).
