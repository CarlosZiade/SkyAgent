/* script.js — full frontend for SkyAgent (Vercel backend)
   - Calls /api/weather?q=<city>
   - Renders current, hourly temp+wind chart, hourly pressure chart
   - Leaflet map with overlay toggles (/api/tile proxy)
   - Preserves UI and layout from index.html/style.css above
*/

const API_WEATHER = '/api/weather';
const API_TILE = '/api/tile';

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

const LS_STATE = 'skyagent_state_v_final';
const LS_LASTCITY = 'skyagent_lastcity_v_final';

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
    lookupAndRender(last).catch(()=>{});
  }
}

function wireUI(){
  if (DOM.searchForm && DOM.cityInput) {
    DOM.searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = DOM.cityInput.value.trim();
      if (!q) return showStatus('Please enter a city name.', true);
      await lookupAndRender(q);
    });
  }

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

  DOM.overlayPressureToggle?.addEventListener('change', (e) => {
    if (e.target.checked) enablePressureOverlay(); else disablePressureOverlay();
  });
  DOM.overlayTempToggle?.addEventListener('change', (e) => {
    if (e.target.checked) enableTempOverlay(); else disableTempOverlay();
  });
}

/* STATE */
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

/* UI helpers */
function showStatus(msg, isError=false){
  if (!DOM.status) { console.log(msg); return; }
  DOM.status.textContent = msg;
  DOM.status.style.color = isError ? '#ffb4b4' : '';
}
function hideAll(){ DOM.currentCard.classList.add('hidden'); DOM.forecast.classList.add('hidden'); DOM.chartCard.classList.add('hidden'); DOM.pressureCard.classList.add('hidden'); }

/* MAIN flow */
async function lookupAndRender(query){
  showStatus('Searching…');
  hideAll();
  try{
    const url = `${API_WEATHER}?q=${encodeURIComponent(query)}`;
    const r = await fetch(url);
    if (!r.ok) {
      const err = await r.json().catch(()=>({error:'unknown'}));
      throw new Error(err.error || 'API error');
    }
    const data = await r.json();
    localStorage.setItem(LS_LASTCITY, query);

    renderCurrent(data.place, data.current);
    renderForecast(data.daily);
    renderHourlyChart(data.hourly, data.place);
    renderPressureChart(data.hourly, data.place);

    if (map && data.place) map.setView([data.place.lat, data.place.lon], 8);

    showStatus('Latest forecast shown');
  }catch(err){
    console.error('lookup error', err);
    showStatus('Unable to fetch weather. Try again.', true);
  }
}

/* RENDER current */
function renderCurrent(place, current){
  const t = current.temperature;
  DOM.currentCity.textContent = `${place.name}, ${place.country}`;
  DOM.currentTemp.textContent = formatTemp(t);
  DOM.currentDesc.textContent = weatherLabel(current.weather_code);
  setIcon(DOM.currentIcon, current.weather_code);
  DOM.currentWind.textContent = `${Math.round(current.windspeed ?? 0)} m/s`;
  DOM.currentPrecip.textContent = `${current.precip ?? '—'} mm`;
  DOM.currentHum.textContent = `${current.humidity ?? '—'}%`;
  DOM.currentPressure.textContent = (current.pressure != null) ? Math.round(current.pressure) : '—';

  DOM.currentCard.classList.remove('hidden');
}

/* RENDER forecast cards (3 days) */
function renderForecast(daily){
  if (!daily) { DOM.forecast.classList.add('hidden'); return; }
  DOM.forecast.innerHTML = '';
  const days = daily.time || [];
  const tmax = daily.temperature_2m_max || [];
  const tmin = daily.temperature_2m_min || [];
  const precip = daily.precipitation_sum || [];
  const codes = daily.weathercode || [];

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

/* CHART rendering */
function renderHourlyChart(hourly, place){
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const winds = hourly.windspeed_10m || [];

  const maxPoints = Math.min(times.length, 48);
  const tTimes = times.slice(0, maxPoints);
  const tTemps = temps.slice(0, maxPoints);
  const tWinds = winds.slice(0, maxPoints);

  const labels = tTimes.map(t => {
    const dt = new Date(t);
    if (appState.timeFormat === 12) return dt.toLocaleString(undefined, {hour:'numeric', hour12:true});
    return dt.toLocaleString(undefined, {hour:'numeric', hour12:false});
  });

  if (chartInstance) { try { chartInstance.destroy(); } catch(e){ } chartInstance = null; }

  const canvas = DOM.hourlyCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
      },
      layout: { padding: 6 }
    }
  });

  if (tTimes.length > 0) {
    const s = new Date(tTimes[0]);
    const e = new Date(tTimes[tTimes.length - 1]);
    DOM.chartRange.textContent = `${s.toLocaleString(undefined, {hour:'numeric'})} — ${e.toLocaleString(undefined, {hour:'numeric'})}`;
  } else DOM.chartRange.textContent = '—';

  DOM.chartCard.classList.remove('hidden');
}

/* Pressure chart */
function renderPressureChart(hourly){
  const times = hourly.time || [];
  const pressures = hourly.pressure_msl || [];

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

/* Map and overlays (tile proxy) */
function initMap(){
  try {
    map = L.map('map', { attributionControl: false }).setView([33.9, 35.5], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  } catch(e) {
    console.warn('leaflet init failed', e);
    const note = document.getElementById('mapNote');
    if (note) note.textContent = 'Map failed to initialize in this browser.';
  }
}
function enablePressureOverlay(){
  if (!map) return;
  // tile proxy: /api/tile?layer=pressure&time=ISO&z={z}&x={x}&y={y}
  const time = new Date().toISOString().split('.')[0] + 'Z';
  const urlTemplate = `/api/tile?layer=pressure&time=${encodeURIComponent(time)}&z={z}&x={x}&y={y}`;
  overlayPressureLayer = L.tileLayer(urlTemplate, { opacity: 0.7, tileSize: 256 });
  overlayPressureLayer.addTo(map);
}
function disablePressureOverlay(){
  if (overlayPressureLayer && map.hasLayer(overlayPressureLayer)) map.removeLayer(overlayPressureLayer);
}
function enableTempOverlay(){
  if (!map) return;
  const time = new Date().toISOString().split('.')[0] + 'Z';
  const urlTemplate = `/api/tile?layer=temperature&time=${encodeURIComponent(time)}&z={z}&x={x}&y={y}`;
  overlayTempLayer = L.tileLayer(urlTemplate, { opacity: 0.65, tileSize: 256 });
  overlayTempLayer.addTo(map);
}
function disableTempOverlay(){
  if (overlayTempLayer && map.hasLayer(overlayTempLayer)) map.removeLayer(overlayTempLayer);
}

/* UTILITIES */
function safeGet(obj, path, fallback=null){
  try { return path.reduce((acc,k)=>acc&&acc[k], obj) ?? fallback; } catch(e){ return fallback; }
}
function round1(n){ return Math.round(n*10)/10; }
function convertTemp(c){ return appState.unit === 'C' ? c : (c * 9/5) + 32; }
function formatTemp(v){ if (v === null || v === undefined) return '—'; return `${Math.round(convertTemp(v))}°${appState.unit}`; }
function weatherLabel(code){ const map = {0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Moderate drizzle',55:'Dense drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',80:'Showers',95:'Thunderstorm'}; return map[code] || 'Weather'; }
function svgForCode(code){ if (code === 0) return `<svg class="icon-use"><use href="#icon-sun"></use></svg>`; if (code === 1 || code === 2) return `<svg class="icon-use"><use href="#icon-sun"></use></svg>`; if (code === 3) return `<svg class="icon-use"><use href="#icon-cloud"></use></svg>`; if (code >= 45 && code <= 48) return `<svg class="icon-use"><use href="#icon-fog"></use></svg>`; if ((code >= 51 && code <= 57) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return `<svg class="icon-use"><use href="#icon-rain"></use></svg>`; if (code >= 95) return `<svg class="icon-use"><use href="#icon-storm"></use></svg>`; return `<svg class="icon-use"><use href="#icon-sun"></use></svg>`; }
function setIcon(el, code){ if (!el) return; el.innerHTML = svgForCode(code); const s = el.querySelector('svg'); if (s) s.classList.add('icon-use'); }

