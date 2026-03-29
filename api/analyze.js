module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { imageBase64, playerName, hasKey } = req.body;
  if (!imageBase64) { res.status(400).json({ error: 'No image' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'API key not configured' }); return; }

  const prompt = `Analyze this screenshot from the media player app "${playerName}".
Extract:
1. MAC Address (format XX:XX:XX:XX:XX:XX — also labeled "Adresse Mac")
${hasKey ? '2. Device Key (labeled Key, Device Key, Clé de l\'appareil, Code, or similar short number/code)' : ''}
Respond ONLY with raw JSON, no markdown:
{"mac":"...","deviceKey":"..."}
Use null for missing fields.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      res.status(500).json({ error: data.error?.message || 'Anthropic API error' });
      return;
    }

    const raw = (data.content || []).map(b => b.text || '').join('').replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const macMatch = raw.match(/([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}/);
      parsed = { mac: macMatch ? macMatch[0] : null, deviceKey: null };
    }

    res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
};
}
