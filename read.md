# Инвойсы (smoke + фазы)
K6_SCRIPT=main.invoices.arrival.smoke.js bash ./run.local.sh

# Инвойсы (простой arrival)
K6_SCRIPT=main.invoices.arrival.js bash ./run.local.sh

# Виздровалы (smoke двухшаговый)
K6_SCRIPT=main.withdrawals.arrival.smoke.js bash ./run.local.sh

# Линейная проверка
K6_SCRIPT=main.chained.js bash ./run.local.sh




tests:

#  rntime OTP
K6_SCRIPT=./totp.test.js bash ./run.local.sh



Поднимаем стек:
cd monitoring
docker compose up -d

Cлать метрики из k6:
запускай сценарии с переменной:
K6_OUT=influxdb=http://localhost:8086/k6 bash ./run.local.sh

Подключаем Grafana к InfluxDB:

Открыть http://localhost:3000
 (логин/пароль: admin/admin).

“Data sources” - “Add data source” - InfluxDB.

Query Language: InfluxQL.
URL: http://influxdb:8086 (имя сервиса из compose).
Database: k6.
User/Password пусто. → Save & test.

Готовый дашборд k6:
Grafana - Dashboards - Import - в поле Import via grafana.com введи 2587 - Load - выбери свой Datasource - Import.
Это даст базовые графики (RPS, latency, ошибки и т.д.).

3) Свои панели: инвойсы/сек и ошибки

Успешные инвойсы/сек (использует ваш invoices_ok):
InfluxQL-запрос для панели “Time series”:

SELECT non_negative_derivative(sum("value"), 1s)
FROM "invoices_ok"
WHERE $timeFilter
GROUP BY time($__interval) fill(null)


Подпись оси: ops/s (или “inv/s”).

Ошибки/сек:

SELECT non_negative_derivative(sum("value"), 1s)
FROM "invoices_err"
WHERE $timeFilter
GROUP BY time($__interval) fill(null)


Error rate (%) — через две серии и арифметику в Grafana:

Query A: non_negative_derivative(sum("value"), 1s) из invoices_err

Query B: non_negative_derivative(sum("value"), 1s) из invoices_ok

Transform - Add field from calculation - Binary operation A / (A + B) * 100

Отформатируй как Percent (0–100).

p95 latency по SLO-тегу (только бизнес-критичные запросы):

SELECT percentile("value", 95)
FROM "http_req_duration"
WHERE $timeFilter AND "slo"='true'
GROUP BY time($__interval) fill(null)


Общий TPS можно строить и по стандартной метрике:

SELECT non_negative_derivative(sum("value"), 1s)
FROM "http_reqs"
WHERE $timeFilter
GROUP BY time($__interval) fill(null)

4) Бонус: быстрая проверка, что метрики приходят

После запуска сценария с K6_OUT=..., зайди в InfluxDB:

curl "http://localhost:8086/query" --data-urlencode "db=k6" --data-urlencode "q=SHOW MEASUREMENTS"

