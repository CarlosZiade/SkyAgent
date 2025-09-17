// api/weather.js
export default async function handler(req, res) {
  try {
    const { q, lat, lon } = req.query;

    const USER = process.env.METEOMATICS_USER;
    const PASS = process.env.METEOMATICS_PASS;
    if (!USER || !PASS) return res.status(500).json({ error: 'Meteomatics credentials not set' });

    const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

    // resolve lat/lon using Open-Meteo geocoding if q provided
    let place = null;
    let latitude = lat;
    let longitude = lon;
    if (q && (!lat || !lon)) {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
      const g = await fetch(geoUrl);
      if (!g.ok) return res.status(502).json({ error: 'Geocoding failed' });
      const gj = await g.json();
      if (!gj.results || gj.results.length === 0) return res.status(404).json({ error: 'City not found' });
      const first = gj.results[0];
      place = { name: first.name, country: first.country, lat: first.latitude, lon: first.longitude };
      latitude = first.latitude;
      longitude = first.longitude;
    } else if (lat && lon) {
      latitude = lat;
      longitude = lon;
      place = { name: `${lat},${lon}`, country: '' };
    } else {
      return res.status(400).json({ error: 'Provide q=city or lat & lon' });
    }

    // build Meteomatics request: now -> +48h hourly
    const now = new Date();
    const startISO = now.toISOString().split('.')[0] + 'Z';
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const endISO = end.toISOString().split('.')[0] + 'Z';

    const params = [
      't_2m:C',
      'apparent_t:C',
      'msl_pressure:hPa',
      'precip_1h:mm',
      'wind_speed_10m:ms',
      'relative_humidity_2m:pct',
      'weather_symbol_1h:idx'
    ].join(',');

    const url = `https://api.meteomatics.com/${startISO}--${endISO}:PT1H/${params}/${latitude},${longitude}/json`;
    const r = await fetch(url, { headers: { Authorization: auth } });
    if (!r.ok) {
      const txt = await r.text().catch(()=>null);
      return res.status(502).json({ error: 'Meteomatics request failed', status: r.status, body: txt });
    }
    const mj = await r.json();

    // transform response into friendly shape
    const paramMap = {};
    for (const p of mj.data) {
      paramMap[p.parameter] = p.coordinates?.[0]?.dates?.map(d => ({ date: d.date, value: d.value })) || [];
    }

    const timeSeries = paramMap['t_2m:C'] ? paramMap['t_2m:C'].map(d => d.date) : [];
    const hourly = {
      time: timeSeries,
      temperature_2m: paramMap['t_2m:C'] ? paramMap['t_2m:C'].map(d => d.value) : [],
      apparent_temperature: paramMap['apparent_t:C'] ? paramMap['apparent_t:C'].map(d => d.value) : [],
      pressure_msl: paramMap['msl_pressure:hPa'] ? paramMap['msl_pressure:hPa'].map(d => d.value) : [],
      precipitation: paramMap['precip_1h:mm'] ? paramMap['precip_1h:mm'].map(d => d.value) : [],
      windspeed_10m: paramMap['wind_speed_10m:ms'] ? paramMap['wind_speed_10m:ms'].map(d => d.value) : [],
      relative_humidity_2m: paramMap['relative_humidity_2m:pct'] ? paramMap['relative_humidity_2m:pct'].map(d => d.value) : [],
      weathercode: paramMap['weather_symbol_1h:idx'] ? paramMap['weather_symbol_1h:idx'].map(d => d.value) : []
    };

    const closestIdx = findClosestIndexInIsoArray(hourly.time, new Date());
    const current = {
      temperature: hourly.temperature_2m[closestIdx] ?? null,
      apparent_temperature: hourly.apparent_temperature[closestIdx] ?? null,
      pressure: hourly.pressure_msl[closestIdx] ?? null,
      precip: hourly.precipitation[closestIdx] ?? null,
      windspeed: hourly.windspeed_10m[closestIdx] ?? null,
      humidity: hourly.relative_humidity_2m[closestIdx] ?? null,
      weather_code: hourly.weathercode[closestIdx] ?? null,
      time: hourly.time[closestIdx] ?? null
    };

    // build simple daily summary for 3 days
    const byDate = {};
    for (let i=0;i<hourly.time.length;i++){
      const d = new Date(hourly.time[i]);
      const dayKey = d.toISOString().slice(0,10);
      byDate[dayKey] = byDate[dayKey] || { temps: [], prec: 0, codes: [] };
      if (hourly.temperature_2m[i] != null) byDate[dayKey].temps.push(hourly.temperature_2m[i]);
      if (hourly.precipitation[i] != null) byDate[dayKey].prec += hourly.precipitation[i];
      if (hourly.weathercode[i] != null) byDate[dayKey].codes.push(hourly.weathercode[i]);
    }
    const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], weathercode: [] };
    const dayKeys = Object.keys(byDate).slice(0,4);
    for (const k of dayKeys) {
      const s = byDate[k];
      daily.time.push(k);
      daily.temperature_2m_max.push(s.temps.length ? Math.max(...s.temps) : null);
      daily.temperature_2m_min.push(s.temps.length ? Math.min(...s.temps) : null);
      daily.precipitation_sum.push(Math.round(s.prec*10)/10);
      daily.weathercode.push(s.codes.length ? mode(s.codes) : 0);
    }

    const payload = { place: { name: place.name, country: place.country, lat: Number(latitude), lon: Number(longitude) }, current, hourly, daily };
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(payload);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function findClosestIndexInIsoArray(arr, targetDate){
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const t = targetDate.getTime();
  let best = 0, bestDiff = Infinity;
  for (let i=0;i<arr.length;i++){
    const tv = Date.parse(arr[i]);
    if (isNaN(tv)) continue;
    const diff = Math.abs(tv - t);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
}
function mode(arr){ const counts = {}; for (const v of arr) counts[v] = (counts[v]||0)+1; let best=arr[0],bc=0; for (const k in counts) { if (counts[k] > bc) { bc = counts[k]; best = Number(k); } } return best; }
