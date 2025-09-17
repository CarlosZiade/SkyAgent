import fetch from "node-fetch";

// Replace with a proper geocoding function or API
async function geocodeCity(city) {
  // Example: using OpenCage (free tier) or hardcoded coordinates
  const cityCoords = {
    "Beirut": { lat: 33.8938, lon: 35.5018 },
    "Zahle": { lat: 33.8411, lon: 35.8916 }
    // add more cities as needed
  };
  return cityCoords[city] || cityCoords["Beirut"];
}

// Transform Meteomatics API data for frontend
function transformWeatherData(raw) {
  // raw.data contains hourly arrays for each parameter
  const times = raw.data[0].coordinates[0].dates.map(d => new Date(d).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
  
  return {
    current: {
      temperature: raw.data[0].coordinates[0].dates[0].value,
      pressure: raw.data[1].coordinates[0].dates[0].value,
      humidity: raw.data[2].coordinates[0].dates[0].value,
      wind_speed: raw.data[3].coordinates[0].dates[0].value
    },
    forecast: times.map((t, i) => ({
      time: t,
      temperature: raw.data[0].coordinates[0].dates[i].value,
      pressure: raw.data[1].coordinates[0].dates[i].value
    })),
    tiles: {
      temperature: "https://tile.meteomatics.com/temperature/{z}/{x}/{y}.png", // example
      pressure: "https://tile.meteomatics.com/pressure/{z}/{x}/{y}.png"       // example
    }
  };
}

export default async function handler(req, res) {
  const city = req.query.city || "Beirut";
  const coords = await geocodeCity(city);

  const API_USER = process.env.METEOMATICS_USER;
  const API_PASS = process.env.METEOMATICS_PASS;

  const start = new Date().toISOString();
  const end = new Date(Date.now() + 24*60*60*1000).toISOString(); // next 24 hours

  // Meteomatics API URL
  const url = `https://${API_USER}:${API_PASS}@api.meteomatics.com/${start}--${end}:PT1H/t_2m,p_0m,relative_humidity_2m,wind_speed_10m/${coords.lat},${coords.lon}/json`;

  try {
    const response = await fetch(url);
    const rawData = await response.json();
    const transformed = transformWeatherData(rawData);

    res.status(200).json(transformed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
}
