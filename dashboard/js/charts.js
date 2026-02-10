/* OpenSvitloBot — Chart helpers using Chart.js */

let uptimeChart = null;
let timelineChart = null;

function initCharts() {
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.borderColor = '#1f2937';
}

function renderUptimeChart(canvasId, stats) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (uptimeChart) uptimeChart.destroy();

  const labels = stats.map(s => s.device_name);
  const data = stats.map(s => s.uptime_percent);
  const colors = data.map(v => v >= 95 ? '#22c55e' : v >= 80 ? '#eab308' : '#ef4444');

  uptimeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Uptime %',
        data,
        backgroundColor: colors,
        borderRadius: 4,
        barThickness: 20,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          min: 0,
          max: 100,
          grid: { color: '#1f2937' },
          ticks: { callback: v => v + '%' }
        },
        y: {
          grid: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.parsed.x.toFixed(1) + '% uptime'
          }
        }
      }
    }
  });
}

function renderTimelineChart(canvasId, outages, devices) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (timelineChart) timelineChart.destroy();

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const deviceNames = [...new Set(outages.map(o => o.device_name))];
  if (deviceNames.length === 0) {
    deviceNames.push(...devices.map(d => d.name).slice(0, 10));
  }

  const datasets = outages
    .filter(o => o.start_time > weekAgo)
    .map(o => ({
      x: [new Date(o.start_time), new Date(o.end_time || now)],
      y: o.device_name,
    }));

  // Group data by device
  const grouped = {};
  for (const d of datasets) {
    if (!grouped[d.y]) grouped[d.y] = [];
    grouped[d.y].push(d.x);
  }

  const chartDatasets = Object.entries(grouped).map(([name, ranges]) => ({
    label: name,
    data: ranges.map(r => ({ x: r, y: name })),
    backgroundColor: '#ef4444',
    borderRadius: 2,
    barThickness: 16,
  }));

  timelineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: deviceNames,
      datasets: chartDatasets.length > 0 ? chartDatasets : [{
        label: 'No outages',
        data: [],
        backgroundColor: '#22c55e',
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          min: weekAgo,
          max: now,
          time: { unit: 'day', displayFormats: { day: 'dd.MM' } },
          grid: { color: '#1f2937' },
        },
        y: {
          grid: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              if (!d || !d.x) return '';
              const start = new Date(d.x[0]).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
              const end = d.x[1] ? new Date(d.x[1]).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : 'зараз';
              return `${start} — ${end}`;
            }
          }
        }
      }
    }
  });
}
