'use strict';

const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const STUDENT_DIR = path.join(ROOT, 'student-portal');
const ADMIN_DIR = path.join(STUDENT_DIR, 'admin-portal');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(ROOT, 'data.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'KCC@2026';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const REPORT_TYPES = ['Library', 'Classroom', 'Wi-Fi', 'Lights', 'Water cooler', 'Assignment', 'AC', 'Fan'];
const PRIORITIES = ['Normal', 'Medium', 'High', 'Critical'];
const STATUSES = ['Received', 'Under Review', 'Verified', 'In Progress', 'Resolved'];
const CHAT_MESSAGE_LIMIT = 500;
const sessions = new Map();
let writeQueue = Promise.resolve();
let supabaseClientPromise;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function json(res, statusCode, value) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function fail(res, statusCode, message) { json(res, statusCode, { error: message }); }
function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function getToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
function requireAdmin(req, res) {
  const token = getToken(req);
  if (!token || !sessions.has(token)) { fail(res, 401, 'Admin sign-in required.'); return false; }
  return true;
}
async function readData() {
  try {
    const parsed = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.reports)) return {
      version: 1,
      reports: parsed.reports,
      chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { version: 1, reports: [], chatMessages: [] };
}
function saveData(data) {
  writeQueue = writeQueue.then(async () => {
    const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tempFile, DATA_FILE);
  });
  return writeQueue;
}
async function readBody(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) { const error = new Error('Request is too large.'); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { const error = new Error('Request body must be valid JSON.'); error.statusCode = 400; throw error; }
}
function makeTrackerId() {
  const d = new Date();
  const day = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `KCC-${day}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}
function cleanText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function cleanTrackerId(value) { return /^KCC-\d{6}-[A-Z0-9]{4}$/i.test(value) ? value.toUpperCase() : ''; }

async function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  if (!supabaseClientPromise) {
    supabaseClientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      })
    );
  }
  return supabaseClientPromise;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/chat/messages') {
    const supabase = await getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id,name,message,created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) { fail(res, 502, `Supabase error: ${error.message}`); return; }
      json(res, 200, (data || []).reverse().map(item => ({
        id: item.id,
        name: item.name,
        message: item.message,
        createdAt: item.created_at
      })));
      return;
    }
    const data = await readData();
    json(res, 200, data.chatMessages.slice(-100)); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/chat/messages') {
    const body = await readBody(req, 32 * 1024);
    const name = cleanText(body.name, 24);
    const message = cleanText(body.message, CHAT_MESSAGE_LIMIT);
    if (name.length < 2 || message.length < 1) {
      fail(res, 400, 'Enter your name and a message.'); return;
    }
    const supabase = await getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({ name, message })
        .select('id,name,message,created_at')
        .single();
      if (error) { fail(res, 502, `Supabase error: ${error.message}`); return; }
      json(res, 201, {
        id: data.id,
        name: data.name,
        message: data.message,
        createdAt: data.created_at
      });
      return;
    }
    const data = await readData();
    const chatMessage = {
      id: crypto.randomUUID(), name, message,
      createdAt: new Date().toISOString()
    };
    data.chatMessages.push(chatMessage);
    if (data.chatMessages.length > 500) data.chatMessages.splice(0, data.chatMessages.length - 500);
    await saveData(data);
    json(res, 201, chatMessage); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const body = await readBody(req, 32 * 1024);
    if (!safeEqual(body.username || '', ADMIN_USERNAME) || !safeEqual(body.password || '', ADMIN_PASSWORD)) {
      fail(res, 401, 'Username or password is incorrect.'); return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now());
    json(res, 200, { token, username: ADMIN_USERNAME }); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    sessions.delete(getToken(req)); json(res, 200, { ok: true }); return;
  }
  if (req.method === 'GET' && url.pathname === '/api/reports') {
    const id = cleanTrackerId(url.searchParams.get('id') || '');
    if (!id) { fail(res, 400, 'A valid tracker ID is required.'); return; }
    const data = await readData(); const report = data.reports.find(item => item.id === id);
    if (!report) { fail(res, 404, 'No report found for that tracker ID.'); return; }
    const { description, ...publicReport } = report;
    json(res, 200, publicReport); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/reports') {
    const body = await readBody(req);
    const building = cleanText(body.building, 20);
    const section = cleanText(body.section, 5).toUpperCase();
    const type = cleanText(body.type, 40);
    const priority = cleanText(body.priority, 20);
    const description = cleanText(body.description, 1000);
    const buildingLetter = building.slice(-1).toUpperCase();
    if (!['Building A', 'Building B', 'Building C'].includes(building) || !new RegExp(`^${buildingLetter}(?:[1-9]|10)$`).test(section)) { fail(res, 400, 'Choose a valid building and its section.'); return; }
    if (!REPORT_TYPES.includes(type) || !PRIORITIES.includes(priority) || description.length < 4) { fail(res, 400, 'Check the report type, priority and description.'); return; }
    const id = makeTrackerId(); let photoUrl = ''; let photoName = '';
    if (body.photo && body.photo.data && body.photo.name) {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.photo.data);
      if (!match) { fail(res, 400, 'Photo must be JPG, PNG or WEBP.'); return; }
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 5 * 1024 * 1024) { fail(res, 413, 'Photo must be 5 MB or smaller.'); return; }
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      photoName = path.basename(cleanText(body.photo.name, 120));
      const fileName = `${id}.${ext}`;
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      await fs.writeFile(path.join(UPLOAD_DIR, fileName), bytes, { flag: 'wx' });
      photoUrl = `/uploads/${fileName}`;
    }
    const now = new Date();
    const report = {
      id, building, section, type, priority, description, photoName, photoUrl,
      status: 'Received', date: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(now),
      createdAt: now.toISOString(), updatedAt: now.toISOString()
    };
    const data = await readData(); data.reports.push(report); await saveData(data);
    json(res, 201, report); return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/reports') {
    if (!requireAdmin(req, res)) return;
    const data = await readData(); json(res, 200, data.reports.slice().reverse()); return;
  }
  const updateMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
  if (req.method === 'PATCH' && updateMatch) {
    if (!requireAdmin(req, res)) return;
    const id = cleanTrackerId(decodeURIComponent(updateMatch[1]));
    const body = await readBody(req, 32 * 1024);
    if (!id || !STATUSES.includes(body.status)) { fail(res, 400, 'A valid tracker ID and status are required.'); return; }
    const data = await readData(); const report = data.reports.find(item => item.id === id);
    if (!report) { fail(res, 404, 'Report not found.'); return; }
    report.status = body.status; report.updatedAt = new Date().toISOString();
    await saveData(data); json(res, 200, report); return;
  }
  fail(res, 404, 'API route not found.');
}

async function serveFile(res, filePath) {
  let resolved = path.resolve(filePath);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('Not a file');
    const type = mimeTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    const stream = fsSync.createReadStream(resolved);
    stream.on('error', () => {
      if (res.headersSent) {
        if (!res.writableEnded) res.destroy();
      } else {
        fail(res, 404, 'Page not found.');
      }
    });
    stream.pipe(res);
  } catch {
    if (!res.headersSent) fail(res, 404, 'Page not found.');
    else if (!res.writableEnded) res.end();
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) { await handleApi(req, res, url); return; }
    if (url.pathname.startsWith('/uploads/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice('/uploads/'.length)));
      await serveFile(res, path.join(UPLOAD_DIR, name)); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { fail(res, 405, 'Method not allowed.'); return; }
    let requested = decodeURIComponent(url.pathname);
    if (requested === '/') requested = '/index.html';
    const adminRedirects = {
      '/chat': '/chat/index.html',
      '/chat/': '/chat/index.html',
      '/admin': '/admin-portal/login.html',
      '/admin/': '/admin-portal/login.html',
      '/admin/login': '/admin-portal/login.html',
      '/admin/dashboard': '/admin-portal/dashboard.html'
    };
    if (adminRedirects[requested]) {
      res.writeHead(302, { Location: adminRedirects[requested], 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const root = requested.startsWith('/admin-portal/') ? ADMIN_DIR : STUDENT_DIR;
    const relative = requested.startsWith('/admin-portal/') ? requested.slice('/admin-portal/'.length) : requested.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) { fail(res, 403, 'Forbidden.'); return; }
    await serveFile(res, file);
  } catch (error) {
    if (!res.headersSent) fail(res, error.statusCode || 500, error.statusCode ? error.message : 'Server error.');
    else if (!res.writableEnded) res.end();
  }
});

server.listen(PORT, () => {
  console.log(`CampusFix server running at http://localhost:${PORT}`);
  console.log(`Student portal: http://localhost:${PORT}/`);
  console.log(`Admin portal:   http://localhost:${PORT}/admin`);
  console.log(`Student chat:   http://localhost:${PORT}/chat`);
  if (SUPABASE_URL && SUPABASE_KEY) console.log('Chat database: Supabase');
  else console.log('Chat database: local backend/data.json (configure Supabase to switch)');
  if (!process.env.ADMIN_PASSWORD) console.log('Using demo admin password. Set ADMIN_PASSWORD before deployment.');
});


