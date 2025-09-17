// api/tile.js
export default async function handler(req, res) {
  try {
    const USER = process.env.METEOMATICS_USER;
    const PASS = process.env.METEOMATICS_PASS;
    if (!USER || !PASS) return res.status(500).send('Credentials not set');

    const { layer, time, z, x, y } = req.query;
    if (!layer || !time || !z || !x || !y) return res.status(400).send('Missing parameters');

    const layerMap = {
      pressure: 'msl_pressure:hPa',
      temperature: 't_2m:C',
      // fronts placeholder (Meteomatics parameter names vary)
      fronts: 'surface_fronts'
    };
    const param = layerMap[layer];
    if (!param) return res.status(400).send('Unknown layer');

    // Meteomatics tile endpoint using z/x/y pattern
    // Template: https://api.meteomatics.com/{time}/{parameter}/{z}/{x}/{y}/png?model=mix
    const tileUrl = `https://api.meteomatics.com/${encodeURIComponent(time)}/${encodeURIComponent(param)}/${z}/${x}/${y}/png?model=mix`;

    const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
    const upstream = await fetch(tileUrl, { headers: { Authorization: auth } });

    if (!upstream.ok) {
      const body = await upstream.text().catch(()=>null);
      return res.status(upstream.status).send(body || 'Upstream tile error');
    }

    const arrBuf = await upstream.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(Buffer.from(arrBuf));
  } catch (err) {
    console.error(err);
    return res.status(500).send('Tile proxy error');
  }
}
