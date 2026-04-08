const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

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
  const bestDessert = [...data.waiters].sort((a, b) => b.desserts - a.desserts)[0];

  const notes = state.period === 'weekly'
    ? [
        {
          title: 'Лидер недели',
          text: `${top.name} сейчас впереди по выручке: ${formatNumber(top.amount)}.`
        },
        {
          title: 'Лучший по десертам',
          text: `${bestDessert.name} лидирует по десертам: ${formatNumber(bestDessert.desserts)}.`
        },
        {
          title: 'Точка роста',
          text: `${low.name} пока ниже остальных по выручке. Смотри средний чек и допродажи.`
        }
      ]
    : [
        {
          title: 'Лидер месяца',
          text: `${top.name} впереди по месячной сумме: ${formatNumber(top.amount)}.`
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

    return `
      <article class="waiter-card">
        <div class="waiter-top">
          <div class="waiter-name">${waiter.name}</div>
          <div class="rank">#${index + 1}</div>
        </div>
        <div class="big-amount">${formatNumber(waiter.amount)}</div>
        <div class="trend ${tClass}">${trendLabel}</div>
        <div class="detail-grid">
          <div class="detail"><span>Ср чек / гость</span><strong>${formatNumber(waiter.avgGuestCheck)}</strong></div>
          <div class="detail"><span>Ср чек / стол</span><strong>${formatNumber(waiter.avgTableCheck)}</strong></div>
          <div class="detail"><span>Десерты</span><strong>${formatNumber(waiter.desserts)}</strong></div>
          <div class="detail"><span>Маржинальные</span><strong>${formatNumber(waiter.marginalDishes)}</strong></div>
          <div class="detail"><span>KPI</span><strong>${waiter.kpi}%</strong></div>
          <div class="detail"><span>Тренд KPI</span><strong>${waiter.trendKpi ? formatPercent(waiter.trendKpi) : '—'}</strong></div>
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
        'rgba(217,179,106,0.92)',
        'rgba(217,179,106,0.84)',
        'rgba(217,179,106,0.76)',
        'rgba(217,179,106,0.68)',
        'rgba(217,179,106,0.60)',
        'rgba(217,179,106,0.52)'
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
