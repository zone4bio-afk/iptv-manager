const https = require('https');

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
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    return;
  }

  // Read body with size limit
  const rawBody = await new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) { // 10MB limit
        reject(new Error('Request body too large'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  let body;
  try { body = JSON.parse(rawBody); }
  catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }

  const { imageBase64, playerName, hasKey } = body;
  if (!imageBase64) { res.status(400).json({ error: 'Missing imageBase64' }); return; }

  console.log('Image size (chars):', imageBase64.length);
  console.log('Player:', playerName, 'hasKey:', hasKey);

  const prompt = `This screenshot shows an IPTV media player info screen. The image may be a photo of a phone taken during a video call, or a direct screenshot. Look carefully at ALL visible text.

Extract:
1. MAC Address: format XX:XX:XX:XX:XX:XX (6 hex pairs with colons). Look for labels like "Adresse Mac", "MAC", "MAC Address". Example: 44:90:53:de:7f:4f
${hasKey ? '2. Device Key: short code after labels like "Cle de l\'appareil", "Device Key", "Key". Often just digits. Example: 325281' : ''}

Text may appear in yellow, orange or white. Search the entire image carefully.
Reply ONLY with JSON, nothing else:
{"mac":"XX:XX:XX:XX:XX:XX","deviceKey":"XXXXX"}
Use null for missing values.`;

  try {
    const result = await callAnthropic(apiKey, {
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    console.log('Anthropic status:', result.status);

    if (result.status !== 200) {
      console.error('Anthropic error:', JSON.stringify(result.body));
      res.status(500).json({ error: result.body?.error?.message || 'Anthropic API error', details: result.body });
      return;
    }

    const text = (result.body.content || []).map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    console.log('Response text:', text);

    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const macMatch = text.match(/([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}/);
      parsed = { mac: macMatch ? macMatch[0] : null, deviceKey: null };
    }

    res.status(200).json(parsed);

  } catch (err) {
    console.error('Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
};
