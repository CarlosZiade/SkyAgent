// app.js — SkyAgent frontend (vanilla JS)
// Fetches weather data from /api/weather and renders charts + UI
// Works with Vercel serverless API (Meteomatics backend)

const DOM = {
  searchForm: document.getElementById("searchForm"),
  cityInput: document.getElementById("cityInput"),
  status: document.getElementById("status"),
  currentCard: document.getElementById("current"),
  currentCity: document.getElementById("currentCity"),
  currentTemp: document.getElementById("currentTemp"),
  currentDesc: document.getElementById("currentDesc"),
  currentIcon: document.getElementById("currentIcon"),
  currentWind: document.getElementById("currentWind"),
  currentPrecip: document.getElementById("currentPrecip"),
  currentHum: document.getElementById("currentHum"),
  currentPressure: document.getElementById("currentPressure"),
  forecast: document.getElementById("forecast"),
  chartCard: document.getElementById("chartCard"),
  hourlyCanvas: document.getElementById("hourlyChart"),
  chartRange: document.getElementById("chartRange"),
  pressureCard: document.getElementById("pressureCard"),
  pressureCanvas: document.getElementById("pressureChart"),
};

const LS_LASTCITY = "skyagent_lastcity_v4";
let chartInstance = null;
let pressureChart = null;
let appState = { unit: "C", timeFormat: 24 };

// Initialize app
init();

function init() {
  wireUI();
  const last = localStorage.getItem(LS_LASTCITY);
  if (last) {
    DOM.cityInput.value = last;
    lookupAndRender(last);
  } else {
    lookupAndRender("Zahle");
  }
}

function wireUI() {
  DOM.searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = DOM.cityInput.value.trim();
    if (!q) return showStatus("Please enter a city name.");
    await lookupAndRender(q);
  });
}

async function lookupAndRender(query) {
  try {
    showStatus("Fetching data…");
    hideAll();
    const r = await fetch(`/api/weather?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error("API request failed");
    const data = await r.json();
    localStorage.setItem(LS_LASTCITY, query);

    renderCurrent(data.place, data.current);
    renderForecast(data.daily);
    renderHourlyChart(data.hourly);
    renderPressureChart(data.hourly);

    showStatus("Weather updated.");
  } catch (err) {
    console.error(err);
    showStatus("Unable to fetch weather data.", true);
  }
}

function renderCurrent(place, current) {
  DOM.currentCity.textContent = `${place.name}, ${place.country}`;
  DOM.currentTemp.textContent = `${Math.round(convertTemp(current.temperature))}°${appState.unit}`;
  DOM.currentDesc.textContent = current.weather_label || "—";
  setIcon(DOM.currentIcon, current.weather_code);
  DOM.currentWind.textContent = `${Math.round(current.windspeed)} m/s`;
  DOM.currentPrecip.textContent = `${current.precip ?? "—"} mm`;
  DOM.currentHum.textContent = `${current.humidity ?? "—"}%`;
  DOM.currentPressure.textContent = `${Math.round(current.pressure)} hPa`;
  DOM.currentCard.classList.remove("hidden");
}

function renderForecast(daily) {
  DOM.forecast.innerHTML = "";
  if (!daily || !daily.time) return;
  for (let i = 0; i < Math.min(daily.time.length, 3); i++) {
    const date = new Date(daily.time[i]);
    const dayName = date.toLocaleDateString(undefined, { weekday: "short" });
    const tmax = daily.temperature_2m_max[i];
    const tmin = daily.temperature_2m_min[i];
    const code = daily.weathercode ? daily.weathercode[i] : 0;

    const card = document.createElement("div");
    card.className = "fcard";
    card.innerHTML = `
      <div class="day">${dayName}</div>
      <div class="icon small">${svgForCode(code)}</div>
      <div class="t">${Math.round(convertTemp(tmax))}° / ${Math.round(convertTemp(tmin))}°</div>
    `;
    DOM.forecast.appendChild(card);
  }
  DOM.forecast.classList.remove("hidden");
}

function renderHourlyChart(hourly) {
  if (!hourly.time || !hourly.temperature_2m) return;

  const times = hourly.time.slice(0, 48);
  const temps = hourly.temperature_2m.slice(0, 48);
  const winds = hourly.windspeed_10m.slice(0, 48);

  const labels = times.map((t) => new Date(t).toLocaleTimeString([], { hour: "2-digit" }));
  if (chartInstance) chartInstance.destroy();

  const ctx = DOM.hourlyCanvas.getContext("2d");
  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Temperature (°${appState.unit})`,
          data: temps.map(convertTemp),
          borderColor: "rgba(124,196,255,1)",
          backgroundColor: "rgba(124,196,255,0.2)",
          tension: 0.3,
          fill: true,
          pointRadius: 2,
        },
        {
          label: "Wind (m/s)",
          data: winds,
          borderColor: "rgba(200,200,200,0.9)",
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
  DOM.chartCard.classList.remove("hidden");
}

function renderPressureChart(hourly) {
  if (!hourly.time || !hourly.pressure_msl) return;
  const times = hourly.time.slice(0, 48);
  const pressures = hourly.pressure_msl.slice(0, 48);
  if (pressureChart) pressureChart.destroy();

  const ctx = DOM.pressureCanvas.getContext("2d");
  pressureChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: times.map((t) => new Date(t).toLocaleTimeString([], { hour: "2-digit" })),
      datasets: [
        {
          label: "Pressure (hPa)",
          data: pressures,
          borderColor: "rgba(200,200,200,0.9)",
          backgroundColor: "rgba(200,200,200,0.05)",
          tension: 0.3,
          fill: true,
          pointRadius: 1,
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
  DOM.pressureCard.classList.remove("hidden");
}

function convertTemp(c) {
  return appState.unit === "C" ? c : (c * 9) / 5 + 32;
}

function svgForCode(code) {
  if (code === 0) return `<svg><use href="#icon-sun"/></svg>`;
  if (code <= 3) return `<svg><use href="#icon-cloud"/></svg>`;
  if (code >= 45 && code <= 48) return `<svg><use href="#icon-fog"/></svg>`;
  if (code >= 51) return `<svg><use href="#icon-rain"/></svg>`;
  if (code >= 95) return `<svg><use href="#icon-storm"/></svg>`;
  return `<svg><use href="#icon-sun"/></svg>`;
}

function setIcon(el, code) {
  el.innerHTML = svgForCode(code);
}

function hideAll() {
  DOM.currentCard.classList.add("hidden");
  DOM.forecast.classList.add("hidden");
  DOM.chartCard.classList.add("hidden");
  DOM.pressureCard.classList.add("hidden");
}

function showStatus(msg, isError = false) {
  DOM.status.textContent = msg;
  DOM.status.style.color = isError ? "#ffb4b4" : "";
}
