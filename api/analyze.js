const https = require('https');

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' }); return; }

  const { imageBase64, playerName, hasKey } = req.body || {};
  if (!imageBase64) { res.status(400).json({ error: 'No image provided' }); return; }

  const prompt = `Analyze this screenshot from the media player app "${playerName || 'IPTV Player'}".
Extract:
1. MAC Address (format XX:XX:XX:XX:XX:XX — may be labeled "Adresse Mac" or "MAC")
${hasKey ? '2. Device Key (labeled Key, Device Key, Clé de l\'appareil, or a short numeric/alphanumeric code)' : ''}
Respond ONLY with raw JSON, no markdown, no explanation:
{"mac":"...","deviceKey":"..."}
Use null for any field not found.`;

  const payload = JSON.stringify({
    model: 'claude-opus-4-5',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: prompt }
      ]
    }]
  });

  try {
    const result = await httpsPost({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }, payload);

    if (result.status !== 200) {
      console.error('Anthropic API error:', result.body);
      res.status(500).json({ error: result.body?.error?.message || 'Anthropic error' });
      return;
    }

    const raw = (result.body.content || [])
      .map(b => b.text || '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const macMatch = raw.match(/([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}/);
      parsed = { mac: macMatch ? macMatch[0] : null, deviceKey: null };
    }

    res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
