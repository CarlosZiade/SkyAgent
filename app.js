// script.js — frontend (vanilla) for SkyAgent on Vercel
// Fetches data from /api/weather and uses /api/tile for map overlays.

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

const LS_STATE = 'skyagent_state_v4';
const LS_LASTCITY = 'skyagent_lastcity_v4';

let chartInstance = null;
let pressureChart = null;
let map = null;
let pressureLayer = null;
let tempLayer = null;

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
  DOM.searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = DOM.cityInput.value.trim();
    if (!q) return showStatus('Please enter a city name.');
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

  DOM.overlayPressureToggle?.addEventListener('change', (e) => {
    if (e.target.checked) addPressureLayer(); else removePressureLayer();
  });
  DOM.overlayTempToggle?.addEventListener('change', (e) => {
    if (e.target.checked) addTempLayer(); else removeTempLayer();
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
  } catch(e){ console.warn('loadState', e); }
}
function saveState(){ try{ localStorage.setItem(LS_STATE, JSON.stringify(appState)); } catch(e){} }
function applySettingsFromUI(){
  const activeUnit = document.querySelector('.unit-btn.active');
  const activeTime = document.querySelector('.time-btn.active');
  if (activeUnit) appState.unit = activeUnit.dataset.unit;
  if (activeTime) appState.timeFormat = parseInt(activeTime.dataset.time, 10);
}

/* MAIN */
async function lookupAndRender(query){
  showStatus('Searching…');
  hideAll();
  try{
    // First: geocode via Meteomatics? We'll use the Vercel /api/weather which expects lat/lon — but it's helpful UX to accept "city" text
    // We'll call a lightweight geocoding service server-side via the same API (api/weather supports ?q=city — implemented in server code)
    const url = `/api/weather?q=${encodeURIComponent(query)}`;
    const r = await fetch(url);
    if (!r.ok) {
      const err = await r.json().catch(()=>({error:'unknown'}));
      throw new Error(err.error || 'api error');
    }
    const data = await r.json(); // this includes place {name, country, lat, lon} and timeseries arrays
    // save last city (the original query)
    localStorage.setItem(LS_LASTCITY, query);

    renderCurrent(data.place, data);
    renderForecast(data);
    renderHourlyChart(data);
    renderPressureChart(data);

    // map center
    if (map && data.place) map.setView([data.place.lat, data.place.lon], 8);

    showStatus('Latest forecast shown');
  }catch(err){
    console.error(err);
    showStatus('Unable to fetch weather. Try again.', true);
  }
}

/* RENDER helpers */
function renderCurrent(place, data){
  // data.current contains numbers in Celsius/hPa etc.
  const cw = data.current; // structure defined in server
  DOM.currentCity.textContent = `${place.name}, ${place.country}`;
  DOM.currentTemp.textContent = `${Math.round(convertTemp(cw.temperature))}°${appState.unit}`;
  DOM.currentDesc.textContent = cw.weather_label || '—';
  setIcon(DOM.currentIcon, cw.weather_code);
  DOM.currentWind.textContent = `${Math.round(cw.windspeed ?? 0)} m/s`;
  DOM.currentPrecip.textContent = `${cw.precip ?? '—'} mm`;
  DOM.currentHum.textContent = `${cw.humidity ?? '—'}%`;
  DOM.currentPressure.textContent = cw.pressure ? Math.round(cw.pressure) : '—';
  DOM.currentCard.classList.remove('hidden');
}

function renderForecast(data){
  DOM.forecast.innerHTML = '';
  const daily = data.daily;
  if (!daily || !daily.time) return;
  for (let i = 0; i < Math.min(daily.time.length, 3); i++){
    const date = new Date(daily.time[i]);
    const dayName = date.toLocaleDateString(undefined, {weekday:'short'});
    const tmax = daily.temperature_2m_max[i];
    const tmin = daily.temperature_2m_min[i];
    const precip = daily.precipitation_sum ? daily.precipitation_sum[i] : 0;
    const code = daily.weathercode ? daily.weathercode[i] : 0;

    const node = document.createElement('div');
    node.className = 'fcard';
    node.innerHTML = `
      <div class="day">${dayName}</div>
      <div class="icon small">${svgForCode(code)}</div>
      <div class="t">${Math.round(convertTemp(tmax))}° / ${Math.round(convertTemp(tmin))}°</div>
      <div class="muted small">Precip: ${precip ?? 0} mm</div>
    `;
    DOM.forecast.appendChild(node);
  }
  DOM.forecast.classList.remove('hidden');
}

/* CHARTS */
function renderHourlyChart(data){
  const times = data.hourly.time || [];
  const temps = data.hourly.temperature_2m || [];
  const winds = data.hourly.windspeed_10m || [];

  const maxPoints = Math.min(times.length, 48);
  const tTimes = times.slice(0, maxPoints);
  const tTemps = temps.slice(0, maxPoints);
  const tWinds = winds.slice(0, maxPoints);

  const labels = tTimes.map(t => {
    const dt = new Date(t);
    if (appState.timeFormat === 12) return dt.toLocaleString(undefined, {hour:'numeric', hour12:true});
    return dt.toLocaleString(undefined, {hour:'numeric', hour12:false});
  });

  if (chartInstance) { try { chartInstance.destroy(); } catch(e){} chartInstance = null; }

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

  const convTemps = tTemps.map(x => Math.round(convertTemp(x) * 10) / 10);

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
          data: tWinds.map(x => Math.round(x*10)/10),
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
      animation: { duration: 350 },
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
        y1: { type:'linear', position:'right', grid: { drawOnChartArea:false }, title: { display:true, text:'m/s' } }
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

function renderPressureChart(data){
  const times = data.hourly.time || [];
  const pressures = data.hourly.pressure_msl || [];

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
        data: tPress.map(x => Math.round(x*10)/10),
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
        y: { title: { display:true, text: 'hPa' } }
      }
    }
  });

  DOM.pressureCard.classList.remove('hidden');
}

/* MAP: leafet and overlay via /api/tile proxy */
function initMap(){
  try {
    map = L.map('map', { attributionControl: false }).setView([33.9, 35.5], 7); // Lebanon default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  } catch(e) {
    console.warn('map init', e);
  }
}
function addPressureLayer(){
  if (!map) return;
  // proxy tile URL is /api/tile?layer=pressure&z={z}&x={x}&y={y}&time=ISO
  const time = new Date().toISOString().split('.')[0] + 'Z';
  const urlTemplate = `/api/tile?layer=pressure&time=${encodeURIComponent(time)}&z={z}&x={x}&y={y}`;
  pressureLayer = L.tileLayer(urlTemplate, { opacity:0.7, tileSize:256 });
  pressureLayer.addTo(map);
}
function removePressureLayer(){
  if (pressureLayer && map.hasLayer(pressureLayer)) map.removeLayer(pressureLayer);
}
function addTempLayer(){
  if (!map) return;
  const time = new Date().toISOString().split('.')[0] + 'Z';
  const urlTemplate = `/api/tile?layer=temperature&time=${encodeURIComponent(time)}&z={z}&x={x}&y={y}`;
  tempLayer = L.tileLayer(urlTemplate, { opacity:0.65, tileSize:256 });
  tempLayer.addTo(map);
}
function removeTempLayer(){
  if (tempLayer && map.hasLayer(tempLayer)) map.removeLayer(tempLayer);
}

/* UTIL */
function showStatus(msg, isError=false){ DOM.status.textContent = msg; DOM.status.style.color = isError ? '#ffb4b4' : ''; }
function hideAll(){ DOM.currentCard.classList.add('hidden'); DOM.forecast.classList.add('hidden'); DOM.chartCard.classList.add('hidden'); DOM.pressureCard.classList.add('hidden'); }
function safeGet(obj, path, fallback=null){ try{ return path.reduce((a,k)=>a&&a[k], obj) ?? fallback; }catch(e){return fallback;} }
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
function convertTemp(c){ return appState.unit === 'C' ? c : (c * 9/5) + 32; }
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
