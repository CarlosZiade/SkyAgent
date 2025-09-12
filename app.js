// app.js — SkyAgent updated: mobile UI, settings, caching, Chart.js fix

const searchForm = document.getElementById('searchForm');
const cityInput = document.getElementById('cityInput');
const statusEl = document.getElementById('status');

const currentCard = document.getElementById('current');
const currentCity = document.getElementById('currentCity');
const currentTemp = document.getElementById('currentTemp');
const currentDesc = document.getElementById('currentDesc');
const currentIcon = document.getElementById('currentIcon');
const currentWind = document.getElementById('currentWind');
const currentPrecip = document.getElementById('currentPrecip');
const currentHum = document.getElementById('currentHum');

const forecastEl = document.getElementById('forecast');
const chartCard = document.getElementById('chartCard');
const hourlyCanvas = document.getElementById('hourlyChart');
const chartRange = document.getElementById('chartRange');

const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const saveSettings = document.getElementById('saveSettings');
const closeSettings = document.getElementById('closeSettings');

let myChart = null;
let appState = {
  unit: 'C',    // 'C' or 'F'
  timeFormat: 24 // 24 or 12
};

// persist keys
const LS_KEY = 'skyagent_state_v1';
const LS_CITY = 'skyagent_lastcity_v1';

loadStateFromStorage();
wireSettingsUI();

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = cityInput.value.trim();
  if (!q) return showStatus('Please enter a city name.');
  await lookupAndRender(q);
});

settingsBtn.addEventListener('click', () => {
  openSettings();
});
closeSettings.addEventListener('click', () => hideSettings());
saveSettings.addEventListener('click', () => {
  // read selections
  const unitBtn = document.querySelector('.unit-btn.active');
  const timeBtn = document.querySelector('.time-btn.active');
  if (unitBtn) appState.unit = unitBtn.dataset.unit;
  if (timeBtn) appState.timeFormat = parseInt(timeBtn.dataset.time, 10);
  saveStateToStorage();
  hideSettings();
  // if we have data loaded, re-render with new units
  const lastCity = localStorage.getItem(LS_CITY);
  if (lastCity) lookupAndRender(lastCity);
});

function wireSettingsUI(){
  // initialize buttons
  document.querySelectorAll('.unit-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.unit-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    if (b.dataset.unit === appState.unit) b.classList.add('active');
  });
  document.querySelectorAll('.time-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.time-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    if (String(b.dataset.time) === String(appState.timeFormat)) b.classList.add('active');
  });
}

function openSettings(){ settingsOverlay.classList.remove('hidden'); }
function hideSettings(){ settingsOverlay.classList.add('hidden'); }

function showStatus(msg, isError = false){
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#ffb4b4' : '';
}

async function lookupAndRender(query){
  showStatus('Searching…');
  hideAll();
  try{
    const geo = await geocode(query);
    if (!geo) { showStatus('City not found', true); return; }

    showStatus(`Found: ${geo.name}, ${geo.country}`);
    // save last search
    localStorage.setItem(LS_CITY, query);

    const forecast = await fetchForecast(geo.latitude, geo.longitude);
    if (!forecast) { showStatus('Forecast unavailable', true); return; }

    renderCurrent(geo, forecast);
    renderForecastCards(forecast);
    renderHourlyChart(forecast, geo);
    showStatus('Showing latest forecast');
  }catch(err){
    console.error(err);
    showStatus('Error fetching weather — try again', true);
  }
}

function hideAll(){
  currentCard.classList.add('hidden');
  forecastEl.classList.add('hidden');
  chartCard.classList.add('hidden');
}

async function geocode(q){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocode failed');
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  const first = data.results[0];
  return {
    name: first.name,
    country: first.country,
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'UTC'
  };
}

async function fetchForecast(lat, lon){
  const params = [
    'hourly=temperature_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,relativehumidity_2m',
    'daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
    'timezone=auto'
  ].join('&');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Forecast fetch failed');
  return res.json();
}

function renderCurrent(geo, data){
  // approximate "current" with the first hourly item
  const t = data.hourly.temperature_2m[0];
  const wind = data.hourly.windspeed_10m[0];
  const precip = data.hourly.precipitation[0] ?? 0;
  const hum = data.hourly.relativehumidity_2m ? data.hourly.relativehumidity_2m[0] : '-';
  const code = data.hourly.weathercode[0];

  currentCity.textContent = `${geo.name}, ${geo.country}`;
  currentTemp.textContent = `${formatTemp(t)}`;
  currentDesc.textContent = getWeatherLabel(code);
  setIconForCode(currentIcon, code);
  currentWind.textContent = `${Math.round(wind ?? 0)} m/s`;
  currentPrecip.textContent = `${precip ?? 0} mm`;
  currentHum.textContent = `${hum ?? '—'}%`;

  currentCard.classList.remove('hidden');
}

function renderForecastCards(data){
  forecastEl.innerHTML = '';
  const days = data.daily.time || [];
  for (let i=0;i<days.length && i<3;i++){
    const date = days[i];
    const tmax = data.daily.temperature_2m_max[i];
    const tmin = data.daily.temperature_2m_min[i];
    const precip = data.daily.precipitation_sum ? data.daily.precipitation_sum[i] : 0;
    const wcode = data.daily.weathercode ? data.daily.weathercode[i] : 0;

    const d = new Date(date);
    const dayName = d.toLocaleDateString(undefined, {weekday:'short'});

    const node = document.createElement('div');
    node.className = 'fcard';
    node.innerHTML = `
      <div class="day">${dayName}</div>
      <div class="icon small">${getWeatherSVG(wcode)}</div>
      <div class="t">${formatTemp(tmax)} / ${formatTemp(tmin)}</div>
      <div class="muted small">Precip: ${precip ?? 0} mm</div>
    `;
    forecastEl.appendChild(node);
  }
  forecastEl.classList.remove('hidden');
}

function renderHourlyChart(data, geo){
  // prepare data points (limit to next 48)
  const times = data.hourly.time || [];
  const temps = data.hourly.temperature_2m || [];
  const winds = data.hourly.windspeed_10m || [];

  const maxPoints = Math.min(times.length, 48);
  const sliceTimes = times.slice(0, maxPoints);
  const sliceTemps = temps.slice(0, maxPoints);
  const sliceWinds = winds.slice(0, maxPoints);

  // labels depending on time format
  const labels = sliceTimes.map(t => {
    const dt = new Date(t);
    if (appState.timeFormat === 12) {
      return dt.toLocaleString(undefined, {hour: 'numeric', hour12: true});
    } else {
      return dt.toLocaleString(undefined, {hour: 'numeric', hour12: false});
    }
  });

  // Chart.js: destroy old chart to avoid double-initialization
  if (myChart) {
    try { myChart.destroy(); } catch(e){ console.warn('destroy chart error', e); }
    myChart = null;
  }

  // create a single gradient for dataset fill (create once)
  const ctx = hourlyCanvas.getContext('2d');
  // Ensure canvas has computed width/height (CSS enforces height)
  const w = hourlyCanvas.clientWidth;
  const h = hourlyCanvas.clientHeight;
  // adjust canvas pixel ratio for crispness
  const dpr = window.devicePixelRatio || 1;
  hourlyCanvas.width = Math.floor(w * dpr);
  hourlyCanvas.height = Math.floor(h * dpr);
  ctx.scale(dpr, dpr);

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(124,196,255,0.20)');
  gradient.addColorStop(1, 'rgba(124,196,255,0.02)');

  // create chart with stable options (short deterministic animation)
  myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Temperature',
          data: sliceTemps.map(t => roundOne(convertTemp(t))),
          tension: 0.25,
          yAxisID: 'y',
          pointRadius: 2,
          borderWidth: 2,
          borderColor: 'rgba(124,196,255,1)',
          backgroundColor: gradient,
          fill: true,
        },
        {
          label: 'Wind (m/s)',
          data: sliceWinds.map(w => roundOne(w)),
          tension: 0.25,
          yAxisID: 'y1',
          pointRadius: 0,
          borderDash: [4,4],
          borderWidth: 1.5,
          borderColor: 'rgba(190,190,190,0.9)',
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 350, // short and finite -> prevents continuous animation loops
        easing: 'easeOutCubic'
      },
      interaction: {mode: 'index', intersect: false},
      plugins: {
        legend: { position: 'top', labels:{boxWidth:12} },
        tooltip: {
          enabled: true,
          callbacks: {
            label: ctx => {
              const label = ctx.dataset.label || '';
              if (label.includes('Temperature')) return `${label}: ${ctx.formattedValue} ${appState.unit === 'C' ? '°C' : '°F'}`;
              return `${label}: ${ctx.formattedValue}`;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display:true, text: `°${appState.unit}` }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display:true, text:'m/s' },
          ticks: { maxTicksLimit: 5 }
        }
      },
      layout: { padding: { top: 6, left: 6, right: 6, bottom: 6 } }
    }
  });

  // Chart range text
  const start = new Date(sliceTimes[0]);
  const end = new Date(sliceTimes[sliceTimes.length - 1]);
  chartRange.textContent = `${start.toLocaleString(undefined, {hour: 'numeric'})} — ${end.toLocaleString(undefined, {hour: 'numeric'})}`;

  chartCard.classList.remove('hidden');
}

function formatTemp(v){
  if (v === null || v === undefined) return '—';
  const n = convertTemp(v);
  return `${Math.round(n)}°${appState.unit}`;
}
function convertTemp(celsius){
  if (appState.unit === 'C') return celsius;
  return celsius * 9/5 + 32;
}
function roundOne(n){ return Math.round(n*10)/10; }

function getWeatherLabel(code){
  const map = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    80: 'Rain showers',
    95: 'Thunderstorm'
  };
  return map[code] || 'Weather';
}
function getWeatherSVG(code){
  if (code === 0) return `<svg class="icon-use"><use href="#sun"></use></svg>`;
  if (code === 1 || code === 2) return `<svg class="icon-use"><use href="#sun"></use></svg>`;
  if (code === 3) return `<svg class="icon-use"><use href="#cloud"></use></svg>`;
  if (code >= 45 && code <= 48) return `<svg class="icon-use"><use href="#fog"></use></svg>`;
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return `<svg class="icon-use"><use href="#rain"></use></svg>`;
  if (code >= 95) return `<svg class="icon-use"><use href="#storm"></use></svg>`;
  return `<svg class="icon-use"><use href="#sun"></use></svg>`;
}
function setIconForCode(el, code){
  el.innerHTML = getWeatherSVG(code);
  // ensure svg gets accent fill
  const svg = el.querySelector('svg');
  if (svg) svg.classList.add('icon-use');
}

// storage helpers
function saveStateToStorage(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(appState)); } catch(e){ console.warn('ls save failed', e); }
}
function loadStateFromStorage(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.unit) appState.unit = s.unit;
      if (s.timeFormat) appState.timeFormat = s.timeFormat;
    }
  }catch(e){ /* ignore */ }
}

function loadStateFromStorage(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.unit) appState.unit = s.unit;
      if (s.timeFormat) appState.timeFormat = s.timeFormat;
    }
  }catch(e){}
}

// on load, restore last city and state
window.addEventListener('load', () => {
  // apply saved state to UI
  document.querySelectorAll('.unit-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.unit === appState.unit);
  });
  document.querySelectorAll('.time-btn').forEach(b => {
    b.classList.toggle('active', String(b.dataset.time) === String(appState.timeFormat));
  });

  const lastCity = localStorage.getItem(LS_CITY);
  if (lastCity) {
    cityInput.value = lastCity;
    // fetch automatically
    lookupAndRender(lastCity).catch(()=>{});
  }
});
