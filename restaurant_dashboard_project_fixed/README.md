# Telegram Mini App — Restaurant Weekly Dashboard

Готовая база для сайта с Telegram Mini App, который читает данные из Google Sheets.

## Что умеет
- режим **Неделя**
- режим **Месяц**
- тренд **рост / падение** относительно прошлой недели
- monthly chart по неделям
- красивый luxury dashboard
- API для Telegram Mini App

## Структура Google Sheets

### Лист: `weekly_data`
Строка 1 — заголовки.

| week | waiter | amount | avg_guest_check | avg_table_check | desserts | marginal_dishes | kpi |
|---|---|---:|---:|---:|---:|---:|---:|
| 2026-W14 | Ниетбаев Арслан | 702000000 | 458000 | 888000 | 380 | 2280 | 91 |
| 2026-W14 | Нодир | 689000000 | 440000 | 860000 | 410 | 2400 | 96 |
| 2026-W15 | Ниетбаев Арслан | 720000000 | 462000 | 901000 | 395 | 2310 | 93 |

### Лист: `settings`
Можно использовать для планов.

| key | value |
|---|---:|
| target_avg_guest_check | 390000 |
| target_avg_table_check | 730000 |
| target_kpi | 100 |

## Запуск

```bash
npm install
cp .env.example .env
npm start
```

## Что заполнить в `.env`
- `SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `WEEKLY_SHEET_NAME`
- `SETTINGS_SHEET_NAME`

## Telegram Mini App
После деплоя открой BotFather и задай домен для Mini App.

Кнопка у бота должна открывать:

```js
{
  text: "Открыть дашборд",
  web_app: { url: "https://your-domain.com" }
}
```

## Дальше
Следующий шаг — подставить твои реальные имена официантов и оформить таблицу в Google Sheets.
