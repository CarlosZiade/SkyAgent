// /api/weather.js - Vercel serverless function
export default async function handler(req, res) {
  const { city } = req.query;

  if (!city) {
    return res.status(400).json({ error: "City parameter is required" });
  }

  const username = process.env.METEOMATICS_USERNAME;
  const password = process.env.METEOMATICS_PASSWORD;

  if (!username || !password) {
    return res.status(500).json({ error: "Meteomatics credentials not set" });
  }

  try {
    // Step 1: Geocode city using Meteomatics or Open-Meteo geocoding
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    const geoData = await geoRes.json();
    if (!geoData.results || geoData.results.length === 0) {
      return res.status(404).json({ error: "City not found" });
    }

    const { latitude, longitude, name, country } = geoData.results[0];

    // Step 2: Fetch Meteomatics weather
    const now = new Date().toISOString().split(".")[0] + "Z";
    const end = new Date(Date.now() + 24 * 3600 * 1000).toISOString().split(".")[0] + "Z";

    const parameters = "t_2m:C,wind_speed_10m:ms,msl_pressure:hPa,precip_1h:mm";
    const url = `https://api.meteomatics.com/${now}--${end}:PT1H/${parameters}/${latitude},${longitude}/json`;

    const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
    const weatherRes = await fetch(url, { headers: { Authorization: authHeader } });

    if (!weatherRes.ok) throw new Error("Meteomatics API request failed");
    const weatherData = await weatherRes.json();

    // Transform response into frontend-friendly format
    const hourly = weatherData.data[0].coordinates[0].dates.map((_, i) => ({
      time: weatherData.data[0].coordinates[0].dates[i].date,
      temp: weatherData.data[0].coordinates[0].dates[i].value,
      wind: weatherData.data[1].coordinates[0].dates[i].value,
      pressure: weatherData.data[2].coordinates[0].dates[i].value,
      precip: weatherData.data[3].coordinates[0].dates[i].value
    }));

    res.status(200).json({
      location: { name, country },
      current: {
        temp: hourly[0].temp,
        pressure: hourly[0].pressure,
        condition: "N/A" // You can extend with a weather code mapping
      },
      forecast: {
        hourly,
        daily: [] // You can add daily aggregation if needed
      }
    });

  } catch (error) {
    console.error("Weather API error:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
}
