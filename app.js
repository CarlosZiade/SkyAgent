/* script.js — Full frontend logic for SkyAgent (Vercel backend)
   - Fetches /api/weather?q=... (serverless function proxies Meteomatics)
   - Renders current weather, hourly temp+wind chart, hourly pressure chart
   - Leaflet map with tile overlays via /api/tile?layer=...
   - LocalStorage for last city + user settings
*/

/* ----------------- Configuration & State ----------------- */
const API_WEATHER = '/api/weather'; // relative to same origin (Vercel)
const API_TILE = '/api/tile';       // tile proxy (Vercel)

const LS_KEY_STATE = 'skyagent_state_vX';
const LS_KEY_LASTCITY = 'skyagent_lastcity_vX';

let appState = {
  unit: 'C',       // 'C' or 'F'
  timeFormat: 24   // 24 or 12
};

let charts = {
  tempWind: null,
  pressure: null
};

let map = null;
let overlayLayers = { pressure: null, temperature: null };

/* ----------------- DOM bindings (tolerant if elements missing) ----------------- */
const DOM = {
  cityInput: document.getElementById('cityInput'),
  // if your index.html uses a form, the code below will attach listeners;
  // otherwise a search button might call the global searchWeather() (we provide both).
  status: document.getElementById('status') || null,
  // current card
  locationEl: document.getElementById('location'),
  descriptionEl: document.getElementById('description'),
  tempEl: document.getElementById('temperature'),
  feelsEl: document.getElementById('feelsLike'),
  pressureEl: document.getElementById('pressure'),
  // optional additional fields (if present in markup)
  humidityEl: document.getElementById('humidity'),
  precipEl: document.getElementById('precip'),
  // charts
  tempCanvas: document.getElementById('tempChart'),
  pressureCanvas: document.getElementById('pressureChart'),
  // map
  mapContainer: document.getElementById('map'),
  // overlay toggles (if present)
  overlayPressureToggle: document.getElementById('overlayPressure'),
  overlayTempToggle: document.getElementById('overlayTemp'),
  // settings overlay (optional)
  settingsBtn: document.getElementById('settingsBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  saveSettings: document.getElementById('saveSettings'),
  closeSettings: document.getElementById('closeSettings'),
};

/* ----------------- Utilities ----------------- */
function showStatus(msg, isError = false) {
  if (!DOM.status) return console.log('status:', msg);
  DOM.status.textContent = msg;
  DOM.status.style.color = isError ? '#ff7b7b' : '';
}

function round1(n) { return Math.round((n + Number.EPSILON) * 10) / 10; }
function round0(n) { return Math.round(n); }
function toISOHour(d = new Date()) {
  // remove milliseconds, keep Z
  const iso = new Date(d);
  iso.setMinutes(0, 0, 0); // round to hour (Meteomatics often expects a precise hour)
  return iso.toISOString().split('.')[0] + 'Z';
}
function convertTempFromC(c) {
  return appState.unit === 'C' ? c : (c * 9/5) + 32;
}
function formatTemp(v) {
  if (v === null || v === undefined) return '—';
  return `${round0(convertTempFromC(v))}°${appState.unit}`;
}
function safeGet(obj, path, fallback = null) {
  try {
    return path.reduce((a, k) => (a ? a[k] : undefined), obj) ?? fallback;
  } catch (e) { return fallback; }
}

/* ----------------- Local storage for state ----------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY_STATE);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.unit) appState.unit = s.unit;
    if (s.timeFormat) appState.timeFormat = s.timeFormat;
  } catch (e) { console.warn('loadState failed', e); }
}
function saveState() {
  try { localStorage.setItem(LS_KEY_STATE, JSON.stringify(appState)); } catch (e) {}
}

/* ----------------- Init UI / Map / Events ----------------- */
function init() {
  loadState();
  wireUI();
  initMapIfNeeded();

  // auto-search last city
  try {
    const last = localStorage.getItem(LS_KEY_LASTCITY);
    if (last && DOM.cityInput) {
      DOM.cityInput.value = last;
      // small delay so page finishes rendering
      setTimeout(() => searchWeather(last), 300);
    }
  } catch (e) {}
}
function wireUI() {
  // search input + button behavior
  if (DOM.cityInput) {
    // if there's a form around the input, listen for submit
    const form = DOM.cityInput.closest('form');
    if (form) {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const q = DOM.cityInput.value.trim();
        if (!q) return showStatus('Enter a city name.', true);
        searchWeather(q);
      });
    }
  }

  // expose global function searchWeather for inline button on index.html (older markup)
  window.searchWeather = async function (q) {
    const query = q || (DOM.cityInput ? DOM.cityInput.value.trim() : '');
    if (!query) return showStatus('Enter a city name.', true);
    await searchWeather(query);
  };

  // overlay toggles (if present)
  if (DOM.overlayPressureToggle) DOM.overlayPressureToggle.addEventListener('change', (e) => {
    if (e.target.checked) addTileOverlay('pressure'); else removeTileOverlay('pressure');
  });
  if (DOM.overlayTempToggle) DOM.overlayTempToggle.addEventListener('change', (e) => {
    if (e.target.checked) addTileOverlay('temperature'); else removeTileOverlay('temperature');
  });

  // settings overlay (optional)
  if (DOM.settingsBtn && DOM.settingsOverlay) {
    DOM.settingsBtn.addEventListener('click', () => DOM.settingsOverlay.classList.remove('hidden'));
    DOM.closeSettings?.addEventListener('click', () => DOM.settingsOverlay.classList.add('hidden'));
    DOM.saveSettings?.addEventListener('click', () => {
      // apply settings from UI if present (buttons with data-unit / data-time)
      const unitBtn = document.querySelector('.unit-btn.active');
      const timeBtn = document.querySelector('.time-btn.active');
      if (unitBtn) appState.unit = unitBtn.dataset.unit;
      if (timeBtn) appState.timeFormat = Number(timeBtn.dataset.time);
      saveState();
      DOM.settingsOverlay.classList.add('hidden');
      // re-render current charts/data with new units if data present
      const last = localStorage.getItem(LS_KEY_LASTCITY);
      if (last) searchWeather(last);
    });
  }
}

/* ----------------- Map: Leaflet init + overlays ----------------- */
function initMapIfNeeded() {
  if (!DOM.mapContainer) return;
  try {
    map = L.map(DOM.mapContainer, { attributionControl: false }).setView([33.9, 35.5], 7); // center Lebanon
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  } catch (e) {
    console.warn('Leaflet init failed', e);
  }
}

function addTileOverlay(layerName) {
  if (!map) return;
  // time param: current hour ISO
  const time = toISOHour(new Date());
  const template = `${API_TILE}?layer=${encodeURIComponent(layerName)}&time=${encodeURIComponent(time)}&z={z}&x={x}&y={y}`;
  // remove if exists
  removeTileOverlay(layerName);
  const options = { opacity: layerName === 'pressure' ? 0.7 : 0.6, tileSize: 256 };
  const tileLayer = L.tileLayer(template, options);
  tileLayer.addTo(map);
  overlayLayers[layerName] = tileLayer;
}

function removeTileOverlay(layerName) {
  if (!map) return;
  const layer = overlayLayers[layerName];
  if (layer && map.hasLayer(layer)) map.removeLayer(layer);
  overlayLayers[layerName] = null;
}

/* ----------------- Fetch & normalize data ----------------- */
async function fetchWeatherForQuery(q) {
  showStatus('Fetching weather…');
  const url = `${API_WEATHER}?q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(()=>null);
    throw new Error(`Weather API error: ${res.status} ${txt || ''}`);
  }
  const j = await res.json();
  return j;
}

// Normalize server payload into consistent shape used by renderers
function normalizeServerPayload(raw) {
  // possible shapes:
  // - raw.place, raw.current, raw.hourly (from the server code we provided)
  // - older minimal formats might have raw.data etc.
  const out = {
    place: { name: 'Unknown', country: '', lat: null, lon: null },
    current: {},
    hourly: { time: [], temperature_2m: [], pressure_msl: [], precipitation: [], windspeed_10m: [], relativehumidity_2m: [], weathercode: [] },
    daily: null
  };

  // place
  if (raw.place) {
    out.place.name = raw.place.name ?? (raw.place.city ?? out.place.name);
    out.place.country = raw.place.country ?? '';
    out.place.lat = raw.place.lat ?? raw.place.latitude ?? null;
    out.place.lon = raw.place.lon ?? raw.place.longitude ?? null;
  } else if (raw.data && Array.isArray(raw.data)) {
    // fallback if raw is direct meteomatics response — attempt to find lat/lon in payload
    out.place.name = 'Unknown';
  }

  // current — server returns 'current' with keys: temperature, apparent_temperature, pressure, precip, windspeed, humidity, weather_code
  if (raw.current) {
    out.current.temperature = raw.current.temperature ?? raw.current.temp ?? null;
    out.current.apparent_temperature = raw.current.apparent_temperature ?? raw.current.feels_like ?? null;
    out.current.pressure = raw.current.pressure ?? raw.current.pressure_msl ?? null;
    out.current.precip = raw.current.precip ?? raw.current.precipitation ?? null;
    out.current.windspeed = raw.current.windspeed ?? raw.current.wind ?? null;
    out.current.humidity = raw.current.humidity ?? raw.current.humidity_pct ?? null;
    out.current.weather_code = raw.current.weather_code ?? raw.current.weathercode ?? null;
    out.current.time = raw.current.time ?? null;
  }

  // hourly
  if (raw.hourly && Array.isArray(raw.hourly.time)) {
    const h = raw.hourly;
    out.hourly.time = h.time || [];
    out.hourly.temperature_2m = h.temperature_2m || h.temperature_2m || h.t_2m || [];
    out.hourly.pressure_msl = h.pressure_msl || h.pressure || h.pressure_msl || [];
    // server uses 'pressure_msl' key; older variants might differ
    out.hourly.precipitation = h.precipitation || h.precip || [];
    out.hourly.windspeed_10m = h.windspeed_10m || h.windspeed || [];
    out.hourly.relativehumidity_2m = h.relativehumidity_2m || h.humidity || [];
    out.hourly.weathercode = h.weathercode || h.weather_code || h.weathercode || [];
  } else {
    // try to detect meteomatics style raw.data array (when server didn't transform)
    // skip complex fallback to keep client lightweight — server should send expected shape.
  }

  // daily if present
  if (raw.daily && Array.isArray(raw.daily.time)) {
    out.daily = raw.daily;
  }

  return out;
}

/* ----------------- Rendering ----------------- */
function renderCurrent(place, current) {
  if (DOM.locationEl) DOM.locationEl.textContent = `${place.name}${place.country ? ', ' + place.country : ''}`;
  if (DOM.descriptionEl) DOM.descriptionEl.textContent = weatherLabelFromCode(current.weather_code) || '—';
  if (DOM.tempEl) DOM.tempEl.textContent = formatTemp(current.temperature);
  if (DOM.feelsEl) DOM.feelsEl.textContent = formatTemp(current.apparent_temperature ?? current.temperature);
  if (DOM.pressureEl) DOM.pressureEl.textContent = current.pressure != null ? round0(current.pressure) : '—';
  if (DOM.humidityEl) DOM.humidityEl.textContent = current.humidity != null ? `${round0(current.humidity)}%` : '—';
  if (DOM.precipEl) DOM.precipEl.textContent = current.precip != null ? `${round1(current.precip)} mm` : '—';
}

function weatherLabelFromCode(code) {
  // small mapping for Meteomatics weather symbol indices — fallback to text
  const map = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    80: 'Rain showers',
    95: 'Thunderstorm'
  };
  return map[code] || (code ? String(code) : null);
}

/* CHART helpers use a pattern that avoids continuous animation / layout loops */
function renderTempWindChart(hourly) {
  if (!DOM.tempCanvas) return;
  const labels = hourly.time.map(t => {
    const dt = new Date(t);
    return appState.timeFormat === 12 ? dt.toLocaleString(undefined, { hour: 'numeric', hour12: true }) : dt.toLocaleString(undefined, { hour: 'numeric', hour12: false });
  });

  const tempsC = hourly.temperature_2m;
  const winds = hourly.windspeed_10m;

  // destroy previous
  if (charts.tempWind) { try { charts.tempWind.destroy(); } catch (e) {} charts.tempWind = null; }

  // canvas sizing + DPR
  const canvas = DOM.tempCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight || 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // gradient created once
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(124,196,255,0.22)');
  grad.addColorStop(1, 'rgba(124,196,255,0.02)');

  const convTemps = tempsC.map(t => round1(convertTempFromC(t)));

  charts.tempWind = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `Temperature (°${appState.unit})`,
          data: convTemps,
          borderColor: 'rgba(124,196,255,1)',
          backgroundColor: grad,
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          yAxisID: 'y'
        },
        {
          label: 'Wind (m/s)',
          data: winds.map(x => x == null ? null : round1(x)),
          borderColor: 'rgba(200,200,200,0.9)',
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          tension: 0.25,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label(ctx) {
              if (ctx.dataset.label && ctx.dataset.label.includes('Temperature')) return `${ctx.dataset.label}: ${ctx.formattedValue}°${appState.unit}`;
              return `${ctx.dataset.label}: ${ctx.formattedValue}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { type: 'linear', position: 'left', title: { display: true, text: `°${appState.unit}` } },
        y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'm/s' } }
      },
      layout: { padding: 6 }
    }
  });
}

function renderPressureChart(hourly) {
  if (!DOM.pressureCanvas) return;
  const labels = hourly.time.map(t => {
    const dt = new Date(t);
    return appState.timeFormat === 12 ? dt.toLocaleString(undefined, { hour: 'numeric', hour12: true }) : dt.toLocaleString(undefined, { hour: 'numeric', hour12: false });
  });

  const pressures = hourly.pressure_msl || hourly.pressure || [];

  if (!pressures || pressures.length === 0) {
    // hide canvas or show message (if your markup supports)
    return;
  }

  if (charts.pressure) { try { charts.pressure.destroy(); } catch (e) {} charts.pressure = null; }

  const canvas = DOM.pressureCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 400;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight || 160;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  charts.pressure = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Pressure (hPa)',
        data: pressures.map(x => x == null ? null : round1(x)),
        borderColor: 'rgba(200,200,200,0.9)',
        backgroundColor: 'rgba(200,200,200,0.06)',
        fill: true,
        tension: 0.25,
        pointRadius: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
        y: { title: { display: true, text: 'hPa' } }
      }
    }
  });
}

/* ----------------- Top-level search / render flow ----------------- */
async function searchWeather(query) {
  try {
    showStatus('Searching…');
    // store last used city for convenience
    try { localStorage.setItem(LS_KEY_LASTCITY, query); } catch (e) {}

    const raw = await fetchWeatherForQuery(query);
    const normalized = normalizeServerPayload(raw);

    // render current
    renderCurrent(normalized.place, normalized.current);

    // render charts
    if (normalized.hourly && normalized.hourly.time && normalized.hourly.time.length) {
      renderTempWindChart(normalized.hourly);
      renderPressureChart(normalized.hourly);
    }

    // center map if available
    if (map && normalized.place.lat != null && normalized.place.lon != null) {
      try { map.setView([normalized.place.lat, normalized.place.lon], 8); } catch (e) {}
    }

    showStatus(`Showing weather for ${normalized.place.name}${normalized.place.country ? ', ' + normalized.place.country : ''}`);
  } catch (err) {
    console.error(err);
    showStatus('Failed to fetch weather. See console for details.', true);
  }
}

/* ----------------- Small compatibility helpers ----------------- */
function weatherLabelFromCode(code) {
  const map = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
    55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    80: 'Showers', 95: 'Thunderstorm'
  };
  return map[code] || null;
}

/* ----------------- Kick off ----------------- */
document.addEventListener('DOMContentLoaded', () => {
  init();
});
