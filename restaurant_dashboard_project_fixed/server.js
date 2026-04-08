const express = require('express');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const KPI_TARGETS = {
  avgGuestCheck: 390000,
  avgTableCheck: 730000,
  marginPercent: 32,
  dessertPercent: 100
};

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const serviceAccount = {
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined
};

function safeNum(value) {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function safeStr(value) {
  return String(value ?? '').trim();
}

function getISOWeek(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()} W${String(weekNo).padStart(2, '0')}`;
}

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function computeWaiterKpi(waiter) {
  const avgGuestCheck = waiter.avgGuestCheck || 0;
  const avgTableCheck = waiter.avgTableCheck || 0;
  const marginPercent = waiter.totalDishes > 0 ? (waiter.marginalDishes / waiter.totalDishes) * 100 : 0;
  const dessertPercent = waiter.tables > 0 ? (waiter.desserts / waiter.tables) * 100 : 0;

  const avgGuestProgress = avgGuestCheck > 0 ? Math.round((avgGuestCheck / KPI_TARGETS.avgGuestCheck) * 100) : 0;
  const avgTableProgress = avgTableCheck > 0 ? Math.round((avgTableCheck / KPI_TARGETS.avgTableCheck) * 100) : 0;
  const marginProgress = marginPercent > 0 ? Math.round((marginPercent / KPI_TARGETS.marginPercent) * 100) : 0;
  const dessertProgress = dessertPercent > 0 ? Math.round((dessertPercent / KPI_TARGETS.dessertPercent) * 100) : 0;

  const total = Math.round(
    (avgGuestProgress + avgTableProgress + marginProgress + dessertProgress) / 4
  );

  return {
    marginPercent: Math.round(marginPercent),
    dessertPercent: Math.round(dessertPercent),
    kpi: total
  };
}

async function getSheetRows() {
  if (!SHEET_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Не заполнены GOOGLE_SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY');
  }

  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(serviceAccount);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle['weekly_data'] || doc.sheetsByIndex[0];
  const rows = await sheet.getRows();

  return rows.map((row) => {
    const rawDate =
      row.get('date') ||
      row.get('Дата') ||
      row.get('day') ||
      row.get('created_at') ||
      '';

    const parsedDate = rawDate ? new Date(rawDate) : null;
    const validDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

    const waiter =
      row.get('name') ||
      row.get('waiter') ||
      row.get('официант') ||
      row.get('Официант') ||
      '';

    const amount =
      safeNum(row.get('amount')) ||
      safeNum(row.get('revenue')) ||
      safeNum(row.get('sum')) ||
      safeNum(row.get('выручка'));

    const guests =
      safeNum(row.get('guests')) ||
      safeNum(row.get('guestCount')) ||
      safeNum(row.get('гости'));

    const tables =
      safeNum(row.get('tables')) ||
      safeNum(row.get('tableCount')) ||
      safeNum(row.get('столы'));

    const desserts =
      safeNum(row.get('desserts')) ||
      safeNum(row.get('dessertCount')) ||
      safeNum(row.get('десерты'));

    const marginalDishes =
      safeNum(row.get('marginalDishes')) ||
      safeNum(row.get('marginDishes')) ||
      safeNum(row.get('маржинальные'));

    const totalDishes =
      safeNum(row.get('totalDishes')) ||
      safeNum(row.get('allDishes')) ||
      safeNum(row.get('all_positions')) ||
      safeNum(row.get('всеБлюда'));

    return {
      date: validDate,
      dateKey: validDate ? validDate.toISOString().slice(0, 10) : '',
      week: validDate ? getISOWeek(validDate) : safeStr(row.get('week')),
      month: validDate ? getMonthKey(validDate) : safeStr(row.get('month')),
      name: safeStr(waiter),
      amount,
      guests,
      tables,
      desserts,
      marginalDishes,
      totalDishes
    };
  }).filter((r) => r.name);
}

function aggregateWaiters(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.name)) {
      map.set(row.name, {
        name: row.name,
        amount: 0,
        guests: 0,
        tables: 0,
        desserts: 0,
        marginalDishes: 0,
        totalDishes: 0
      });
    }

    const item = map.get(row.name);
    item.amount += row.amount;
    item.guests += row.guests;
    item.tables += row.tables;
    item.desserts += row.desserts;
    item.marginalDishes += row.marginalDishes;
    item.totalDishes += row.totalDishes;
  }

  const waiters = Array.from(map.values()).map((item) => {
    const avgGuestCheck = item.guests > 0 ? Math.round(item.amount / item.guests) : 0;
    const avgTableCheck = item.tables > 0 ? Math.round(item.amount / item.tables) : 0;
    const extra = computeWaiterKpi({
      ...item,
      avgGuestCheck,
      avgTableCheck
    });

    return {
      ...item,
      avgGuestCheck,
      avgTableCheck,
      marginPercent: extra.marginPercent,
      dessertPercent: extra.dessertPercent,
      kpi: extra.kpi
    };
  });

  waiters.sort((a, b) => b.amount - a.amount);

  return waiters;
}

function buildSummary(waiters) {
  const totalRevenue = waiters.reduce((sum, w) => sum + w.amount, 0);
  const totalGuests = waiters.reduce((sum, w) => sum + w.guests, 0);
  const totalTables = waiters.reduce((sum, w) => sum + w.tables, 0);
  const totalDesserts = waiters.reduce((sum, w) => sum + w.desserts, 0);
  const avgKpi = waiters.length
    ? Math.round(waiters.reduce((sum, w) => sum + (w.kpi || 0), 0) / waiters.length)
    : 0;

  return {
    totalRevenue,
    avgGuestCheck: totalGuests > 0 ? Math.round(totalRevenue / totalGuests) : 0,
    avgTableCheck: totalTables > 0 ? Math.round(totalRevenue / totalTables) : 0,
    totalDesserts,
    avgKpi
  };
}

function buildWeekList(rows) {
  return [...new Set(rows.map((r) => r.week).filter(Boolean))].sort().reverse();
}

function buildMonthList(rows) {
  return [...new Set(rows.map((r) => r.month).filter(Boolean))].sort().reverse();
}

function buildTrend(currentWaiters, previousWaiters) {
  const prevMap = new Map(previousWaiters.map((w) => [w.name, w]));

  return currentWaiters.map((w) => {
    const prev = prevMap.get(w.name);

    const trendAmount = prev && prev.amount > 0
      ? ((w.amount - prev.amount) / prev.amount) * 100
      : 0;

    const trendKpi = prev && prev.kpi > 0
      ? ((w.kpi - prev.kpi) / prev.kpi) * 100
      : 0;

    return {
      ...w,
      trendAmount,
      trendKpi
    };
  });
}

function buildMonthlyChart(rows, selectedMonth) {
  const monthRows = rows.filter((r) => r.month === selectedMonth);

  const weekKeys = [...new Set(monthRows.map((r) => r.week).filter(Boolean))].sort();
  const waiterNames = [...new Set(monthRows.map((r) => r.name))];

  const series = {};

  for (const name of waiterNames) {
    series[name] = weekKeys.map((week) => {
      const weekRows = monthRows.filter((r) => r.week === week && r.name === name);
      return weekRows.reduce((sum, r) => sum + r.amount, 0);
    });
  }

  return {
    labels: weekKeys,
    series
  };
}

app.get('/api/dashboard', async (req, res) => {
  try {
    const period = req.query.period === 'monthly' ? 'monthly' : 'weekly';
    const rows = await getSheetRows();

    const availableWeeks = buildWeekList(rows);
    const availableMonths = buildMonthList(rows);

    const currentWeek = req.query.week || availableWeeks[0] || '';
    const currentMonth = req.query.month || availableMonths[0] || '';

    if (period === 'weekly') {
      const filteredRows = rows.filter((r) => r.week === currentWeek);
      const previousWeek = availableWeeks[availableWeeks.indexOf(currentWeek) + 1] || '';
      const previousRows = rows.filter((r) => r.week === previousWeek);

      const waitersCurrent = aggregateWaiters(filteredRows);
      const waitersPrevious = aggregateWaiters(previousRows);
      const waiters = buildTrend(waitersCurrent, waitersPrevious);

      return res.json({
        period,
        currentWeek,
        availableWeeks,
        waiters,
        summary: buildSummary(waiters)
      });
    }

    const filteredRows = rows.filter((r) => r.month === currentMonth);
    const waitersBase = aggregateWaiters(filteredRows);

    const prevMonth = availableMonths[availableMonths.indexOf(currentMonth) + 1] || '';
    const previousRows = rows.filter((r) => r.month === prevMonth);
    const previousWaiters = aggregateWaiters(previousRows);
    const waiters = buildTrend(waitersBase, previousWaiters);

    const chart = buildMonthlyChart(rows, currentMonth);

    const monthWeeks = [...new Set(filteredRows.map((r) => r.week).filter(Boolean))].sort();

    const enrichedWaiters = waiters.map((w) => ({
      ...w,
      weeklySeries: monthWeeks.map((week) => {
        const amount = filteredRows
          .filter((r) => r.week === week && r.name === w.name)
          .reduce((sum, r) => sum + r.amount, 0);
        return amount;
      })
    }));

    return res.json({
      period,
      currentMonth,
      availableMonths,
      waiters: enrichedWaiters,
      summary: buildSummary(enrichedWaiters),
      chart
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Ошибка загрузки dashboard',
      details: error.message
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
