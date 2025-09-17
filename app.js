// ----------------------------
// SkyAgent - script.js
// ----------------------------

// DOM elements
const cityInput = document.getElementById("cityInput");
const searchButton = document.getElementById("searchButton");
const currentTempEl = document.getElementById("currentTemp");
const currentPressureEl = document.getElementById("currentPressure");
const currentHumidityEl = document.getElementById("currentHumidity");
const currentWindEl = document.getElementById("currentWind");
const forecastChartEl = document.getElementById("forecastChart");
const mapContainerEl = document.getElementById("mapContainer");

// Initialize charts
let forecastChart;
function initForecastChart() {
  const ctx = forecastChartEl.getContext("2d");
  forecastChart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' }, title: { display: true, text: 'Hourly Forecast' } },
      scales: { y: { beginAtZero: false } }
    }
  });
}

// Initialize map (Leaflet)
let map;
function initMap() {
  map = L.map(mapContainerEl).setView([33.9, 35.5], 8); // default: Lebanon
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'Map data © OpenStreetMap contributors' }).addTo(map);

  // Layer placeholders
  window.pressureLayer = L.tileLayer('', { opacity: 0.5 });
  window.tempLayer = L.tileLayer('', { opacity: 0.5 });
}

// Update map layers
function updateMapLayers(tileURLs) {
  if(tileURLs.pressure) {
    pressureLayer.setUrl(tileURLs.pressure).addTo(map);
  }
  if(tileURLs.temperature) {
    tempLayer.setUrl(tileURLs.temperature).addTo(map);
  }
}

// Event listener
searchButton.addEventListener("click", () => {
  const city = cityInput.value.trim();
  if(city) fetchWeather(city);
});

// Fetch weather from Vercel API
async function fetchWeather(city) {
  try {
    const res = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
    const data = await res.json();

    if(!data || !data.current) {
      alert("No data for this city");
      return;
    }

    // Update current weather
    currentTempEl.textContent = `${data.current.temperature} °C`;
    currentPressureEl.textContent = `${data.current.pressure} hPa`;
    currentHumidityEl.textContent = `${data.current.humidity} %`;
    currentWindEl.textContent = `${data.current.wind_speed} m/s`;

    // Update forecast chart
    updateForecastChart(data.forecast);

    // Update map overlays
    updateMapLayers(data.tiles);

  } catch(err) {
    console.error(err);
    alert("Error fetching weather data");
  }
}

// Update forecast chart
function updateForecastChart(forecast) {
  if(!forecastChart) initForecastChart();

  const labels = forecast.map(h => h.time);
  const tempData = forecast.map(h => h.temperature);
  const pressureData = forecast.map(h => h.pressure);

  forecastChart.data.labels = labels;
  forecastChart.data.datasets = [
    { label: "Temperature (°C)", data: tempData, borderColor: "red", fill: false },
    { label: "Pressure (hPa)", data: pressureData, borderColor: "blue", fill: false }
  ];
  forecastChart.update();
}

// Initialize app
initForecastChart();
initMap();
