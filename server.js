/**
 * Happy Scribe Clone — Single-File Zero-Dependency Node.js Backend
 * Run with: node server.js
 * Optional Env Vars: PORT=3000 OPENAI_API_KEY=sk-... GROQ_API_KEY=gsk_...
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'happyscribe-db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory and local JSON database exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const defaultDB = {
  activeProjectId: 'proj_default',
  projects: {
    proj_default: {
      id: 'proj_default',
      filename: 'Global_Media_Summit_Interview.mp4',
      humanVerified: false,
      updatedAt: new Date().toISOString(),
      transcriptsByLang: {
        en: [
          {
            speaker: 'Elena Rostova (Host)',
            initials: 'EL',
            start: 0.0,
            end: 5.5,
            words: ['Welcome', 'back', 'to', 'the', 'Global', 'Media', 'Summit.', 'Today', "we're", 'exploring', 'how', 'AI', 'transforms', 'accessibility.']
          },
          {
            speaker: 'Marcus Vance (Director)',
            initials: 'MV',
            start: 5.6,
            end: 11.2,
            words: ['With', 'Happy', 'Scribe,', 'our', 'production', 'team', 'generates', 'multilingual', 'subtitles', 'in', 'minutes', 'instead', 'of', 'days.']
          },
          {
            speaker: 'Elena Rostova (Host)',
            initials: 'EL',
            start: 11.3,
            end: 16.0,
            words: ['And', 'when', 'broadcast', 'compliance', 'requires', 'ninety-nine', 'percent', 'precision,', 'human', 'linguists', 'verify', 'every', 'line.']
          }
        ]
      }
    }
  }
};

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2));
      return structuredClone(defaultDB);
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    return structuredClone(defaultDB);
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Helper: Read JSON body from request
function parseBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large (max 50MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

// Helper: Send JSON response
function sendJSON(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
  });
  res.end(JSON.stringify(payload));
}

// Convert seconds to SRT/VTT timestamps
function toTimecode(sec, sep = ',') {
  const hrs = Math.floor(sec / 3600).toString().padStart(2, '0');
  const mins = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const secs = (sec % 60).toFixed(3).replace('.', sep).padStart(6, '0');
  return `${hrs}:${mins}:${secs}`;
}

// Call OpenAI or Groq Whisper API if key is available, else smart fallback
async function transcribeWithAI(fileBuffer, filename, customApiKey) {
  const apiKey = customApiKey || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  const isGroq = apiKey && apiKey.startsWith('gsk_');
  const endpoint = isGroq
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const model = isGroq ? 'whisper-large-v3' : 'whisper-1';

  if (apiKey) {
    const form = new FormData();
    const blob = new Blob([fileBuffer]);
    form.append('file', blob, filename);
    form.append('model', model);
    form.append('response_format', 'verbose_json');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Whisper API Error (${response.status}): ${errText}`);
    }

    const result = await response.json();
    const rawSegments = result.segments || [];

    if (rawSegments.length > 0) {
      return rawSegments.map((seg, idx) => ({
        speaker: idx % 2 === 0 ? 'Speaker 1' : 'Speaker 2',
        initials: idx % 2 === 0 ? 'S1' : 'S2',
        start: Number((seg.start || idx * 5).toFixed(1)),
        end: Number((seg.end || (idx + 1) * 5).toFixed(1)),
        words: (seg.text || '').trim().split(/\s+/).filter(Boolean)
      }));
    }
  }

  // Fallback simulation when no API key is provided
  const cleanName = filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
  return [
    {
      speaker: 'Speaker 1 (AI Diarized)',
      initials: 'S1',
      start: 0.0,
      end: 5.2,
      words: ['Audio', 'file', `"${cleanName}"`, 'has', 'been', 'uploaded', 'and', 'processed', 'by', 'the', 'Happy', 'Scribe', 'backend.']
    },
    {
      speaker: 'Speaker 2 (AI Diarized)',
      initials: 'S2',
      start: 5.3,
      end: 10.8,
      words: ['All', 'word-level', 'timestamps,', 'speaker', 'labels,', 'and', 'subtitle', 'CPS', 'metrics', 'are', 'now', 'synced', 'live.']
    },
    {
      speaker: 'Speaker 1 (AI Diarized)',
      initials: 'S1',
      start: 10.9,
      end: 16.0,
      words: ['Add', 'an', 'OpenAI', 'or', 'Groq', 'API', 'key', 'in', 'the', 'top', 'bar', 'for', 'real', 'Whisper', 'transcription.']
    }
  ];
}

// Translate segments using OpenAI/Groq Chat Completions or deterministic dictionary fallback
async function translateSegments(segments, targetLang, customApiKey) {
  const apiKey = customApiKey || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  const isGroq = apiKey && apiKey.startsWith('gsk_');
  const endpoint = isGroq
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

  const langNames = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', hi: 'Hindi', ja: 'Japanese' };
  const targetName = langNames[targetLang] || targetLang;

  if (apiKey) {
    const prompt = `Translate the "words" array in each JSON segment into ${targetName}. Keep the exact same JSON array structure, speaker, initials, start, and end values. Return ONLY valid JSON array.\n\n${JSON.stringify(segments)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  }

  return null; // Let frontend fallback dictionary handle if no API key
}

// Client-side bridge script injected automatically into index.html
const CLIENT_BRIDGE_SCRIPT = `
<script>
  (function() {
    window.HS_API_KEY = localStorage.getItem('HS_API_KEY') || '';

    // Inject Backend Status & API Key Button into Header
    window.addEventListener('DOMContentLoaded', async () => {
      const navActions = document.querySelector('header .flex.items-center.gap-3');
      if (navActions) {
        const keyBtn = document.createElement('button');
        keyBtn.className = 'inline-flex items-center gap-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl transition';
        keyBtn.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span> <span id="api-key-label">' + (window.HS_API_KEY ? 'Whisper Key Active' : 'Set AI Key') + '</span>';
        keyBtn.onclick = () => {
          const val = prompt('Enter OpenAI (sk-...) or Groq (gsk_...) API Key for live Whisper transcription & AI translation (leave blank for built-in demo mode):', window.HS_API_KEY);
          if (val !== null) {
            window.HS_API_KEY = val.trim();
            localStorage.setItem('HS_API_KEY', window.HS_API_KEY);
            document.getElementById('api-key-label').textContent = window.HS_API_KEY ? 'Whisper Key Active' : 'Set AI Key';
          }
        };
        navActions.prepend(keyBtn);
      }

      // Load saved project state from backend
      try {
        const res = await fetch('/api/projects/current');
        if (res.ok) {
          const project = await res.json();
          document.getElementById('studio-filename').textContent = project.filename;
          Object.assign(transcriptsByLang, project.transcriptsByLang);
          if (project.humanVerified && !isHumanVerified) toggleHumanBadge();
          updateStudioUI();
        }
      } catch (e) {
        console.warn('Backend sync skipped:', e);
      }
    });

    // Override File Upload to hit POST /api/transcribe
    window.handleCustomFileUpload = async function(event) {
      const file = event.target.files[0];
      if (!file) return;
      const filenameEl = document.getElementById('studio-filename');
      filenameEl.textContent = 'Uploading & Transcribing ' + file.name + '...';
      closeUploadModal();
      document.getElementById('editor-studio').scrollIntoView({ behavior: 'smooth' });

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result.split(',')[1];
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': window.HS_API_KEY
            },
            body: JSON.stringify({ filename: file.name, data: base64Data })
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Upload failed');

          filenameEl.textContent = payload.project.filename;
          transcriptsByLang.en = payload.project.transcriptsByLang.en;
          currentLang = 'en';
          document.getElementById('translation-select').value = 'en';
          updateStudioUI();
        } catch (err) {
          alert('Transcription Error: ' + err.message);
          filenameEl.textContent = file.name;
        }
      };
      reader.readAsDataURL(file);
    };

    // Override URL Import to hit POST /api/transcribe-url
    window.loadFromUrl = async function() {
      const val = document.getElementById('custom-url-input').value.trim();
      if (!val) return;
      closeUploadModal();
      const filenameEl = document.getElementById('studio-filename');
      filenameEl.textContent = 'Importing URL...';

      const res = await fetch('/api/transcribe-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': window.HS_API_KEY },
        body: JSON.stringify({ url: val })
      });
      const payload = await res.json();
      if (res.ok) {
        filenameEl.textContent = payload.project.filename;
        transcriptsByLang.en = payload.project.transcriptsByLang.en;
        currentLang = 'en';
        updateStudioUI();
      }
    };

    // Persist inline edits & new paragraphs to Backend
    const origUpdateStudioUI = window.updateStudioUI;
    window.saveProjectToBackend = async function() {
      try {
        await fetch('/api/projects/current', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: document.getElementById('studio-filename').textContent,
            humanVerified: isHumanVerified,
            transcriptsByLang
          })
        });
      } catch (e) {}
    };

    const origAddParagraph = window.addCustomParagraph;
    window.addCustomParagraph = function() {
      origAddParagraph();
      window.saveProjectToBackend();
    };

    const origToggleHuman = window.toggleHumanBadge;
    window.toggleHumanBadge = function() {
      origToggleHuman();
      window.saveProjectToBackend();
    };

    // Hook Translation Dropdown to Backend AI Translator
    const origTranslate = window.translateTranscript;
    window.translateTranscript = async function(lang) {
      if (window.HS_API_KEY && lang !== 'en') {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': window.HS_API_KEY },
          body: JSON.stringify({ targetLang: lang, segments: transcriptsByLang.en })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.segments) transcriptsByLang[lang] = data.segments;
        }
      }
      origTranslate(lang);
      window.saveProjectToBackend();
    };
  })();
</script>
`;

// HTTP Server Router
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return sendJSON(res, 200, { ok: true });
  }

  try {
    // 1. Serve index.html with auto-injected Backend Bridge
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const htmlPath = path.join(__dirname, 'index.html');
      if (!fs.existsSync(htmlPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('index.html not found. Place index.html in the same folder as server.js.');
      }
      let html = fs.readFileSync(htmlPath, 'utf8');
      html = html.replace('</body>', `${CLIENT_BRIDGE_SCRIPT}\n</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // 2. GET /api/health
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJSON(res, 200, {
        status: 'ok',
        whisperConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY),
        uptimeSeconds: Math.floor(process.uptime())
      });
    }

    // 3. GET /api/projects/current
    if (req.method === 'GET' && pathname === '/api/projects/current') {
      const db = readDB();
      const project = db.projects[db.activeProjectId] || Object.values(db.projects)[0];
      return sendJSON(res, 200, project);
    }

    // 4. PUT /api/projects/current (Save inline word edits & human verification badge)
    if (req.method === 'PUT' && pathname === '/api/projects/current') {
      const body = await parseBody(req);
      const db = readDB();
      const proj = db.projects[db.activeProjectId];
      if (body.filename) proj.filename = body.filename;
      if (typeof body.humanVerified === 'boolean') proj.humanVerified = body.humanVerified;
      if (body.transcriptsByLang) {
        proj.transcriptsByLang = { ...proj.transcriptsByLang, ...body.transcriptsByLang };
      }
      proj.updatedAt = new Date().toISOString();
      writeDB(db);
      return sendJSON(res, 200, { saved: true, project: proj });
    }

    // 5. POST /api/transcribe (Upload Audio/Video + Run Whisper AI)
    if (req.method === 'POST' && pathname === '/api/transcribe') {
      const body = await parseBody(req);
      const filename = path.basename(body.filename || `upload_${Date.now()}.mp3`);
      const fileBuffer = Buffer.from(body.data || '', 'base64');
      const savedPath = path.join(UPLOAD_DIR, `${Date.now()}_${filename}`);
      fs.writeFileSync(savedPath, fileBuffer);

      const customApiKey = req.headers['x-api-key'] || '';
      const segments = await transcribeWithAI(fileBuffer, filename, customApiKey);

      const db = readDB();
      const newId = 'proj_' + crypto.randomBytes(4).toString('hex');
      db.activeProjectId = newId;
      db.projects[newId] = {
        id: newId,
        filename,
        filePath: savedPath,
        humanVerified: false,
        updatedAt: new Date().toISOString(),
        transcriptsByLang: { en: segments }
      };
      writeDB(db);

      return sendJSON(res, 200, { ok: true, project: db.projects[newId] });
    }

    // 6. POST /api/transcribe-url (Import remote media link)
    if (req.method === 'POST' && pathname === '/api/transcribe-url') {
      const body = await parseBody(req);
      const rawUrl = body.url || 'https://example.com/media.mp4';
      const cleanTitle = rawUrl.replace(/^https?:\/\//, '').slice(0, 36);
      const segments = await transcribeWithAI(Buffer.from(''), cleanTitle, req.headers['x-api-key']);

      const db = readDB();
      const proj = db.projects[db.activeProjectId];
      proj.filename = cleanTitle;
      proj.transcriptsByLang.en = segments;
      proj.updatedAt = new Date().toISOString();
      writeDB(db);

      return sendJSON(res, 200, { ok: true, project: proj });
    }

    // 7. POST /api/translate (Translate segments via LLM or dictionary)
    if (req.method === 'POST' && pathname === '/api/translate') {
      const body = await parseBody(req);
      const translated = await translateSegments(
        body.segments || [],
        body.targetLang || 'es',
        req.headers['x-api-key']
      );
      return sendJSON(res, 200, { segments: translated });
    }

    // 8. GET /api/export?format=srt|vtt|txt|json&lang=en
    if (req.method === 'GET' && pathname === '/api/export') {
      const format = (parsedUrl.searchParams.get('format') || 'srt').toLowerCase();
      const lang = parsedUrl.searchParams.get('lang') || 'en';
      const db = readDB();
      const proj = db.projects[db.activeProjectId];
      const segs = proj.transcriptsByLang[lang] || proj.transcriptsByLang.en;

      let content = '';
      if (format === 'srt') {
        segs.forEach((s, i) => {
          content += `${i + 1}\n${toTimecode(s.start, ',')} --> ${toTimecode(s.end, ',')}\n${s.words.join(' ')}\n\n`;
        });
      } else if (format === 'vtt') {
        content = 'WEBVTT\n\n';
        segs.forEach((s) => {
          content += `${toTimecode(s.start, '.')} --> ${toTimecode(s.end, '.')}\n<v ${s.speaker}>${s.words.join(' ')}\n\n`;
        });
      } else if (format === 'json') {
        content = JSON.stringify(segs, null, 2);
      } else {
        segs.forEach((s) => {
          content += `[${toTimecode(s.start, '.')}] ${s.speaker}: ${s.words.join(' ')}\n\n`;
        });
      }

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="happyscribe_${lang}.${format}"`
      });
      return res.end(content);
    }

    // 404 Fallback
    sendJSON(res, 404, { error: `Route ${req.method} ${pathname} not found` });
  } catch (err) {
    console.error('[Backend Error]:', err);
    sendJSON(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🚀 Happy Scribe Full-Stack Server running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`📂 Database: ${DB_FILE}`);
  console.log(`🎙️  Whisper AI: ${(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) ? 'ENABLED' : 'Demo Mode (Set key in UI or ENV)'}`);
  console.log(`========================================================\n`);
});
