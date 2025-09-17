// ----------------------------
// SkyAgent - Full Working App.js
// ----------------------------

// ----------------------------
// DOM Elements
// ----------------------------
const cityInput = document.getElementById("cityInput");
const searchButton = document.getElementById("searchButton");

const tempEl = document.getElementById("currentTemp");
const pressureEl = document.getElementById("currentPressure");
const humidityEl = document.getElementById("currentHumidity");
const windEl = document.getElementById("currentWind");

const forecastChartEl = document.getElementById("forecastChart");
const pressureChartEl = document.getElementById("pressureChart");

const mapContainerEl = document.getElementById("mapContainer");

// ----------------------------
// Initialize Charts
// ----------------------------
let forecastChart;
let pressureChart;

function initCharts() {
  const ctxForecast = forecastChartEl.getContext("2d");
  forecastChart = new Chart(ctxForecast, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' }, title: { display: true, text: 'Temperature Forecast' } },
      scales: { y: { beginAtZero: false } }
    }
  });

  const ctxPressure = pressureChartEl.getContext("2d");
  pressureChart = new Chart(ctxPressure, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' }, title: { display: true, text: 'Pressure Forecast' } },
      scales: { y: { beginAtZero: false } }
    }
  });
}

// ----------------------------
// Initialize Map (Leaflet)
// ----------------------------
let map;
let pressureLayer;
let tempLayer;

function initMap() {
  map = L.map(mapContainerEl).setView([33.9, 35.5], 8); // Lebanon default

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data © OpenStreetMap contributors'
  }).addTo(map);

  pressureLayer = L.tileLayer('', { opacity: 0.5 }).addTo(map);
  tempLayer = L.tileLayer('', { opacity: 0.5 }).addTo(map);
}

function updateMapLayers(tileURLs) {
  if (tileURLs.pressure) pressureLayer.setUrl(tileURLs.pressure);
  if (tileURLs.temperature) tempLayer.setUrl(tileURLs.temperature);
}

// ----------------------------
// Fetch Weather from API (Vercel)
// ----------------------------
async function fetchWeather(city) {
  if (!city) return;

  try {
    const res = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
    const data = await res.json();

    if (!data || !data.current) {
      alert("No weather data for this city");
      return;
    }

    // Update current weather
    tempEl.textContent = `${data.current.temperature} °C`;
    pressureEl.textContent = `${data.current.pressure} hPa`;
    humidityEl.textContent = `${data.current.humidity} %`;
    windEl.textContent = `${data.current.wind_speed} m/s`;

    // Update charts
    const labels = data.forecast.map(h => h.time);
    const tempData = data.forecast.map(h => h.temperature);
    const pressureData = data.forecast.map(h => h.pressure);

    forecastChart.data.labels = labels;
    forecastChart.data.datasets = [
      { label: "Temperature (°C)", data: tempData, borderColor: "red", fill: false }
    ];
    forecastChart.update();

    pressureChart.data.labels = labels;
    pressureChart.data.datasets = [
      { label: "Pressure (hPa)", data: pressureData, borderColor: "blue", fill: false }
    ];
    pressureChart.update();

    // Update map overlays
    updateMapLayers(data.tiles);

  } catch (err) {
    console.error(err);
    alert("Error fetching weather data");
  }
}

// ----------------------------
// Event Listeners
// ----------------------------
searchButton.addEventListener("click", () => {
  const city = cityInput.value.trim();
  fetchWeather(city);
});

cityInput.addEventListener("keypress", e => {
  if (e.key === "Enter") fetchWeather(cityInput.value.trim());
});

// ----------------------------
// Initialize App
// ----------------------------
initCharts();
initMap();
