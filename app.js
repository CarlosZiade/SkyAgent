/* app.js — SkyAgent vanilla rewrite
   Features:
   - Search (Open-Meteo geocoding + forecast)
   - Current conditions widget
   - 3-day forecast cards
   - Hourly chart (Chart.js) — fixed: creates gradient once, destroys old chart, sets canvas pixel ratio
   - Settings: °C/°F and 12h/24h, saved to localStorage
   - Last city cached
*/

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
  forecast: document.getElementById('forecast'),
  chartCard: document.getElementById('chartCard'),
  hourlyCanvas: document.getElementById('hourlyChart'),
  chartRange: document.getElementById('chartRange'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  saveSettings: document.getElementById('saveSettings'),
  closeSettings: document.getElementById('closeSettings')
};

const LS_STATE = 'skyagent_state_v2';
const LS_LASTCITY = 'skyagent_lastcity_v2';

let chartInstance = null;
let appState = { unit: 'C', timeFormat: 24 };

init();

function init(){
  loadState();
  wireUI();
  const last = localStorage.getItem(LS_LASTCITY);
  if (last) {
    DOM.cityInput.value = last;
    lookupAndRender(last).catch(e=>console.warn('initial fetch error', e));
  }
}

function wireUI(){
  if (!DOM.searchForm || !DOM.cityInput) {
    console.error('Missing DOM elements for search.');
    return;
  }

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
    // re-render with new units if we have a last city
    const last = localStorage.getItem(LS_LASTCITY);
    if (last) lookupAndRender(last).catch(()=>{});
  });

  // settings buttons (unit/time)
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
  DOM.status.textContent = msg;
  DOM.status.style.color = isError ? '#ffb4b4' : '';
}
function hideAll(){ DOM.currentCard.classList.add('hidden'); DOM.forecast.classList.add('hidden'); DOM.chartCard.classList.add('hidden'); }

/* MAIN flow */
async function lookupAndRender(query){
  showStatus('Searching…');
  hideAll();
  try{
    const place = await geocode(query);
    if (!place) { showStatus('City not found', true); return; }

    showStatus(`Found: ${place.name}, ${place.country}`);
    localStorage.setItem(LS_LASTCITY, query);

    const forecast = await fetchForecast(place.latitude, place.longitude);
    if (!forecast) { showStatus('Forecast unavailable', true); return; }

    renderCurrent(place, forecast);
    renderForecast(forecast);
    renderHourlyChart(forecast, place);
    showStatus('Latest forecast shown');
  }catch(err){
    console.error('lookup error', err);
    showStatus('Unable to fetch weather. Try again.', true);
  }
}

/* GEOCODING */
async function geocode(q){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('geocode failed');
  const j = await r.json();
  if (!j.results || j.results.length === 0) return null;
  const first = j.results[0];
  return { name: first.name, country: first.country, latitude: first.latitude, longitude: first.longitude, timezone: first.timezone || 'UTC' };
}

/* FORECAST fetch */
async function fetchForecast(lat, lon){
  // Request hourly + daily; timezone=auto lets API return local times
  const params = [
    'hourly=temperature_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,relativehumidity_2m',
    'daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
    'timezone=auto'
  ].join('&');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${params}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('forecast fetch failed');
  return r.json();
}

/* RENDER current */
function renderCurrent(place, data){
  // use first hourly data point as current approximation
  const t = safeGet(data, ['hourly','temperature_2m',0]);
  const wind = safeGet(data, ['hourly','windspeed_10m',0]);
  const precip = safeGet(data, ['hourly','precipitation',0]) ?? 0;
  const hum = safeGet(data, ['hourly','relativehumidity_2m',0]) ?? '—';
  const code = safeGet(data, ['hourly','weathercode',0]) ?? 0;

  DOM.currentCity.textContent = `${place.name}, ${place.country}`;
  DOM.currentTemp.textContent = formatTemp(t);
  DOM.currentDesc.textContent = weatherLabel(code);
  setIcon(DOM.currentIcon, code);
  DOM.currentWind.textContent = `${Math.round(wind ?? 0)} m/s`;
  DOM.currentPrecip.textContent = `${precip} mm`;
  DOM.currentHum.textContent = `${hum}%`;

  DOM.currentCard.classList.remove('hidden');
}

/* RENDER forecast cards (3 days) */
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

/* CHART rendering (fixed and stable) */
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

  // destroy previous chart if exists
  if (chartInstance) {
    try { chartInstance.destroy(); } catch(e){ console.warn('destroy chart:', e); }
    chartInstance = null;
  }

  // prepare canvas & pixel ratio
  const canvas = DOM.hourlyCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // gradient once
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(124,196,255,0.22)');
  grad.addColorStop(1, 'rgba(124,196,255,0.03)');

  // convert temps according to unit
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
      animation: { duration: 350, easing: 'easeOutCubic' }, // finite animation: prevents looping
      interaction: {mode: 'index', intersect: false},
      plugins: {
        legend: { position: 'top', labels:{boxWidth:12} },
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

  // update chart range text
  if (tTimes.length > 0) {
    const s = new Date(tTimes[0]);
    const e = new Date(tTimes[tTimes.length - 1]);
    DOM.chartRange.textContent = `${s.toLocaleString(undefined, {hour:'numeric'})} — ${e.toLocaleString(undefined, {hour:'numeric'})}`;
  } else DOM.chartRange.textContent = '—';

  DOM.chartCard.classList.remove('hidden');
}

/* UTILITIES */
function safeGet(obj, path, fallback=null){
  try{
    return path.reduce((acc,k)=>acc&&acc[k], obj) ?? fallback;
  } catch(e){ return fallback; }
}
function round1(n){ return Math.round(n*10)/10; }
function convertTemp(c){ return appState.unit === 'C' ? c : (c * 9/5) + 32; }
function formatTemp(v){ if (v === null || v === undefined) return '—'; return `${Math.round(convertTemp(v))}°${appState.unit}`; }

/* weather code -> label/icon */
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

function round(n){ return Math.round(n); }

/* Done */
