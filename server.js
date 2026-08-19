const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4173;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bookings.json');
const STATUS_VALUES = new Set(['available', 'hold', 'soldout']);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '{}\n', 'utf8');
  }
}

function readBookings() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error('Unable to read bookings:', error);
    return {};
  }
}

function validateBookings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const bookings = {};
  for (const [dateKey, status] of Object.entries(value)) {
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateKey) || !STATUS_VALUES.has(status)) {
      return null;
    }
    bookings[dateKey] = status;
  }
  return bookings;
}

function writeBookings(bookings) {
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(bookings, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function serveStatic(request, response) {
  const requestPath = decodeURIComponent(request.url.split('?')[0]);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const filePath = path.resolve(ROOT_DIR, relativePath);
  if (!filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

ensureDataFile();

const server = http.createServer(async (request, response) => {
  if (request.url.split('?')[0] === '/api/bookings') {
    if (request.method === 'GET') {
      sendJson(response, 200, readBookings());
      return;
    }

    if (request.method === 'PUT') {
      try {
        const bookings = validateBookings(JSON.parse(await readRequestBody(request)));
        if (!bookings) {
          sendJson(response, 400, { error: 'Invalid booking state' });
          return;
        }
        writeBookings(bookings);
        sendJson(response, 200, bookings);
      } catch (error) {
        sendJson(response, 400, { error: 'Invalid JSON request' });
      }
      return;
    }

    response.setHeader('Allow', 'GET, PUT');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  if (request.method === 'GET') {
    serveStatic(request, response);
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => {
  console.log(`Vagamon Bookings running at http://localhost:${PORT}`);
});
