const https = require('https');

// Parse request body manually
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function callAnthropic(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Parse body manually - Vercel may not auto-parse large bodies
  const body = await parseBody(req);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel' });
    return;
  }

  const { imageBase64, playerName, hasKey } = body;
  if (!imageBase64) {
    res.status(400).json({ error: 'Missing imageBase64 in request body' });
    return;
  }

  const prompt = `Look at this screenshot carefully. Extract:
1. The MAC Address — usually 6 pairs of hex digits separated by colons like AA:BB:CC:DD:EE:FF. May be labeled "MAC", "Adresse Mac", "MAC Address".
${hasKey ? '2. The Device Key — a short code labeled "Key", "Device Key", "Clé de l\'appareil", or just a number like 325281.' : ''}
Reply ONLY with this exact JSON format, nothing else:
{"mac":"XX:XX:XX:XX:XX:XX","deviceKey":"XXXXX"}
Use null if a value is not found.`;

  try {
    const result = await callAnthropic(apiKey, {
      model: 'claude-opus-4-5',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 }
          },
          { type: 'text', text: prompt }
        ]
      }]
    });

    if (result.status !== 200) {
      console.error('Anthropic error status:', result.status, result.body);
      res.status(500).json({ error: JSON.stringify(result.body) });
      return;
    }

    const text = (result.body.content || []).map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    console.log('Anthropic response text:', text);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const macMatch = text.match(/([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}/);
      parsed = { mac: macMatch ? macMatch[0] : null, deviceKey: null };
    }

    res.status(200).json(parsed);

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};
