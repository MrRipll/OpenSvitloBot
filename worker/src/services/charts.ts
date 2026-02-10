export function buildUptimeChartUrl(
  stats: { device_name: string; uptime_percent: number }[]
): string {
  const labels = stats.map((s) => s.device_name);
  const data = stats.map((s) => s.uptime_percent);
  const colors = data.map((v) => (v >= 95 ? '#22c55e' : v >= 80 ? '#eab308' : '#ef4444'));

  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Uptime %',
          data,
          backgroundColor: colors,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: { min: 0, max: 100, title: { display: true, text: '%' } },
      },
      plugins: {
        title: { display: true, text: 'Uptime за тиждень' },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=${Math.max(300, labels.length * 40)}&bkg=white`;
}

export function buildOutageHoursChartUrl(
  stats: { device_name: string; total_outage_hours: number }[]
): string {
  const labels = stats.map((s) => s.device_name);
  const data = stats.map((s) => s.total_outage_hours);

  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Години без світла',
          data,
          backgroundColor: '#ef4444',
        },
      ],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        title: { display: true, text: 'Години без світла за тиждень' },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=${Math.max(300, labels.length * 40)}&bkg=white`;
}
