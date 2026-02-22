/**
 * Pieces Route — معلومات الـ Pieces
 */

const express = require('express');
const router = express.Router();

// GET /api/pieces — كل الـ pieces
router.get('/', async (req, res) => {
  const registry = req.app.locals.registry;
  res.json({
    pieces: Object.values(registry.pieces).map(p => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      logoUrl: p.logoUrl,
      triggersCount: Object.keys(p.triggers).length,
      actionsCount: Object.keys(p.actions).length
    })),
    total: Object.keys(registry.pieces).length,
    lastSync: registry.lastSync
  });
});

// GET /api/pieces/stats — إحصائيات
router.get('/stats', async (req, res) => {
  const registry = req.app.locals.registry;
  res.json(registry.getStats());
});

// GET /api/pieces/:name — تفاصيل piece
router.get('/:name', async (req, res) => {
  const registry = req.app.locals.registry;
  const piece = registry.getPiece(req.params.name);
  if (!piece) {
    return res.status(404).json({ error: 'Piece مو موجود' });
  }
  res.json(piece);
});

// POST /api/pieces/sync — مزامنة يدوية
router.post('/sync', async (req, res) => {
  const registry = req.app.locals.registry;
  const logger = req.app.locals.logger;
  try {
    await registry.sync();
    logger.info(`Pieces synced: ${Object.keys(registry.pieces).length}`);
    res.json({
      success: true,
      total: Object.keys(registry.pieces).length,
      lastSync: registry.lastSync
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
