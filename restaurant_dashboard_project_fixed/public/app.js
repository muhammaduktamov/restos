const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const KPI_TARGETS = {
  avgGuestCheck: 390000,
  avgTableCheck: 730000,
  marginPercent: 32,
  dessertPercent: 100
};

const state = {
  period: 'weekly',
  selectedRange: '',
  chart: null,
  weeklyData: null,
  monthlyData: null
};

const els = {
  totalRevenue: document.getElementById('totalRevenue'),
  avgGuestCheck: document.getElementById('avgGuestCheck'),
  avgTableCheck: document.getElementById('avgTableCheck'),
  totalDesserts: document.getElementById('totalDesserts'),
  avgKpi: document.getElementById('avgKpi'),
  rangeSelect: document.getElementById('rangeSelect'),
  selectorLabel: document.getElementById('selectorLabel'),
  waiterCards: document.getElementById('waiterCards'),
  notes: document.getElementById('notes'),
  chartTitle: document.getElementById('chartTitle'),
  chartKicker: document.getElementById('chartKicker'),
  boardTitle: document.getElementById('boardTitle'),
  periodButtons: [...document.querySelectorAll('.period-btn')],
  chartCanvas: document.getElementById('dashboardChart')
};

function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(value || 0));
}

function formatMoneyShort(value) {
  const num = Number(value || 0);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${Math.round(num / 1000)}k`;
  return `${Math.round(num)}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function trendClass(value) {
  if (value > 0.1) return 'up';
  if (value < -0.1) return 'down';
  return 'flat';
}

function trendArrow(value) {
  if (value > 0.1) return '↑';
  if (value < -0.1) return '↓';
  return '→';
}

function clamp(value, min = 0, max = 999) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeProgress(value) {
  return clamp(Math.round(value || 0), 0, 150);
}

function getProgressTone(progress) {
  if (progress >= 100) return 'success';
  if (progress >= 80) return 'warning';
  return 'danger';
}

function getProgressColor(progress) {
  if (progress >= 100) return '#16c784';
  if (progress >= 80) return '#f0b90b';
  return '#ea3943';
}

function getMedal(index) {
  if (index === 0) return '👑';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return '';
}

function getSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function calcKpi(waiter) {
  const avgGuestCheck = getSafeNumber(waiter.avgGuestCheck);
  const avgTableCheck = getSafeNumber(waiter.avgTableCheck);

  const desserts = getSafeNumber(waiter.desserts);
  const tables = getSafeNumber(waiter.tables);
  const totalDishes = getSafeNumber(waiter.totalDishes);
  const marginalDishes = getSafeNumber(waiter.marginalDishes);

  const marginPercentFromData = getSafeNumber(waiter.marginPercent, null);
  const dessertPercentFromData = getSafeNumber(waiter.dessertPercent, null);

  const marginPercent = totalDishes > 0
    ? (marginalDishes / totalDishes) * 100
    : (Number.isFinite(marginPercentFromData) ? marginPercentFromData : 0);

  const dessertPercent = tables > 0
    ? (desserts / tables) * 100
    : (Number.isFinite(dessertPercentFromData) ? dessertPercentFromData : 0);

  const avgGuestProgress = avgGuestCheck > 0
    ? normalizeProgress((avgGuestCheck / KPI_TARGETS.avgGuestCheck) * 100)
    : 0;

  const avgTableProgress = avgTableCheck > 0
    ? normalizeProgress((avgTableCheck / KPI_TARGETS.avgTableCheck) * 100)
    : 0;

  const marginProgress = marginPercent > 0
    ? normalizeProgress((marginPercent / KPI_TARGETS.marginPercent) * 100)
    : 0;

  const dessertProgress = dessertPercent > 0
    ? normalizeProgress((dessertPercent / KPI_TARGETS.dessertPercent) * 100)
    : 0;

  const total = Math.round(
    (avgGuestProgress + avgTableProgress + marginProgress + dessertProgress) / 4
  );

  return {
    avgGuestCheck,
    avgTableCheck,
    marginPercent: Math.round(marginPercent),
    dessertPercent: Math.round(dessertPercent),

    avgGuestProgress,
    avgTableProgress,
    marginProgress,
    dessertProgress,
    total,

    avgGuestLeft: Math.max(0, KPI_TARGETS.avgGuestCheck - Math.round(avgGuestCheck)),
    avgTableLeft: Math.max(0, KPI_TARGETS.avgTableCheck - Math.round(avgTableCheck)),
    marginLeft: Math.max(0, KPI_TARGETS.marginPercent - Math.round(marginPercent)),
    dessertsLeft: tables > 0 ? Math.max(0, tables - desserts) : 0
  };
}

function kpiMiniCard(label, fact, plan, progress, helper = '') {
  const tone = getProgressTone(progress);
  const color = getProgressColor(progress);

  return `
    <div class="kpi-box ${tone}">
      <div class="kpi-box-head">
        <span>${label}</span>
        <strong style="color:${color}">${progress}%</strong>
      </div>
      <div class="kpi-box-fact">${fact}</div>
      <div class="kpi-box-plan">План: ${plan}</div>
      <div class="mini-progress">
        <div class="mini-progress-fill" style="width:${Math.min(progress, 100)}%; background:${color}"></div>
      </div>
      ${helper ? `<div class="kpi-box-helper">${helper}</div>` : ''}
    </div>
  `;
}

async function fetchData(period, rangeValue = '') {
  const query = new URLSearchParams({ period });
  if (period === 'weekly' && rangeValue) query.set('week', rangeValue);
  if (period === 'monthly' && rangeValue) query.set('month', rangeValue);

  const res = await fetch(`/api/dashboard?${query.toString()}`);
  if (!res.ok) throw new Error('Не удалось загрузить данные');
  return res.json();
}

function renderSummary(summary) {
  els.totalRevenue.textContent = formatNumber(summary.totalRevenue);
  els.avgGuestCheck.textContent = formatNumber(summary.avgGuestCheck);
  els.avgTableCheck.textContent = formatNumber(summary.avgTableCheck);
  els.totalDesserts.textContent = formatNumber(summary.totalDesserts);
  els.avgKpi.textContent = `${summary.avgKpi || 0}%`;
}

function renderRangeSelect(data) {
  const isWeekly = state.period === 'weekly';
  const items = isWeekly ? data.availableWeeks || [] : data.availableMonths || [];
  const current = isWeekly ? data.currentWeek : data.currentMonth;

  els.selectorLabel.textContent = isWeekly ? 'Выбор недели' : 'Выбор месяца';
  els.rangeSelect.innerHTML = items
    .map((item) => `<option value="${item}" ${item === current ? 'selected' : ''}>${item}</option>`)
    .join('');
}

function renderNotes(data) {
  if (!data.waiters?.length) {
    els.notes.innerHTML = '<div class="note"><strong>Нет данных</strong><span>Заполни weekly_data в Google Sheets.</span></div>';
    return;
  }

  const top = data.waiters[0];
  const low = data.waiters[data.waiters.length - 1];
  const bestDessert = [...data.waiters].sort((a, b) => (b.desserts || 0) - (a.desserts || 0))[0];
  const strongestKpi = [...data.waiters]
    .map((waiter) => ({ name: waiter.name, kpi: calcKpi(waiter).total }))
    .sort((a, b) => b.kpi - a.kpi)[0];

  const notes = state.period === 'weekly'
    ? [
        {
          title: 'Лидер недели',
          text: `${top.name} сейчас впереди по выручке: ${formatNumber(top.amount)}.`
        },
        {
          title: 'Лучший по KPI',
          text: `${strongestKpi.name} показывает лучшее выполнение целей: ${strongestKpi.kpi}%.`
        },
        {
          title: 'Лучший по десертам',
          text: `${bestDessert.name} лидирует по десертам: ${formatNumber(bestDessert.desserts)}.`
        },
        {
          title: 'Точка роста',
          text: `${low.name} пока ниже остальных по выручке. Смотри средний чек, маржу и допродажи десертов.`
        }
      ]
    : [
        {
          title: 'Лидер месяца',
          text: `${top.name} впереди по месячной сумме: ${formatNumber(top.amount)}.`
        },
        {
          title: 'Лучший по KPI',
          text: `${strongestKpi.name} показывает лучшее выполнение месячных целей: ${strongestKpi.kpi}%.`
        },
        {
          title: 'Фокус месяца',
          text: `Смотри месячный график: он показывает, кто реально растет от недели к неделе.`
        },
        {
          title: 'Десерты и маржа',
          text: `${bestDessert.name} сильнее всех закрывает месяц по десертам: ${formatNumber(bestDessert.desserts)}.`
        }
      ];

  els.notes.innerHTML = notes
    .map((note) => `
      <div class="note">
        <strong>${note.title}</strong>
        <span>${note.text}</span>
      </div>
    `)
    .join('');
}

function renderCards(data) {
  if (!data.waiters?.length) {
    els.waiterCards.innerHTML = '<div class="waiter-card"><div class="waiter-name">Нет данных</div></div>';
    return;
  }

  els.waiterCards.innerHTML = data.waiters.map((waiter, index) => {
    const trendValue = waiter.trendAmount ?? 0;
    const tClass = trendClass(trendValue);
    const trendLabel = state.period === 'weekly'
      ? `${trendArrow(trendValue)} ${formatPercent(trendValue)} к прошлой неделе`
      : `${waiter.weeklySeries?.length || 0} нед. в месяце`;

    const kpi = calcKpi(waiter);
    const totalColor = getProgressColor(kpi.total);
    const totalTone = getProgressTone(kpi.total);
    const medal = getMedal(index);

    return `
      <article class="waiter-card ${index === 0 ? 'top-card' : ''}">
        <div class="waiter-top">
          <div class="waiter-top-left">
            <div class="waiter-name-row">
              <div class="waiter-name">${medal ? `${medal} ${waiter.name}` : waiter.name}</div>
              <div class="rank">#${index + 1}</div>
            </div>
            <div class="trend ${tClass}">${trendLabel}</div>
          </div>

          <div class="kpi-ring ${totalTone}" style="border-color:${totalColor}">
            <span style="color:${totalColor}">${kpi.total}%</span>
          </div>
        </div>

        <div class="hero-row">
          <div>
            <div class="hero-label">Выручка</div>
            <div class="big-amount">${formatNumber(waiter.amount)}</div>
          </div>
          <div class="hero-chip">
            <span>AVG KPI</span>
            <strong style="color:${totalColor}">${kpi.total}%</strong>
          </div>
        </div>

        <div class="main-progress">
          <div class="main-progress-fill" style="width:${Math.min(kpi.total, 100)}%; background:${totalColor}"></div>
        </div>

        <div class="leader-stats">
          <div class="leader-stat">
            <span>Сумма</span>
            <strong>${formatMoneyShort(waiter.amount)}</strong>
          </div>
          <div class="leader-stat">
            <span>Десерты</span>
            <strong>${formatNumber(waiter.desserts)}</strong>
          </div>
          <div class="leader-stat">
            <span>Маржа</span>
            <strong>${kpi.marginPercent}%</strong>
          </div>
        </div>

        <div class="detail-grid enhanced">
          ${kpiMiniCard(
            'Ср чек / гость',
            formatNumber(kpi.avgGuestCheck),
            formatNumber(KPI_TARGETS.avgGuestCheck),
            kpi.avgGuestProgress,
            kpi.avgGuestLeft > 0 ? `До цели: ${formatNumber(kpi.avgGuestLeft)}` : 'Цель выполнена'
          )}

          ${kpiMiniCard(
            'Ср чек / стол',
            formatNumber(kpi.avgTableCheck),
            formatNumber(KPI_TARGETS.avgTableCheck),
            kpi.avgTableProgress,
            kpi.avgTableLeft > 0 ? `До цели: ${formatNumber(kpi.avgTableLeft)}` : 'Цель выполнена'
          )}

          ${kpiMiniCard(
            'Маржинальные',
            `${kpi.marginPercent}%`,
            `${KPI_TARGETS.marginPercent}%`,
            kpi.marginProgress,
            kpi.marginLeft > 0 ? `До цели: ${kpi.marginLeft}%` : 'Цель выполнена'
          )}

          ${kpiMiniCard(
            'Десерты',
            `${kpi.dessertPercent}%`,
            `${KPI_TARGETS.dessertPercent}%`,
            kpi.dessertProgress,
            kpi.dessertsLeft > 0 ? `Еще десертов: ${kpi.dessertsLeft}` : 'Цель выполнена'
          )}
        </div>
      </article>
    `;
  }).join('');
}

function destroyChart() {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
}

function renderChart(data) {
  destroyChart();

  let labels = [];
  let datasets = [];

  if (state.period === 'weekly') {
    labels = data.waiters.map((w) => w.name);
    datasets = [{
      label: 'Выручка',
      data: data.waiters.map((w) => w.amount),
      backgroundColor: [
        'rgba(217,179,106,0.96)',
        'rgba(217,179,106,0.88)',
        'rgba(217,179,106,0.80)',
        'rgba(217,179,106,0.72)',
        'rgba(217,179,106,0.64)',
        'rgba(217,179,106,0.56)',
        'rgba(217,179,106,0.48)',
        'rgba(217,179,106,0.40)'
      ],
      borderRadius: 14,
      borderSkipped: false
    }];
    els.chartTitle.textContent = 'Сравнение официантов за неделю';
    els.chartKicker.textContent = data.currentWeek || 'Неделя';
    els.boardTitle.textContent = 'Лидеры недели';
  } else {
    labels = data.chart?.labels || [];
    const palette = [
      'rgba(217,179,106,1)',
      'rgba(126,214,164,1)',
      'rgba(120,170,255,1)',
      'rgba(255,125,125,1)',
      'rgba(255,209,102,1)',
      'rgba(186,104,200,1)'
    ];

    datasets = Object.entries(data.chart?.series || {}).map(([name, values], index) => ({
      label: name,
      data: values,
      borderColor: palette[index % palette.length],
      backgroundColor: palette[index % palette.length],
      tension: 0.35,
      fill: false
    }));
    els.chartTitle.textContent = 'Месячный график по неделям';
    els.chartKicker.textContent = data.currentMonth || 'Месяц';
    els.boardTitle.textContent = 'Итоги месяца';
  }

  state.chart = new Chart(els.chartCanvas, {
    type: state.period === 'weekly' ? 'bar' : 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#fff8ef' }
        },
        tooltip: {
          backgroundColor: 'rgba(10, 8, 7, 0.95)',
          borderColor: 'rgba(217,179,106,0.18)',
          borderWidth: 1,
          titleColor: '#fff8ef',
          bodyColor: '#eadfce',
          callbacks: {
            label: (context) => ` ${context.dataset.label}: ${formatNumber(context.raw)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#eadfce' },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: '#bcae9f',
            callback: (value) => formatNumber(value)
          },
          grid: { color: 'rgba(255,240,220,0.06)' }
        }
      }
    }
  });
}

async function load(period = state.period, rangeValue = '') {
  state.period = period;
  const data = await fetchData(period, rangeValue);
  if (period === 'weekly') state.weeklyData = data;
  if (period === 'monthly') state.monthlyData = data;

  renderSummary(data.summary);
  renderRangeSelect(data);
  renderNotes(data);
  renderCards(data);
  renderChart(data);

  els.periodButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
}

els.periodButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const period = btn.dataset.period;
    await load(period);
  });
});

els.rangeSelect.addEventListener('change', async (e) => {
  await load(state.period, e.target.value);
});

load().catch((error) => {
  console.error(error);
  els.notes.innerHTML = `<div class="note"><strong>Ошибка</strong><span>${error.message}</span></div>`;
});
