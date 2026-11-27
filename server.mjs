import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const storePath = path.resolve(root, process.env.INQUIRY_STORE_PATH || 'data/inquiries.jsonl');
const windowMs = Math.max(60_000, Number(process.env.RATE_LIMIT_WINDOW_MS || 900_000));
const maxRequests = Math.max(1, Number(process.env.MAX_INQUIRIES_PER_WINDOW || 5));
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
const rateBuckets = new Map();
const products = JSON.parse(await readFile(path.join(root, 'data/products.json'), 'utf8'));
const productIds = new Set(products.map((product) => product.id));

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 600
}));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/products', (_request, response) => {
  response.json({ products });
});

app.post('/api/inquiries', express.json({ limit: '10kb', strict: true }), async (request, response, next) => {
  try {
    const ip = request.ip;
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (bucket && now - bucket.start < windowMs && bucket.count >= maxRequests) {
      response.set('Retry-After', String(Math.ceil((windowMs - (now - bucket.start)) / 1000)));
      return response.status(429).json({ error: 'Too many enquiries. Please try again later.' });
    }
    if (!bucket || now - bucket.start >= windowMs) rateBuckets.set(ip, { start: now, count: 1 });
    else bucket.count += 1;

    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return response.status(400).json({ error: 'Submit a valid enquiry.' });
    }
    if (typeof body.website === 'string' && body.website.trim()) {
      return response.status(202).json({ status: 'accepted' });
    }

    const clean = (value, maxLength) => typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
      : '';
    const inquiry = {
      name: clean(body.name, 80),
      businessName: clean(body.businessName, 120),
      phone: clean(body.phone, 24),
      email: clean(body.email, 160).toLowerCase(),
      products: Array.isArray(body.products) ? [...new Set(body.products.filter((id) => typeof id === 'string'))] : [],
      quantity: clean(body.quantity, 80),
      city: clean(body.city, 80),
      message: clean(body.message, 600)
    };
    if (inquiry.name.length < 2 || inquiry.businessName.length < 2 || inquiry.quantity.length < 2 || inquiry.city.length < 2) {
      return response.status(400).json({ error: 'Name, business, quantity and delivery city are required.' });
    }
    const digits = inquiry.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      return response.status(400).json({ error: 'Enter a valid phone number.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) {
      return response.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (inquiry.products.length > 17 || inquiry.products.some((id) => !productIds.has(id))) {
      return response.status(400).json({ error: 'One or more selected products are not in the catalogue.' });
    }

    const reference = `SM-${randomUUID().slice(0, 8).toUpperCase()}`;
    const record = { reference, receivedAt: new Date().toISOString(), ...inquiry };
    await mkdir(path.dirname(storePath), { recursive: true });
    await appendFile(storePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    return response.status(201).json({ status: 'received', reference });
  } catch (error) {
    return next(error);
  }
});

app.get('/styles.css', (_request, response) => response.sendFile(path.join(root, 'styles.css')));
app.get('/app.js', (_request, response) => response.sendFile(path.join(root, 'app.js')));
app.use('/assets', express.static(path.join(root, 'assets'), { maxAge: '1d', fallthrough: false }));
app.get('/', (_request, response) => response.sendFile(path.join(root, 'index.html')));
app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }));
app.use((error, _request, response, _next) => {
  if (error.type === 'entity.too.large') return response.status(413).json({ error: 'Enquiry is too large.' });
  if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error: 'Request body must be valid JSON.' });
  if (error.status === 404) return response.status(404).send('Not found.');
  console.error('Request failed:', error.message);
  return response.status(500).json({ error: 'Something went wrong. Please contact the sales desk.' });
});

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.start >= windowMs) rateBuckets.delete(ip);
  }
}, windowMs).unref();

const server = app.listen(port, host, () => {
  console.log(`Sourya Masala server listening on http://${host}:${port}`);
});

function shutdown() {
  clearInterval(cleanup);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
