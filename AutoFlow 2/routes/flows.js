/**
 * Flows Route — إدارة الـ Flows
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

// GET /api/flows — استعراض الكل
router.get('/', async (req, res) => {
  try {
    const builder = getBuilder();
    const result = await builder.listFlows(req.query.limit || 50);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/flows/:id — تفاصيل flow
router.get('/:id', async (req, res) => {
  try {
    const builder = getBuilder();
    const flow = await builder.getFlow(req.params.id);
    res.json(flow);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/flows/:id/publish — نشر flow
router.post('/:id/publish', async (req, res) => {
  try {
    const builder = getBuilder();
    await builder.publishFlow(req.params.id);
    res.json({ success: true, status: 'PUBLISHED' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/flows/:id/status — تغيير حالة flow
router.post('/:id/status', async (req, res) => {
  try {
    const builder = getBuilder();
    const { enabled } = req.body;
    await builder.setFlowStatus(req.params.id, enabled);
    res.json({ success: true, status: enabled ? 'ENABLED' : 'DISABLED' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/flows/:id — حذف flow
router.delete('/:id', async (req, res) => {
  try {
    const builder = getBuilder();
    await builder.deleteFlow(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/flows/:id/runs — سجل التنفيذ
router.get('/:id/runs', async (req, res) => {
  try {
    const builder = getBuilder();
    const runs = await builder.listRuns(req.params.id, req.query.limit || 10);
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
