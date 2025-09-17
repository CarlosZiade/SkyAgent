// api/weather.js
export default async function handler(req, res) {
  try {
    const { q, lat, lon } = req.query;

    const USER = process.env.METEOMATICS_USER;
    const PASS = process.env.METEOMATICS_PASS;
    if (!USER || !PASS) {
      return res.status(500).json({ error: "Meteomatics credentials not set" });
    }

    const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

    // --- Geocode if q is provided ---
    let place = null;
    let latitude = lat;
    let longitude = lon;

    if (q && (!lat || !lon)) {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        q
      )}&count=1&language=en&format=json`;

      const g = await fetch(geoUrl);
      if (!g.ok) return res.status(502).json({ error: "Geocoding failed" });
      const gj = await g.json();
      if (!gj.results || gj.results.length === 0)
        return res.status(404).json({ error: "City not found" });

      const first = gj.results[0];
      place = {
        name: first.name,
        country: first.country,
        lat: first.latitude,
        lon: first.longitude,
      };
      latitude = first.latitude;
      longitude = first.longitude;
    } else if (lat && lon) {
      latitude = lat;
      longitude = lon;
      place = { name: `${lat},${lon}`, country: "" };
    } else {
      return res.status(400).json({ error: "Provide q=city or lat & lon" });
    }

    // Build Meteomatics request (hourly data for next 48h)
    const now = new Date();
    const startISO = now.toISOString().split(".")[0] + "Z";
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const endISO = end.toISOString().split(".")[0] + "Z";

    const params = [
      "t_2m:C",
      "apparent_t:C",
      "msl_pressure:hPa",
      "precip_1h:mm",
      "wind_speed_10m:ms",
      "relative_humidity_2m:pct",
      "weather_symbol_1h:idx",
    ].join(",");

    const url = `https://api.meteomatics.com/${startISO}--${endISO}:PT1H/${params}/${latitude},${longitude}/json`;

    const r = await fetch(url, { headers: { Authorization: auth } });
    if (!r.ok) {
      const txt = await r.text().catch(() => null);
      return res
        .status(502)
        .json({ error: "Meteomatics request failed", status: r.status, body: txt });
    }
    const mj = await r.json();

    // Transform response
    const paramMap = {};
    for (const p of mj.data) {
      paramMap[p.parameter] = p.coordinates?.[0]?.dates || [];
    }

    const timeSeries = paramMap["t_2m:C"].map((d) => d.date);
    const hourly = {
      time: timeSeries,
      temperature_2m: paramMap["t_2m:C"].map((d) => d.value),
      apparent_temperature: paramMap["apparent_t:C"].map((d) => d.value),
      pressure_msl: paramMap["msl_pressure:hPa"].map((d) => d.value),
      precipitation: paramMap["precip_1h:mm"].map((d) => d.value),
      windspeed_10m: paramMap["wind_speed_10m:ms"].map((d) => d.value),
      relativehumidity_2m: paramMap["relative_humidity_2m:pct"].map(
        (d) => d.value
      ),
      weathercode: paramMap["weather_symbol_1h:idx"].map((d) => d.value),
    };

    const currentIndex = findClosestIndexInIsoArray(timeSeries, new Date());
    const current = {
      temperature: hourly.temperature_2m[currentIndex],
      apparent_temperature: hourly.apparent_temperature[currentIndex],
      pressure: hourly.pressure_msl[currentIndex],
      precip: hourly.precipitation[currentIndex],
      windspeed: hourly.windspeed_10m[currentIndex],
      humidity: hourly.relativehumidity_2m[currentIndex],
      weather_code: hourly.weathercode[currentIndex],
      time: hourly.time[currentIndex],
    };

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      place,
      current,
      hourly,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function findClosestIndexInIsoArray(arr, targetDate) {
  const t = targetDate.getTime();
  let best = 0,
    bestDiff = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const tv = Date.parse(arr[i]);
    if (isNaN(tv)) continue;
    const diff = Math.abs(tv - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

