require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const EXTRACTION_PROMPT = `Analiza esta imagen de una lista de personas (posiblemente manuscrita o un póster con nombres numerados).

Extrae SOLO nombres reales de personas. Ignora:
- Títulos, slogans, fechas, horas, edades, cédulas, direcciones
- Encabezados de hospital (úsalo solo para asignar hospital a nombres de esa sección)
- Rangos numéricos ("1-10")

Formato típico: número + APELLIDO + NOMBRE(S), o listas manuscritas con nombre y edad.

Responde ÚNICAMENTE con JSON válido:
{
  "entries": [
    { "name": "Orozco Yusbelis", "hospital": "Hospital Domingo Luciani" }
  ]
}

Reglas:
- "name": Title Case, sin número de lista
- "hospital": institución de la sección; vacío si no se puede determinar
- Incluye todos los nombres legibles
- No inventes nombres`;

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Formato de imagen no válido. Use JPEG, PNG o WebP.');

  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const bytes = Buffer.byteLength(match[2], 'base64');
  if (bytes > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande. Máximo 12 MB.');
  return { mimeType, base64: match[2] };
}

async function extractWithOpenAI(dataUrl, defaultHospital) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Servicio de IA no configurado.');

  const { mimeType, base64 } = parseDataUrl(dataUrl);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT + (defaultHospital ? `\n\nHospital por defecto: ${defaultHospital}` : '') },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('OpenAI error:', response.status, errorBody.slice(0, 300));
    throw new Error('No se pudo analizar la imagen con IA.');
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('La IA no devolvió resultados.');

  const parsed = JSON.parse(content);
  return (parsed.entries || [])
    .map((entry) => {
      const name = String(entry?.name || '').replace(/\s+/g, ' ').trim();
      if (!name || name.length < 4) return null;
      return {
        name,
        hospital: String(entry?.hospital || defaultHospital || '').trim(),
      };
    })
    .filter(Boolean);
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiadas solicitudes. Espere unos minutos.' },
});

app.use(express.json({ limit: '14mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (_req, res) => {
  res.json({
    aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    provider: 'openai',
  });
});

app.post('/api/extract-names', limiter, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'IA no configurada. Configure OPENAI_API_KEY.' });
    }
    const { image, defaultHospital = '' } = req.body || {};
    if (!image) return res.status(400).json({ error: 'Falta la imagen.' });

    const entries = await extractWithOpenAI(image, String(defaultHospital || '').trim());
    res.json({ entries, count: entries.length });
  } catch (err) {
    console.error('extract-names:', err.message);
    res.status(400).json({ error: err.message || 'Error al procesar.' });
  }
});

app.listen(PORT, () => {
  const aiStatus = process.env.OPENAI_API_KEY ? 'IA activa' : 'sin IA';
  console.log(`Servidor en http://localhost:${PORT} — ${aiStatus}`);
});
