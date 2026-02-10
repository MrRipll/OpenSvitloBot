/* OpenSvitloBot — Dashboard Application */

const REFRESH_INTERVAL = 30000; // 30 seconds
let API_BASE = localStorage.getItem('osvitlobot_api') || '';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initCharts();

  const savedApi = localStorage.getItem('osvitlobot_api');
  if (savedApi) {
    document.getElementById('apiUrl').value = savedApi;
    API_BASE = savedApi;
    startDashboard();
  }

  document.getElementById('saveConfig').addEventListener('click', saveConfig);
});

function saveConfig() {
  const url = document.getElementById('apiUrl').value.trim().replace(/\/$/, '');
  if (!url) return;
  localStorage.setItem('osvitlobot_api', url);
  API_BASE = url;
  startDashboard();
}

function startDashboard() {
  document.getElementById('configBanner').style.display =
    API_BASE ? 'none' : 'block';

  if (API_BASE) {
    fetchAll();
    setInterval(fetchAll, REFRESH_INTERVAL);
  }
}

// --- Data fetching ---
async function fetchJSON(path) {
  const resp = await fetch(API_BASE + path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function fetchAll() {
  try {
    const [statusData, outageData, statsData] = await Promise.all([
      fetchJSON('/api/status'),
      fetchJSON('/api/outages?days=7'),
      fetchJSON('/api/stats?period=7d'),
    ]);

    renderSummary(statusData.devices);
    renderDevices(statusData.devices);
    renderOutages(outageData.outages);
    renderUptimeChart('uptimeChart', statsData.stats);

    document.getElementById('lastUpdate').textContent =
      'Updated: ' + new Date().toLocaleTimeString('uk-UA');
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

// --- Render functions ---
function renderSummary(devices) {
  const online = devices.filter(d => d.status === 'online').length;
  const offline = devices.filter(d => d.status === 'offline').length;
  const total = devices.length;

  document.getElementById('totalDevices').textContent = total;
  document.getElementById('onlineCount').textContent = online;
  document.getElementById('offlineCount').textContent = offline;

  const pct = total > 0 ? Math.round((online / total) * 100) : 0;
  const uptimeEl = document.getElementById('uptimePercent');
  uptimeEl.textContent = pct + '%';
  uptimeEl.className = 'card-value ' + (pct >= 90 ? 'green' : pct >= 50 ? 'yellow' : 'red');
}

function renderDevices(devices) {
  const container = document.getElementById('devicesGrid');

  if (devices.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📡</div>
        <p>No devices registered yet.<br>Use POST /api/register to add one.</p>
      </div>`;
    return;
  }

  // Group by group_name
  const groups = {};
  for (const d of devices) {
    const g = d.group_name || 'Ungrouped';
    if (!groups[g]) groups[g] = [];
    groups[g].push(d);
  }

  let html = '';
  for (const [groupName, groupDevices] of Object.entries(groups)) {
    html += `<div class="group-name">${escapeHtml(groupName)}</div>`;
    html += '<div class="devices-grid">';
    for (const d of groupDevices) {
      const ago = d.last_ping_ago !== null ? formatDuration(d.last_ping_ago) + ' ago' : 'never';
      html += `
        <div class="device-card">
          <div class="status-dot ${d.status}"></div>
          <div class="device-info">
            <div class="device-name">${escapeHtml(d.name)}</div>
            <div class="device-meta">Last ping: ${ago}</div>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

function renderOutages(outages) {
  const container = document.getElementById('outagesList');

  if (outages.length === 0) {
    container.innerHTML = '<div class="empty"><p>No outages in the last 7 days</p></div>';
    return;
  }

  let html = '';
  for (const o of outages.slice(0, 20)) {
    const ongoing = !o.end_time;
    const start = new Date(o.start_time);
    const startStr = start.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) +
      ' ' + start.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

    let durationStr;
    if (ongoing) {
      const elapsed = Math.floor((Date.now() - o.start_time) / 1000);
      durationStr = formatDuration(elapsed) + ' (ongoing)';
    } else {
      durationStr = formatDuration(o.duration);
    }

    html += `
      <div class="outage-row">
        <div class="outage-dot ${ongoing ? 'ongoing' : 'resolved'}"></div>
        <div class="outage-device">${escapeHtml(o.device_name)}</div>
        <div class="outage-time">${startStr}</div>
        <div class="outage-duration">${durationStr}</div>
      </div>`;
  }

  container.innerHTML = html;
}

// --- Helpers ---
function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  if (m < 60) return m + 'min';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h + 'h ' + rm + 'min';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
