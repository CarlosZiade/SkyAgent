// SkyAgent - Weather App
// Vanilla JS version with charts, forecast & map

const API_BASE = "https://api.open-meteo.com/v1/forecast";

// Elements
const searchForm = document.getElementById("searchForm");
const cityInput = document.getElementById("cityInput");
const statusEl = document.getElementById("status");

const currentEl = document.getElementById("current");
const currentCityEl = document.getElementById("currentCity");
const currentTempEl = document.getElementById("currentTemp");
const currentDescEl = document.getElementById("currentDesc");
const currentIconEl = document.getElementById("currentIcon");
const currentWindEl = document.getElementById("currentWind");
const currentPrecipEl = document.getElementById("currentPrecip");
const currentHumEl = document.getElementById("currentHum");
const currentPressureEl = document.getElementById("currentPressure");

const forecastEl = document.getElementById("forecast");
const chartCardEl = document.getElementById("chartCard");
const chartRangeEl = document.getElementById("chartRange");
const pressureCardEl = document.getElementById("pressureCard");

let hourlyChart, pressureChart;
let map;

// Entry
document.addEventListener("DOMContentLoaded", () => {
  initMap();

  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const city = cityInput.value.trim();
    if (city) {
      fetchWeatherByCity(city);
    }
  });

  // Load default
  fetchWeatherByCity("Zahle, Lebanon");
});

// ---- Weather fetching ----
async function fetchWeatherByCity(cityName) {
  statusEl.textContent = "Loading weather...";
  try {
    // 1) Get lat/lon for city
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`);
    const geo = await geoRes.json();
    if (!geo.results || !geo.results.length) throw new Error("City not found");
    const { latitude, longitude, name, country } = geo.results[0];

    // 2) Get weather forecast
    const params = new URLSearchParams({
      latitude,
      longitude,
      current_weather: "true",
      hourly: "temperature_2m,relative_humidity_2m,precipitation,pressure_msl,windspeed_10m",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
      timezone: "auto"
    });

    const res = await fetch(`${API_BASE}?${params.toString()}`);
    const data = await res.json();

    updateUI(name, country, data, latitude, longitude);
    statusEl.textContent = "Latest forecast shown";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error fetching weather data";
  }
}

// ---- UI Updates ----
function updateUI(city, country, data, lat, lon) {
  const current = data.current_weather;
  const hourly = data.hourly;
  const daily = data.daily;

  // Current
  currentCityEl.textContent = `${city}, ${country}`;
  currentTempEl.textContent = `${Math.round(current.temperature)}°C`;
  currentDescEl.textContent = getWeatherDesc(current.weathercode);
  currentWindEl.textContent = `${current.windspeed} m/s`;
  currentPrecipEl.textContent = `${hourly.precipitation[0]} mm`;
  currentHumEl.textContent = `${hourly.relative_humidity_2m[0]}%`;
  currentPressureEl.textContent = `${Math.round(hourly.pressure_msl[0])}`;
  currentIconEl.innerHTML = svgForCode(current.weathercode);
  currentEl.classList.remove("hidden");

  // Forecast
  forecastEl.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const day = new Date(daily.time[i]).toLocaleDateString(undefined, { weekday: "short" });
    const max = Math.round(daily.temperature_2m_max[i]);
    const min = Math.round(daily.temperature_2m_min[i]);
    const precip = daily.precipitation_sum[i];
    forecastEl.insertAdjacentHTML("beforeend", `
      <div class="fcard">
        <div class="day">${day}</div>
        <div class="t">${max}°C / ${min}°C</div>
        <div class="muted small">Precip: ${precip} mm</div>
      </div>
    `);
  }
  forecastEl.classList.remove("hidden");

  // Charts
  updateHourlyChart(hourly);
  updatePressureChart(hourly);

  // Map
  if (map) {
    map.setView([lat, lon], 8);
  }
}

// ---- Charts ----
function updateHourlyChart(hourly) {
  const labels = hourly.time.map(t => new Date(t).getHours());
  const temps = hourly.temperature_2m;
  const winds = hourly.windspeed_10m;

  if (hourlyChart) hourlyChart.destroy();
  const ctx = document.getElementById("hourlyChart");
  hourlyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Temperature (°C)",
          data: temps,
          borderColor: "#7cc4ff",
          tension: 0.4
        },
        {
          label: "Wind (m/s)",
          data: winds,
          borderColor: "#999",
          borderDash: [5, 5],
          yAxisID: "y2",
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: false },
        y2: { position: "right", beginAtZero: true }
      }
    }
  });
  chartCardEl.classList.remove("hidden");
}

function updatePressureChart(hourly) {
  const labels = hourly.time.map(t => new Date(t).getHours());
  const pressures = hourly.pressure_msl;

  if (pressureChart) pressureChart.destroy();
  const ctx = document.getElementById("pressureChart");
  pressureChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Pressure (hPa)",
        data: pressures,
        borderColor: "#ccc",
        tension: 0.3,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: false } }
    }
  });
  pressureCardEl.classList.remove("hidden");
}

// ---- Map ----
function initMap() {
  map = L.map("map").setView([33.9, 35.9], 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

// ---- Utilities ----
function getWeatherDesc(code) {
  const lookup = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Cloudy",
    45: "Fog", 48: "Rime fog", 51: "Light drizzle", 61: "Light rain",
    71: "Snow fall", 80: "Rain showers", 95: "Thunderstorm"
  };
  return lookup[code] || "Weather";
}

function svgForCode(code) {
  if ([0, 1].includes(code)) return `<svg><use href="#icon-sun"/></svg>`;
  if ([2, 3].includes(code)) return `<svg><use href="#icon-cloud"/></svg>`;
  if ([61, 80].includes(code)) return `<svg><use href="#icon-rain"/></svg>`;
  if ([95].includes(code)) return `<svg><use href="#icon-storm"/></svg>`;
  return `<svg><use href="#icon-fog"/></svg>`;
}
