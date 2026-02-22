/**
 * ═══════════════════════════════════════════════════════════
 * Chat Route — المحادثة الرئيسية
 * ═══════════════════════════════════════════════════════════
 * POST /api/chat/generate   → يولد flow من نص
 * POST /api/chat/explain    → يشرح flow موجود
 * POST /api/chat/modify     → يعدل flow بناءً على طلب
 */

const express = require('express');
const router = express.Router();
const { convertToFlow, generateFlowExplanation } = require('../services/ai-engine');
const { FlowBuilder } = require('../services/flow-builder');
const { safeguardFlow } = require('../services/validation');
const { v4: uuidv4 } = require('uuid');

// ─── Session Store (بسيط — في الإنتاج استخدم Redis) ──────
const sessions = new Map();

/**
 * POST /api/chat/generate
 * يحول نص طبيعي إلى Activepieces Flow
 */
router.post('/generate', async (req, res) => {
  const logger = req.app.locals.logger;
  const registry = req.app.locals.registry;

  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length < 3) {
      return res.status(400).json({
        error: 'الرسالة قصيرة — اكتب وصف أوضح للأتمتة اللي تبيها'
      });
    }

    // التأكد إن الـ pieces محملة
    if (Object.keys(registry.pieces).length === 0) {
      logger.info('Pieces not loaded — syncing now...');
      await registry.sync();
    }

    // جلب تاريخ المحادثة
    const session = sessions.get(sessionId) || { history: [] };
    const sid = sessionId || uuidv4();

    logger.info('🤖 Generating flow...', { message: message.substring(0, 100), sessionId: sid });

    // ── Step 1: AI يحول النص إلى JSON ────────────────
    const aiResult = await convertToFlow(
      message,
      registry,
      session.history
    );

    if (!aiResult.success) {
      return res.status(422).json({
        error: 'ما قدرت أفهم الطلب — حاول توصف بشكل أوضح',
        details: aiResult.errors
      });
    }

    // ── Step 2: فحص السلامة ───────────────────────────
    const safety = safeguardFlow(aiResult.flow);
    if (!safety.safe) {
      return res.status(422).json({
        error: 'الـ Flow فيه مشاكل يجب تُصلح أول',
        blocks: safety.blocks,
        warnings: safety.warnings,
        flow: aiResult.flow
      });
    }

    // ── Step 3: حفظ في الـ session ────────────────────
    session.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: JSON.stringify(aiResult.flow) }
    );
    // حافظ على آخر 10 رسائل
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }
    session.lastFlow = aiResult.flow;
    sessions.set(sid, session);

    // ── Step 4: رجع النتيجة ──────────────────────────
    res.json({
      sessionId: sid,
      flow: aiResult.flow,
      warnings: [...(aiResult.warnings || []), ...(safety.warnings || [])],
      explanation: aiResult.flow.explanation_ar || '',
      connectionsNeeded: aiResult.flow.connections_needed || [],
      status: 'PREVIEW',
      retried: aiResult.retried || false
    });

  } catch (error) {
    logger.error('Generate error:', error);

    if (error.name === 'AIEngineError') {
      return res.status(422).json({
        error: 'AI ما قدر يفهم الطلب',
        code: error.code,
        suggestion: 'حاول توصف بشكل أبسط — مثال: "كل يوم ارسل تقرير المبيعات على الإيميل"'
      });
    }

    res.status(500).json({
      error: 'حصل خطأ — حاول مرة ثانية',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/chat/deploy
 * ينشئ الـ Flow فعلياً في Activepieces
 */
router.post('/deploy', async (req, res) => {
  const logger = req.app.locals.logger;

  try {
    const { sessionId, flowJson, autoPublish = false } = req.body;

    // جلب الـ flow من الـ session أو من الـ body
    let flow = flowJson;
    if (!flow && sessionId) {
      const session = sessions.get(sessionId);
      if (session?.lastFlow) {
        flow = session.lastFlow;
      }
    }

    if (!flow) {
      return res.status(400).json({
        error: 'ما لقيت Flow — ولّد واحد أول عن طريق /generate'
      });
    }

    logger.info('🚀 Deploying flow...', { name: flow.displayName, autoPublish });

    // ── بناء الـ Flow في Activepieces ────────────────
    const builder = new FlowBuilder(
      process.env.AP_BASE_URL,
      process.env.AP_API_KEY,
      process.env.AP_PROJECT_ID
    );

    const result = await builder.buildFlow(flow, { autoPublish });

    logger.info('✅ Flow deployed', { flowId: result.flowId, status: result.status });

    res.json({
      success: true,
      flowId: result.flowId,
      flowUrl: result.flowUrl,
      status: result.status,
      stepsCreated: result.stepsCreated,
      message: autoPublish
        ? '✅ تم إنشاء وتفعيل الـ Flow!'
        : '✅ تم إنشاء الـ Flow كمسودة — افتحه في Activepieces لمراجعته وتفعيله'
    });

  } catch (error) {
    logger.error('Deploy error:', error);

    if (error.name === 'FlowBuilderError') {
      return res.status(error.statusCode || 500).json({
        error: 'خطأ في إنشاء الـ Flow في Activepieces',
        details: error.apiResponse,
        path: error.path
      });
    }

    res.status(500).json({
      error: 'فشل إنشاء الـ Flow — حاول مرة ثانية'
    });
  }
});

/**
 * POST /api/chat/modify
 * يعدل flow موجود بناءً على طلب نصي
 */
router.post('/modify', async (req, res) => {
  const logger = req.app.locals.logger;
  const registry = req.app.locals.registry;

  try {
    const { sessionId, modification } = req.body;

    if (!modification) {
      return res.status(400).json({ error: 'اكتب التعديل اللي تبيه' });
    }

    const session = sessions.get(sessionId);
    if (!session?.lastFlow) {
      return res.status(400).json({
        error: 'ما لقيت Flow سابق — ولّد واحد أول'
      });
    }

    // نرسل الـ flow الحالي مع طلب التعديل
    const modifyPrompt = `عدّل الـ Flow التالي بناءً على الطلب:

## الـ Flow الحالي:
${JSON.stringify(session.lastFlow, null, 2)}

## التعديل المطلوب:
${modification}

رجع الـ Flow المعدّل كـ JSON كامل.`;

    const result = await convertToFlow(modifyPrompt, registry, []);

    if (result.success) {
      session.lastFlow = result.flow;
      session.history.push(
        { role: 'user', content: `عدّل: ${modification}` },
        { role: 'assistant', content: JSON.stringify(result.flow) }
      );
      sessions.set(sessionId, session);
    }

    res.json({
      sessionId,
      flow: result.flow,
      warnings: result.warnings || [],
      explanation: result.flow?.explanation_ar || '',
      status: 'PREVIEW'
    });

  } catch (error) {
    logger.error('Modify error:', error);
    res.status(500).json({ error: 'فشل التعديل — حاول مرة ثانية' });
  }
});

/**
 * POST /api/chat/explain
 * يشرح flow بالعربي
 */
router.post('/explain', async (req, res) => {
  try {
    const { flowJson } = req.body;
    if (!flowJson) {
      return res.status(400).json({ error: 'أرسل الـ Flow JSON' });
    }

    const explanation = await generateFlowExplanation(flowJson);
    res.json({ explanation });
  } catch (error) {
    res.status(500).json({ error: 'فشل الشرح' });
  }
});

module.exports = router;
