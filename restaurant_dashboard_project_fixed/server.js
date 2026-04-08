import express from 'express';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const WEEKLY_SHEET_NAME = process.env.WEEKLY_SHEET_NAME || 'weekly_data';
const SETTINGS_SHEET_NAME = process.env.SETTINGS_SHEET_NAME || 'settings';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function percentChange(current, previous) {
  if (!previous) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function getMonthKeyFromWeek(week) {
  const match = String(week).match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return 'Unknown';
  const [, year, weekNumStr] = match;
  const weekNum = Number(weekNumStr);
  const jan4 = new Date(Date.UTC(Number(year), 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (weekNum - 1) * 7);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getSheetsClient() {
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID is not configured');
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  return google.sheets({ version: 'v4', auth });
}

async function loadRawData() {
  const sheets = await getSheetsClient();

  const [weeklyRes, settingsRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WEEKLY_SHEET_NAME}!A1:H500`
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SETTINGS_SHEET_NAME}!A1:B50`
    }).catch(() => ({ data: { values: [] } }))
  ]);

  const rows = weeklyRes.data.values || [];
  if (rows.length < 2) {
    return { entries: [], settings: {} };
  }

  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const dataRows = rows.slice(1).filter((row) => row[0] && row[1]);

  const entries = dataRows.map((row) => {
    const get = (name) => row[headers.indexOf(name)] ?? '';
    return {
      week: String(get('week')).trim(),
      waiter: String(get('waiter')).trim(),
      amount: parseNumber(get('amount')),
      avgGuestCheck: parseNumber(get('avg_guest_check')),
      avgTableCheck: parseNumber(get('avg_table_check')),
      desserts: parseNumber(get('desserts')),
      marginalDishes: parseNumber(get('marginal_dishes')),
      kpi: parseNumber(get('kpi'))
    };
  });

  const settingsRows = settingsRes.data.values || [];
  const settings = Object.fromEntries(
    settingsRows
      .filter((row) => row[0])
      .map((row) => [String(row[0]).trim(), parseNumber(row[1]) || row[1]])
  );

  return { entries, settings };
}

function buildWeeklyResponse(entries, settings, requestedWeek) {
  const weeks = [...new Set(entries.map((e) => e.week))].sort();
  const currentWeek = requestedWeek && weeks.includes(requestedWeek)
    ? requestedWeek
    : weeks[weeks.length - 1];

  const previousWeek = weeks[weeks.indexOf(currentWeek) - 1] || null;
  const currentEntries = entries.filter((e) => e.week === currentWeek);
  const previousEntries = entries.filter((e) => e.week === previousWeek);
  const previousMap = new Map(previousEntries.map((e) => [e.waiter, e]));

  const waiters = currentEntries
    .map((entry) => {
      const previous = previousMap.get(entry.waiter);
      return {
        name: entry.waiter,
        amount: entry.amount,
        avgGuestCheck: entry.avgGuestCheck,
        avgTableCheck: entry.avgTableCheck,
        desserts: entry.desserts,
        marginalDishes: entry.marginalDishes,
        kpi: entry.kpi,
        trendAmount: percentChange(entry.amount, previous?.amount || 0),
        trendDesserts: percentChange(entry.desserts, previous?.desserts || 0),
        trendAvgGuestCheck: percentChange(entry.avgGuestCheck, previous?.avgGuestCheck || 0),
        trendKpi: percentChange(entry.kpi, previous?.kpi || 0)
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const summary = {
    totalRevenue: waiters.reduce((sum, w) => sum + w.amount, 0),
    avgGuestCheck: waiters.length ? Math.round(waiters.reduce((sum, w) => sum + w.avgGuestCheck, 0) / waiters.length) : 0,
    avgTableCheck: waiters.length ? Math.round(waiters.reduce((sum, w) => sum + w.avgTableCheck, 0) / waiters.length) : 0,
    totalDesserts: waiters.reduce((sum, w) => sum + w.desserts, 0),
    avgKpi: waiters.length ? Number((waiters.reduce((sum, w) => sum + w.kpi, 0) / waiters.length).toFixed(1)) : 0
  };

  return {
    period: 'weekly',
    currentWeek,
    previousWeek,
    availableWeeks: weeks,
    settings,
    summary,
    waiters
  };
}

function buildMonthlyResponse(entries, requestedMonth) {
  const allWeeks = [...new Set(entries.map((e) => e.week))].sort();
  const monthMap = new Map();

  for (const week of allWeeks) {
    const monthKey = getMonthKeyFromWeek(week);
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
    monthMap.get(monthKey).push(week);
  }

  const availableMonths = [...monthMap.keys()].sort();
  const currentMonth = requestedMonth && monthMap.has(requestedMonth)
    ? requestedMonth
    : availableMonths[availableMonths.length - 1];

  const selectedWeeks = monthMap.get(currentMonth) || [];
  const monthEntries = entries.filter((e) => selectedWeeks.includes(e.week));
  const waiterMap = new Map();

  for (const entry of monthEntries) {
    if (!waiterMap.has(entry.waiter)) {
      waiterMap.set(entry.waiter, {
        name: entry.waiter,
        amount: 0,
        avgGuestCheckSum: 0,
        avgTableCheckSum: 0,
        desserts: 0,
        marginalDishes: 0,
        kpiSum: 0,
        weeksCount: 0,
        weeklySeries: []
      });
    }

    const item = waiterMap.get(entry.waiter);
    item.amount += entry.amount;
    item.avgGuestCheckSum += entry.avgGuestCheck;
    item.avgTableCheckSum += entry.avgTableCheck;
    item.desserts += entry.desserts;
    item.marginalDishes += entry.marginalDishes;
    item.kpiSum += entry.kpi;
    item.weeksCount += 1;
    item.weeklySeries.push({ week: entry.week, amount: entry.amount });
  }

  const waiters = [...waiterMap.values()]
    .map((item) => ({
      name: item.name,
      amount: item.amount,
      avgGuestCheck: item.weeksCount ? Math.round(item.avgGuestCheckSum / item.weeksCount) : 0,
      avgTableCheck: item.weeksCount ? Math.round(item.avgTableCheckSum / item.weeksCount) : 0,
      desserts: item.desserts,
      marginalDishes: item.marginalDishes,
      kpi: item.weeksCount ? Number((item.kpiSum / item.weeksCount).toFixed(1)) : 0,
      weeklySeries: selectedWeeks.map((week) => {
        const found = item.weeklySeries.find((s) => s.week === week);
        return found ? found.amount : 0;
      })
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    period: 'monthly',
    currentMonth,
    availableMonths,
    selectedWeeks,
    summary: {
      totalRevenue: waiters.reduce((sum, w) => sum + w.amount, 0),
      avgGuestCheck: waiters.length ? Math.round(waiters.reduce((sum, w) => sum + w.avgGuestCheck, 0) / waiters.length) : 0,
      avgTableCheck: waiters.length ? Math.round(waiters.reduce((sum, w) => sum + w.avgTableCheck, 0) / waiters.length) : 0,
      totalDesserts: waiters.reduce((sum, w) => sum + w.desserts, 0),
      avgKpi: waiters.length ? Number((waiters.reduce((sum, w) => sum + w.kpi, 0) / waiters.length).toFixed(1)) : 0
    },
    chart: {
      labels: selectedWeeks,
      series: Object.fromEntries(waiters.map((w) => [w.name, w.weeklySeries]))
    },
    waiters
  };
}

app.get('/api/dashboard', async (req, res) => {
  try {
    const { entries, settings } = await loadRawData();
    const period = String(req.query.period || 'weekly').toLowerCase();

    if (!entries.length) {
      return res.json({
        period,
        summary: {
          totalRevenue: 0,
          avgGuestCheck: 0,
          avgTableCheck: 0,
          totalDesserts: 0,
          avgKpi: 0
        },
        waiters: [],
        settings,
        availableWeeks: [],
        availableMonths: []
      });
    }

    if (period === 'monthly') {
      return res.json(buildMonthlyResponse(entries, String(req.query.month || '')));
    }

    return res.json(buildWeeklyResponse(entries, settings, String(req.query.week || '')));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load dashboard data', details: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
