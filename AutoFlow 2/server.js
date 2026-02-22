/**
 * ═══════════════════════════════════════════════════════════
 * Prompt-to-Automation — Backend Server
 * ═══════════════════════════════════════════════════════════
 * يربط: واجهة الشات ← AI Engine ← Activepieces API
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createLogger, format, transports } = require('winston');

const chatRoutes = require('./routes/chat');
const flowsRoutes = require('./routes/flows');
const connectionsRoutes = require('./routes/connections');
const piecesRoutes = require('./routes/pieces');
const { PiecesRegistry } = require('./services/pieces-registry');
const { getProviderInfo } = require('./services/ai-engine');

// ─── Logger ──────────────────────────────────────────────
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  ]
});

// ─── Express App ─────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 دقيقة
  max: 30,
  message: { error: 'طلبات كثيرة — انتظر شوي' }
});
app.use('/api/', limiter);

// Request Logger
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// ─── Pieces Registry (Global) ────────────────────────────
const registry = new PiecesRegistry(
  process.env.AP_BASE_URL,
  process.env.AP_API_KEY
);

// جعل الـ registry متاح لكل الـ routes
app.locals.registry = registry;
app.locals.logger = logger;

// ─── Routes ──────────────────────────────────────────────
app.use('/api/chat', chatRoutes);
app.use('/api/flows', flowsRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/pieces', piecesRoutes);

// ─── Serve Frontend ──────────────────────────────────────
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const apHealth = await fetch(`${process.env.AP_BASE_URL}/api/v1/flags`);
    res.json({
      status: 'ok',
      activepieces: apHealth.ok ? 'connected' : 'disconnected',
      piecesLoaded: Object.keys(registry.pieces).length,
      ai: getProviderInfo(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.json({
      status: 'degraded',
      activepieces: 'disconnected',
      error: err.message
    });
  }
});

// Catch-all: serve frontend (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error Handler (must be last — catches errors from all above)
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'حصل خطأ — حاول مرة ثانية',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ─── Start ───────────────────────────────────────────────
async function start() {
  // مزامنة الـ Pieces عند البداية
  logger.info('🔄 جاري مزامنة Pieces من Activepieces...');
  try {
    await registry.sync();
    logger.info(`✅ تم تحميل ${Object.keys(registry.pieces).length} piece`);
  } catch (err) {
    logger.warn('⚠️ فشل تحميل Pieces — سيعاد لاحقاً', { error: err.message });
  }

  // مزامنة كل 6 ساعات
  setInterval(async () => {
    try {
      await registry.sync();
      logger.info(`🔄 Pieces synced: ${Object.keys(registry.pieces).length}`);
    } catch (err) {
      logger.warn('Pieces sync failed:', err.message);
    }
  }, 6 * 60 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    const ai = getProviderInfo();
    logger.info(`🚀 Backend running on port ${PORT}`);
    logger.info(`📡 Activepieces: ${process.env.AP_BASE_URL}`);
    logger.info(`🤖 AI: ${ai.provider} — ${ai.model}`);
  });
}

start().catch(err => {
  logger.error('Failed to start:', err);
  process.exit(1);
});
