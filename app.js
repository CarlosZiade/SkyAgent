/* app.js
   SkyAgent — Vanilla rewrite with:
   - Open-Meteo point data (includes pressure_msl hourly)
   - current_weather preference for "now"
   - Hourly chart (temp + wind)
   - Pressure chart (hourly forecast) + current pressure display
   - Leaflet map with optional tile overlays (you must provide tile URL/API key)
*/

/* ---------- CONFIG: set tile provider URLs here ----------
   If you want to show weather map overlays (pressure fields, fronts, temp),
   you need a tile provider that serves those layers.

   Examples (replace YOUR_API_KEY):
   - OpenWeatherMap Pressure (requires API key and weather maps subscription):
     const MAP_TILE_PRESSURE = 'https://tile.openweathermap.org/map/pressure_new/{z}/{x}/{y}.png?appid=YOUR_API_KEY';

   - MapTiler/XWeather or other services (check provider docs for tile path & key).
   If you don't have a provider, leave these null and overlay toggles will warn.
*/
const MAP_TILE_PRESSURE = null; // <- set to tile URL template if you have one
const MAP_TILE_TEMPERATURE = null;

const DOM = {
  searchForm: document.getElementById('searchForm'),
  cityInput: document.getElementById('cityInput'),
  status: document.getElementById('status'),
  currentCard: document.getElementById('current'),
  currentCity: document.getElementById('currentCity'),
  currentTemp: document.getElementById('currentTemp'),
  currentDesc: document.getElementById('currentDesc'),
  currentIcon: document.getElementById('currentIcon'),
  currentWind: document.getElementById('currentWind'),
  currentPrecip: document.getElementById('currentPrecip'),
  currentHum: document.getElementById('currentHum'),
  currentPressure: document.getElementById('currentPressure'),
  forecast: document.getElementById('forecast'),
  chartCard: document.getElementById('chartCard'),
  hourlyCanvas: document.getElementById('hourlyChart'),
  chartRange: document.getElementById('chartRange'),
  pressureCard: document.getElementById('pressureCard'),
  pressureCanvas: document.getElementById('pressureChart'),
  mapContainer: document.getElementById('map'),
  overlayPressureToggle: document.getElementById('overlayPressure'),
  overlayTempToggle: document.getElementById('overlayTemp'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  saveSettings: document.getElementById('saveSettings'),
  closeSettings: document.getElementById('closeSettings')
};

const LS_STATE = 'skyagent_state_v3';
const LS_LASTCITY = 'skyagent_lastcity_v3';

let chartInstance = null;
let pressureChart = null;
let map = null;
let overlayPressureLayer = null;
let overlayTempLayer = null;

let appState = { unit: 'C', timeFormat: 24 };

init();

function init(){
  loadState();
  wireUI();
  initMap();
  const last = localStorage.getItem(LS_LASTCITY);
  if (last) {
    DOM.cityInput.value = last;
    lookupAndRender(last).catch(e=>console.warn('initial fetch error', e));
  }
}

/* ---------- UI wiring ---------- */
function wireUI(){
  if (!DOM.searchForm || !DOM.cityInput) {
    console.error('Missing DOM elements for search.');
    return;
  }

  DOM.searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = DOM.cityInput.value.trim();
    if (!q) return showStatus('Please enter a city.');
    await lookupAndRender(q);
  });

  DOM.settingsBtn?.addEventListener('click', () => DOM.settingsOverlay.classList.remove('hidden'));
  DOM.closeSettings?.addEventListener('click', () => DOM.settingsOverlay.classList.add('hidden'));
  DOM.saveSettings?.addEventListener('click', () => {
    applySettingsFromUI();
    saveState();
    DOM.settingsOverlay.classList.add('hidden');
    const last = localStorage.getItem(LS_LASTCITY);
    if (last) lookupAndRender(last).catch(()=>{});
  });

  document.querySelectorAll('.unit-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.unit-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    });
    if (b.dataset.unit === appState.unit) b.classList.add('active');
  });
  document.querySelectorAll('.time-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.time-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    });
    if (String(b.dataset.time) === String(appState.timeFormat)) b.classList.add('active');
  });

  // Map overlay toggles
  DOM.overlayPressureToggle?.addEventListener('change', (e) => {
    if (e.target.checked) enablePressureOverlay(); else disablePressureOverlay();
  });
  DOM.overlayTempToggle?.addEventListener('change', (e) => {
    if (e.target.checked) enableTempOverlay(); else disableTempOverlay();
  });
}

/* ---------- STATE ---------- */
function loadState(){
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.unit) appState.unit = s.unit;
      if (s.timeFormat) appState.timeFormat = s.timeFormat;
    }
  } catch(e){ console.warn('loadState error', e); }
}
function saveState(){
  try{ localStorage.setItem(LS_STATE, JSON.stringify(appState)); }
  catch(e){ console.warn('saveState error', e); }
}
function applySettingsFromUI(){
  const activeUnit = document.querySelector('.unit-btn.active');
  const activeTime = document.querySelector('.time-btn.active');
  if (activeUnit) appState.unit = activeUnit.dataset.unit;
  if (activeTime) appState.timeFormat = parseInt(activeTime.dataset.time, 10);
}

/* ---------- MAIN flow ---------- */
async function lookupAndRender(query){
  showStatus('Searching…');
  hideAll();
  try{
    const place = await geocode(query);
    if (!place) { showStatus('City not found', true); return; }

    showStatus(`Found: ${place.name}, ${place.country}`);
    localStorage.setItem(LS_LASTCITY, query);

    const data = await fetchForecast(place.latitude, place.longitude);
    if (!data) { showStatus('Forecast unavailable', true); return; }

    renderCurrent(place, data);
    renderForecast(data);
    renderHourlyChart(data, place);
    renderPressureChart(data, place);
    // recenter map to the location
    if (map) map.setView([place.latitude, place.longitude], 8);
    showStatus('Latest forecast shown');
  }catch(err){
    console.error('lookup error', err);
    showStatus('Unable to fetch weather. Try again.', true);
  }
}

/* ---------- GEO & FORECAST ---------- */
async function geocode(q){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('geocode failed');
  const j = await r.json();
  if (!j.results || j.results.length === 0) return null;
  const first = j.results[0];
  return { name: first.name, country: first.country, latitude: first.latitude, longitude: first.longitude, timezone: first.timezone || 'UTC' };
}

async function fetchForecast(lat, lon){
  // include pressure_msl hourly and current_weather=true
  const params = [
    'hourly=temperature_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,relativehumidity_2m,pressure_msl',
    'daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
    'current_weather=true',
    'timezone=auto'
  ].join('&');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${params}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('forecast fetch failed');
  return r.json();
}

/* ---------- RENDER current (use current_weather if available) ---------- */
function renderCurrent(place, data){
  // Current pressure and other current metrics
  let currentTempC = null;
  let currentWind = null;
  let currentCode = null;
  let currentTimeStr = null;

  if (data.current_weather) {
    currentTempC = data.current_weather.temperature;
    currentWind = data.current_weather.windspeed;
    currentCode = data.current_weather.weathercode;
    currentTimeStr = data.current_weather.time;
  } else {
    // fallback: nearest hourly
    const idx = findClosestHourIndex(data.hourly.time);
    currentTempC = safeGet(data, ['hourly','temperature_2m',idx]);
    currentWind = safeGet(data, ['hourly','windspeed_10m',idx]);
    currentCode = safeGet(data, ['hourly','weathercode',idx]);
    currentTimeStr = safeGet(data, ['hourly','time',idx]);
  }

  // Pressure: prefer explicit current if present in API; else use hourly pressure_msl at matching time
  let pressure = null;
  if (data.current_weather && data.current_weather.pressure) {
    pressure = data.current_weather.pressure; // some models may include pressure here
  } else if (data.hourly && Array.isArray(data.hourly.time)) {
    // find exact index for the current time if available, otherwise nearest hour
    const times = data.hourly.time;
    let idx = times.indexOf(currentTimeStr);
    if (idx < 0) idx = findClosestHourIndex(times);
    pressure = safeGet(data, ['hourly','pressure_msl', idx]);
  }

  DOM.currentCity.textContent = `${place.name}, ${place.country}`;
  DOM.currentTemp.textContent = formatTemp(currentTempC);
  DOM.currentDesc.textContent = weatherLabel(currentCode);
  setIcon(DOM.currentIcon, currentCode);
  DOM.currentWind.textContent = `${Math.round(currentWind ?? 0)} m/s`;
  DOM.currentPrecip.textContent = `${safeGet(data, ['hourly','precipitation',0]) ?? '—'} mm`;
  DOM.currentHum.textContent = `${safeGet(data, ['hourly','relativehumidity_2m',0]) ?? '—'}%`;

  DOM.currentPressure.textContent = (pressure != null) ? Math.round(pressure) : '—';

  DOM.currentCard.classList.remove('hidden');
}

/* ---------- Forecast cards ---------- */
function renderForecast(data){
  DOM.forecast.innerHTML = '';
  const days = safeGet(data, ['daily','time'], []);
  const tmax = safeGet(data, ['daily','temperature_2m_max'], []);
  const tmin = safeGet(data, ['daily','temperature_2m_min'], []);
  const precip = safeGet(data, ['daily','precipitation_sum'], []);
  const codes = safeGet(data, ['daily','weathercode'], []);

  for (let i=0;i<days.length && i<3;i++){
    const date = new Date(days[i]);
    const dayName = date.toLocaleDateString(undefined, {weekday:'short'});
    const node = document.createElement('div');
    node.className = 'fcard';
    node.innerHTML = `
      <div class="day">${dayName}</div>
      <div class="icon small">${svgForCode(codes[i])}</div>
      <div class="t">${formatTemp(tmax[i])} / ${formatTemp(tmin[i])}</div>
      <div class="muted small">Precip: ${precip[i] ?? 0} mm</div>
    `;
    DOM.forecast.appendChild(node);
  }
  DOM.forecast.classList.remove('hidden');
}

/* ---------- Hourly temp+wind chart ---------- */
function renderHourlyChart(data, place){
  const times = safeGet(data, ['hourly','time'], []);
  const temps = safeGet(data, ['hourly','temperature_2m'], []);
  const winds = safeGet(data, ['hourly','windspeed_10m'], []);

  const maxPoints = Math.min(times.length, 48);
  const tTimes = times.slice(0, maxPoints);
  const tTemps = temps.slice(0, maxPoints);
  const tWinds = winds.slice(0, maxPoints);

  const labels = tTimes.map(t => {
    const dt = new Date(t);
    if (appState.timeFormat === 12) return dt.toLocaleString(undefined, {hour:'numeric', hour12:true});
    return dt.toLocaleString(undefined, {hour:'numeric', hour12:false});
  });

  // destroy previous chart
  if (chartInstance) { try { chartInstance.destroy(); } catch(e){} chartInstance = null; }

  // prepare canvas
  const canvas = DOM.hourlyCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(124,196,255,0.22)');
  grad.addColorStop(1, 'rgba(124,196,255,0.03)');

  const convTemps = tTemps.map(x => round1(convertTemp(x)));

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `Temperature (°${appState.unit})`,
          data: convTemps,
          tension: 0.25,
          yAxisID: 'y',
          pointRadius: 2,
          borderWidth: 2,
          borderColor: 'rgba(124,196,255,1)',
          backgroundColor: grad,
          fill: true,
        },
        {
          label: 'Wind (m/s)',
          data: tWinds.map(x => round1(x)),
          tension: 0.25,
          yAxisID: 'y1',
          pointRadius: 0,
          borderDash: [4,4],
          borderWidth: 1.5,
          borderColor: 'rgba(200,200,200,0.9)',
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350, easing: 'easeOutCubic' },
      interaction: {mode: 'index', intersect: false},
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: function(ctx){
              if (ctx.dataset.label.includes('Temperature')) return `${ctx.dataset.label}: ${ctx.formattedValue}°${appState.unit}`;
              return `${ctx.dataset.label}: ${ctx.formattedValue}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation:0, autoSkip:true, maxTicksLimit:10 } },
        y: { type:'linear', position:'left', title: { display:true, text:`°${appState.unit}` } },
        y1: { type:'linear', position:'right', grid: { drawOnChartArea:false }, title: { display:true, text:'m/s' }, ticks:{ maxTicksLimit:5 } }
      }
    }
  });

  if (tTimes.length > 0) {
    const s = new Date(tTimes[0]);
    const e = new Date(tTimes[tTimes.length - 1]);
    DOM.chartRange.textContent = `${s.toLocaleString(undefined, {hour:'numeric'})} — ${e.toLocaleString(undefined, {hour:'numeric'})}`;
  } else DOM.chartRange.textContent = '—';

  DOM.chartCard.classList.remove('hidden');
}

/* ---------- Pressure chart ---------- */
function renderPressureChart(data, place){
  const times = safeGet(data, ['hourly','time'], []);
  const pressures = safeGet(data, ['hourly','pressure_msl'], []);

  if (!times.length || !pressures.length) {
    DOM.pressureCard.classList.add('hidden');
    return;
  }

  const maxPoints = Math.min(times.length, 48);
  const tTimes = times.slice(0, maxPoints);
  const tPress = pressures.slice(0, maxPoints);

  const labels = tTimes.map(t => {
    const dt = new Date(t);
    if (appState.timeFormat === 12) return dt.toLocaleString(undefined, {hour:'numeric', hour12:true});
    return dt.toLocaleString(undefined, {hour:'numeric', hour12:false});
  });

  // destroy old
  if (pressureChart) { try { pressureChart.destroy(); } catch(e){} pressureChart = null; }

  const canvas = DOM.pressureCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || 160;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);

  pressureChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Pressure (hPa)',
        data: tPress.map(x => round1(x)),
        tension: 0.25,
        borderWidth: 2,
        borderColor: 'rgba(200,200,200,0.9)',
        backgroundColor: 'rgba(200,200,200,0.06)',
        fill: true,
        pointRadius: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: { ticks: { maxRotation:0, autoSkip:true, maxTicksLimit:8 } },
        y: { title: { display:true, text: 'hPa' }, ticks: { maxTicksLimit:6 } }
      }
    }
  });

  DOM.pressureCard.classList.remove('hidden');
}

/* ---------- Map: leaflet + overlay toggles ---------- */
function initMap(){
  try {
    map = L.map('map', { attributionControl: false }).setView([33.9, 35.5], 7); // center Lebanon by default

    // base layer: OpenStreetMap
    const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);

    // overlay layers will be created on demand if user toggles them and MAP_TILE_* set
  } catch(e) {
    console.warn('leaflet init failed', e);
    const note = document.getElementById('mapNote');
    if (note) note.textContent = 'Map failed to initialize in this browser.';
  }
}

function enablePressureOverlay(){
  if (!MAP_TILE_PRESSURE) {
    alert('No pressure tile URL configured. Edit app.js MAP_TILE_PRESSURE with your provider URL.');
    DOM.overlayPressureToggle.checked = false;
    return;
  }
  if (overlayPressureLayer) { map.addLayer(overlayPressureLayer); return; }
  overlayPressureLayer = L.tileLayer(MAP_TILE_PRESSURE, { opacity: 0.7, pane: 'overlayPane' });
  overlayPressureLayer.addTo(map);
}
function disablePressureOverlay(){
  if (overlayPressureLayer && map.hasLayer(overlayPressureLayer)) map.removeLayer(overlayPressureLayer);
}
function enableTempOverlay(){
  if (!MAP_TILE_TEMPERATURE) {
    alert('No temperature tile URL configured. Edit app.js MAP_TILE_TEMPERATURE with your provider URL.');
    DOM.overlayTempToggle.checked = false;
    return;
  }
  if (overlayTempLayer) { map.addLayer(overlayTempLayer); return; }
  overlayTempLayer = L.tileLayer(MAP_TILE_TEMPERATURE, { opacity: 0.6, pane: 'overlayPane' });
  overlayTempLayer.addTo(map);
}
function disableTempOverlay(){
  if (overlayTempLayer && map.hasLayer(overlayTempLayer)) map.removeLayer(overlayTempLayer);
}

/* ---------- Helpers ---------- */
function showStatus(msg, isError=false){ DOM.status.textContent = msg; DOM.status.style.color = isError ? '#ffb4b4' : ''; }
function hideAll(){ DOM.currentCard.classList.add('hidden'); DOM.forecast.classList.add('hidden'); DOM.chartCard.classList.add('hidden'); DOM.pressureCard.classList.add('hidden'); }

function safeGet(obj, path, fallback=null){
  try{
    return path.reduce((acc,k)=>acc&&acc[k], obj) ?? fallback;
  } catch(e){ return fallback; }
}
function findClosestHourIndex(timeArray){
  if (!Array.isArray(timeArray) || timeArray.length === 0) return 0;
  const now = Date.now();
  let closest = 0, minDiff = Infinity;
  for (let i=0;i<timeArray.length;i++){
    const t = Date.parse(timeArray[i]);
    if (isNaN(t)) continue;
    const diff = Math.abs(t - now);
    if (diff < minDiff) { minDiff = diff; closest = i; }
  }
  return closest;
}
function round1(n){ return Math.round(n*10)/10; }
function convertTemp(c){ return appState.unit === 'C' ? c : (c * 9/5) + 32; }
function formatTemp(v){ if (v === null || v === undefined) return '—'; return `${Math.round(convertTemp(v))}°${appState.unit}`; }

function weatherLabel(code){
  const map = {0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Moderate drizzle',55:'Dense drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',80:'Showers',95:'Thunderstorm'};
  return map[code] || 'Weather';
}
function svgForCode(code){
  if (code === 0) return `<svg class="icon-use"><use href="#icon-sun"></use></svg>`;
  if (code === 1 || code === 2) return `<svg class="icon-use"><use href="#icon-sun"></use></svg>`;
  if (code === 3) return `<svg class="icon-use"><use href="#icon-cloud"></use></svg>`;
  if (code >= 45 && code <= 48) return `<svg class="icon-use"><use href="#icon-fog"></use></svg>`;
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return `<svg class="icon-use"><use href="#icon-rain"></use></svg>`;
  if (code >= 95) return `<svg class="icon-use"><use href="#icon-storm"></use></svg>`;
  return `<svg class="icon-use"><use href="#icon-sun"></use></svg>`;
}
function setIcon(el, code){ el.innerHTML = svgForCode(code); const s = el.querySelector('svg'); if (s) s.classList.add('icon-use'); }

/* ---------- End ---------- */
