/**
 * Connections Route — إدارة الاتصالات
 */

const express = require('express');
const router = express.Router();
const { FlowBuilder } = require('../services/flow-builder');

function getBuilder() {
  return new FlowBuilder(
    process.env.AP_BASE_URL,
    process.env.AP_API_KEY,
    process.env.AP_PROJECT_ID
  );
}

// GET /api/connections — كل الاتصالات
router.get('/', async (req, res) => {
  try {
    const builder = getBuilder();
    const connections = await builder.listConnections();
    res.json(connections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/connections/check — تحقق من اتصالات مطلوبة
router.post('/check', async (req, res) => {
  try {
    const { needed } = req.body;
    if (!needed || !Array.isArray(needed)) {
      return res.status(400).json({ error: 'أرسل مصفوفة needed' });
    }

    const builder = getBuilder();
    const existing = await builder.listConnections();
    const existingNames = (existing.data || []).map(c => c.pieceName || '');

    const missing = needed.filter(n =>
      !existingNames.some(e => e.includes(n))
    );

    res.json({
      allConnected: missing.length === 0,
      missing,
      existing: existingNames,
      message: missing.length > 0
        ? `يحتاج ربط: ${missing.join(', ')}`
        : 'كل الاتصالات جاهزة ✅'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
