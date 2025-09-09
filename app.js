const weatherIcons = {
  0: "icons/sunny.svg",       // Clear
  1: "icons/sunny.svg",       // Mainly clear
  2: "icons/partly_cloudy.svg",
  3: "icons/cloudy.svg",
  45: "icons/fog.svg",
  48: "icons/fog.svg",
  51: "icons/drizzle.svg",
  53: "icons/drizzle.svg",
  55: "icons/drizzle.svg",
  61: "icons/rain.svg",
  63: "icons/rain.svg",
  65: "icons/rain.svg",
  71: "icons/snow.svg",
  73: "icons/snow.svg",
  75: "icons/snow.svg",
  80: "icons/showers.svg",
  81: "icons/showers.svg",
  82: "icons/showers.svg",
  95: "icons/thunder.svg"
};

function getIcon(code) {
  return weatherIcons[code] || "icons/unknown.svg";
}

document.getElementById('searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const city = document.getElementById('cityInput').value.trim();
  if (!city) return;
  showLoading();

  // Geo lookup
  const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
  const geoData = await geoRes.json();
  if (!geoData.results || !geoData.results.length) {
    showError("City not found");
    return;
  }
  const loc = geoData.results[0];
  document.getElementById('cityInfo').innerHTML = `${loc.name}, ${loc.country} <br>Lat: ${loc.latitude}, Lon: ${loc.longitude}`;

  // Weather fetch
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=${loc.timezone}`;
  const weatherRes = await fetch(weatherUrl);
  const weatherData = await weatherRes.json();
  if (!weatherData.daily) {
    showError("Weather data unavailable");
    return;
  }
  renderWeather(weatherData.daily, weatherData.daily.time, loc);
});

function showLoading() {
  document.getElementById('cityInfo').textContent = "Loading...";
  document.getElementById('weatherSummary').innerHTML = "";
  document.getElementById('forecastCards').innerHTML = "";
  document.getElementById('forecastChart').getContext('2d').clearRect(0, 0, 700, 400);
}

function showError(msg) {
  document.getElementById('cityInfo').textContent = msg;
  document.getElementById('weatherSummary').innerHTML = "";
  document.getElementById('forecastCards').innerHTML = "";
}

function renderWeather(daily, days, loc) {
  // Summary for today
  const today = 0;
  const code = daily.weathercode[today];
  const iconSrc = getIcon(code);
  document.getElementById('weatherSummary').innerHTML = `
    <img src="${iconSrc}" alt="Weather" class="weather-icon">
    <div style="font-size:2rem;font-weight:bold">${daily.temperature_2m_max[today]}°C</div>
    <div>${describeWeather(code)}</div>
    <div>Precipitation: ${daily.precipitation_sum[today]} mm</div>
    <div>${days[today]}</div>
  `;
  // Chart
  drawForecastChart(days, daily.temperature_2m_max, daily.temperature_2m_min, daily.precipitation_sum);

  // Forecast cards
  let cards = '';
  for (let i = 0; i < days.length; i++) {
    cards += `
      <div class="forecast-card">
        <div>${days[i]}</div>
        <img src="${getIcon(daily.weathercode[i])}" class="weather-icon" alt="">
        <div>${describeWeather(daily.weathercode[i])}</div>
        <div>Max: ${daily.temperature_2m_max[i]}°C</div>
        <div>Min: ${daily.temperature_2m_min[i]}°C</div>
        <div>Precip: ${daily.precipitation_sum[i]} mm</div>
      </div>
    `;
  }
  document.getElementById('forecastCards').innerHTML = cards;
}

function describeWeather(code) {
  const desc = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
    95: "Thunderstorm"
  };
  return desc[code] || "Unknown";
}

function drawForecastChart(days, maxTemps, minTemps, precips) {
  const ctx = document.getElementById('forecastChart').getContext('2d');
  if (window.forecastChart) window.forecastChart.destroy();
  window.forecastChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [
        {
          label: 'Max Temp (°C)',
          type: 'line',
          data: maxTemps,
          borderColor: '#0099ff',
          backgroundColor: 'rgba(0,153,255,0.2)',
          yAxisID: 'y',
        },
        {
          label: 'Min Temp (°C)',
          type: 'line',
          data: minTemps,
          borderColor: '#8fceff',
          backgroundColor: 'rgba(143,206,255,0.2)',
          yAxisID: 'y',
        },
        {
          label: 'Precipitation (mm)',
          type: 'bar',
          data: precips,
          backgroundColor: '#c1e7ff',
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: { title: { display: true, text: 'Temperature (°C)' }, beginAtZero: true },
        y1: { title: { display: true, text: 'Precipitation (mm)' }, beginAtZero: true, position: 'right' }
      }
    }
  });
}