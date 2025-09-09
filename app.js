document.getElementById('search-button').addEventListener('click', async function() {
    const city = document.getElementById('city-input').value.trim();
    const resultDiv = document.getElementById('weather-result');
    if (!city) {
        resultDiv.textContent = 'Please enter a city name.';
        return;
    }

    resultDiv.textContent = 'Finding city...';

    // 1. Get city coordinates using Open-Meteo Geocoding API
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
    try {
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();
        if (!geoData.results || geoData.results.length === 0) {
            resultDiv.textContent = 'City not found.';
            return;
        }
        const { latitude, longitude, name, country } = geoData.results[0];

        // 2. Fetch weather forecast for next 3 days
        const today = new Date();
        const startDate = today.toISOString().split('T')[0];
        const endDate = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto&start_date=${startDate}&end_date=${endDate}`;

        resultDiv.textContent = 'Loading weather...';

        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();

        if (weatherData.daily && weatherData.daily.time) {
            let html = `<h2>3-Day Forecast for ${name}, ${country}</h2><table><tr><th>Date</th><th>Max Temp (°C)</th><th>Min Temp (°C)</th><th>Precipitation (mm)</th><th>Weather</th></tr>`;
            const codes = {
                0: "Clear",
                1: "Mainly Clear",
                2: "Partly Cloudy",
                3: "Overcast",
                45: "Fog",
                48: "Depositing Rime Fog",
                51: "Light Drizzle",
                53: "Moderate Drizzle",
                55: "Dense Drizzle",
                61: "Slight Rain",
                63: "Moderate Rain",
                65: "Heavy Rain",
                80: "Rain Showers",
                95: "Thunderstorm"
            };
            for (let i = 0; i < weatherData.daily.time.length; i++) {
                html += `<tr>
                    <td>${weatherData.daily.time[i]}</td>
                    <td>${weatherData.daily.temperature_2m_max[i]}</td>
                    <td>${weatherData.daily.temperature_2m_min[i]}</td>
                    <td>${weatherData.daily.precipitation_sum[i]}</td>
                    <td>${codes[weatherData.daily.weathercode[i]] || weatherData.daily.weathercode[i]}</td>
                </tr>`;
            }
            html += "</table>";
            resultDiv.innerHTML = html;
        } else {
            resultDiv.textContent = 'Weather data not available.';
        }
    } catch (error) {
        resultDiv.textContent = 'Error loading weather data.';
    }
});