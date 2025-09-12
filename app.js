// app.js — mobile-friendly UI + Chart.js integration
// Uses Open-Meteo geocoding + forecast API (no API key)

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

let myChart = null;

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = cityInput.value.trim();
  if (!q) return showStatus('Please enter a city name.');
  await lookupAndRender(q);
});

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
    // Fetch forecast
    const forecast = await fetchForecast(geo.latitude, geo.longitude);
    if (!forecast) { showStatus('Forecast unavailable', true); return; }

    renderCurrent(geo, forecast);
    renderForecastCards(forecast);
    renderHourlyChart(forecast);
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
  // pick first reasonable result (prefer population)
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
  // Request hourly + daily data. You can tweak parameters to include more variables.
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
  // Use the first hourly point as "current" approximation
  const tz = data.timezone || 'UTC';
  const nowIdx = 0;
  const t = data.hourly.temperature_2m[nowIdx];
  const wind = data.hourly.windspeed_10m[nowIdx];
  const precip = data.hourly.precipitation[nowIdx] ?? 0;
  const hum = data.hourly.relativehumidity_2m ? data.hourly.relativehumidity_2m[nowIdx] : '-';
  const code = data.hourly.weathercode[nowIdx];

  currentCity.textContent = `${geo.name}, ${geo.country}`;
  currentTemp.textContent = `${Math.round(t)}°C`;
  currentDesc.textContent = getWeatherLabel(code);
  currentIcon.textContent = getWeatherIcon(code);
  currentWind.textContent = `${wind ?? '—'} m/s`;
  currentPrecip.textContent = `${precip ?? '—'} mm`;
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
      <div class="icon">${getWeatherIcon(wcode)}</div>
      <div class="t">${Math.round(tmax)}° / ${Math.round(tmin)}°</div>
      <div class="muted small">Precip: ${precip ?? 0} mm</div>
    `;
    forecastEl.appendChild(node);
  }
  forecastEl.classList.remove('hidden');
}

function renderHourlyChart(data){
  // Prepare hourly temperature for next 48 hours
  const times = data.hourly.time || [];
  const temps = data.hourly.temperature_2m || [];
  const winds = data.hourly.windspeed_10m || [];

  // limit to next 48 points for readability
  const maxPoints = Math.min(times.length, 48);
  const labels = times.slice(0, maxPoints).map(t => {
    const dt = new Date(t);
    return dt.toLocaleString(undefined, {hour:'numeric', hour12:false});
  });
  const tdata = temps.slice(0, maxPoints);
  const wdata = winds.slice(0, maxPoints);

  // destroy old chart
  if (myChart) myChart.destroy();

  myChart = new Chart(hourlyCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Temperature (°C)',
          data: tdata,
          tension: 0.3,
          yAxisID: 'y',
          pointRadius: 2,
          borderWidth: 2,
          fill: true,
          backgroundColor: (ctx) => {
            // subtle gradient fill
            const g = ctx.chart.ctx.createLinearGradient(0,0,0,200);
            g.addColorStop(0, 'rgba(124,196,255,0.18)');
            g.addColorStop(1, 'rgba(124,196,255,0.02)');
            return g;
          }
        },
        {
          label: 'Wind (m/s)',
          data: wdata,
          tension: 0.3,
          yAxisID: 'y1',
          pointRadius: 0,
          borderDash: [4,4],
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode: 'index', intersect: false},
      plugins: {
        legend: { position: 'top', labels:{boxWidth:12} },
        tooltip: { enabled: true }
      },
      scales: {
        x: { display:true },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display:true, text:'°C' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display:true, text:'m/s' }
        }
      }
    }
  });

  chartCard.classList.remove('hidden');
}

// small helper: map Open-Meteo weather codes to simple labels/icons
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

function getWeatherIcon(code){
  // Emoji-based icons for simplicity — swap with SVGs if you prefer
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return '🌧️';
  if (code >= 95) return '⛈️';
  return '🌤️';
}

// On load, try a default city
window.addEventListener('load', () => {
  // If you want an initial city, set it here:
  // cityInput.value = 'Beirut';
  // lookupAndRender('Beirut');
});
