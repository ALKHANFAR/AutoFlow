/**
 * ═══════════════════════════════════════════════════════════
 * Validation — التحقق من صحة الـ Flow قبل الإنشاء
 * ═══════════════════════════════════════════════════════════
 * بدون تبعيات خارجية — Pure JS
 */

const VALID_TRIGGER_TYPES = ['SCHEDULE', 'PIECE_TRIGGER', 'WEBHOOK'];
const VALID_ACTION_TYPES = ['PIECE', 'BRANCH', 'CODE', 'LOOP_ON_ITEMS'];

// ─── Schema Validation ───────────────────────────────────

function validateSchema(flowJson) {
  const errors = [];

  if (!flowJson || typeof flowJson !== 'object') {
    errors.push('الـ Flow لازم يكون object');
    return errors;
  }

  if (!flowJson.displayName || typeof flowJson.displayName !== 'string' || flowJson.displayName.trim().length === 0) {
    errors.push('displayName مطلوب ولازم يكون نص');
  }

  if (!flowJson.trigger || typeof flowJson.trigger !== 'object') {
    errors.push('trigger مطلوب');
  } else {
    if (!VALID_TRIGGER_TYPES.includes(flowJson.trigger.type)) {
      errors.push(`trigger.type لازم يكون واحد من: ${VALID_TRIGGER_TYPES.join(', ')}`);
    }
    if (!flowJson.trigger.displayName || typeof flowJson.trigger.displayName !== 'string') {
      errors.push('trigger.displayName مطلوب');
    }
  }

  if (!Array.isArray(flowJson.actions) || flowJson.actions.length === 0) {
    errors.push('actions مطلوبة ولازم تكون مصفوفة فيها عنصر واحد على الأقل');
  } else {
    for (let i = 0; i < flowJson.actions.length; i++) {
      const action = flowJson.actions[i];
      const prefix = `actions[${i}]`;

      if (!action || typeof action !== 'object') {
        errors.push(`${prefix}: لازم يكون object`);
        continue;
      }
      if (!VALID_ACTION_TYPES.includes(action.type)) {
        errors.push(`${prefix}.type لازم يكون واحد من: ${VALID_ACTION_TYPES.join(', ')}`);
      }
      if (!action.displayName || typeof action.displayName !== 'string') {
        errors.push(`${prefix}.displayName مطلوب`);
      }
    }
  }

  return errors;
}

// ─── Full Validation ─────────────────────────────────────

function validateFlowOutput(flowJson, piecesRegistry) {
  const errors = [];
  const warnings = [];

  // 1. Schema
  const schemaErrors = validateSchema(flowJson);
  if (schemaErrors.length > 0) {
    return { valid: false, errors: schemaErrors, warnings };
  }

  // 2. AI error field
  if (flowJson.error) {
    return { valid: false, errors: [flowJson.error], warnings, isUserError: true };
  }

  // 3. Trigger
  const trigger = flowJson.trigger;
  if (trigger.type === 'PIECE_TRIGGER' || trigger.type === 'SCHEDULE') {
    if (!trigger.pieceName) {
      errors.push('الـ Trigger يحتاج pieceName');
    } else if (piecesRegistry) {
      const check = piecesRegistry.validate(trigger.pieceName, trigger.triggerName);
      if (!check.valid) warnings.push(`Trigger: ${check.error} (سيتم تجاهله)`);
    }
  }

  // 4. Schedule cron
  if (trigger.type === 'SCHEDULE') {
    const cron = trigger.input?.cronExpression;
    if (!cron) {
      errors.push('Schedule trigger يحتاج cronExpression');
    } else if (!isValidCron(cron)) {
      warnings.push(`Cron expression "${cron}" ممكن يكون غلط — تأكد منه`);
    }
  }

  // 5. Actions
  for (let i = 0; i < flowJson.actions.length; i++) {
    const action = flowJson.actions[i];
    const prefix = `Action ${i + 1} (${action.displayName})`;

    if (action.type === 'PIECE') {
      if (!action.pieceName) {
        errors.push(`${prefix}: يحتاج pieceName`);
      } else if (!action.actionName) {
        errors.push(`${prefix}: يحتاج actionName`);
      } else if (piecesRegistry) {
        const check = piecesRegistry.validate(action.pieceName, action.actionName);
        if (!check.valid) warnings.push(`${prefix}: ${check.error} (سيتم تجاهله)`);
      }
    }

    if (action.type === 'BRANCH') {
      if (!action.conditions || !Array.isArray(action.conditions) || action.conditions.length === 0) {
        errors.push(`${prefix}: Branch يحتاج conditions`);
      }
    }

    if (action.type === 'CODE') {
      if (!action.input?.code && !action.code) {
        warnings.push(`${prefix}: Code action بدون كود — سيحتاج تعبئة يدوية`);
      }
    }
  }

  // 6. Too many steps
  if (flowJson.actions.length > 20) {
    warnings.push('⚠️ عدد الخطوات كثير (أكثر من 20) — فكر في تقسيم الـ Flow');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Cron Validation ─────────────────────────────────────
function isValidCron(expression) {
  const parts = expression.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

// ─── Safety Checks ───────────────────────────────────────
function safeguardFlow(flowJson) {
  const warnings = [];
  const blocks = [];

  if (flowJson.trigger.type === 'SCHEDULE') {
    const cron = flowJson.trigger.input?.cronExpression || '';
    if (cron.startsWith('* ') || cron.startsWith('*/1 ')) {
      warnings.push('⚠️ التكرار كل دقيقة — ممكن يحمّل السيرفر');
    }
    const match = cron.match(/^\*\/(\d+)/);
    if (match && parseInt(match[1]) < 5) {
      blocks.push('❌ التكرار أقل من 5 دقائق — مرفوض');
    }
  }

  const hasWebhook = flowJson.trigger.type === 'WEBHOOK';
  const callsHttp = flowJson.actions.some(a =>
    a.pieceName?.includes('http') || a.pieceName?.includes('webhook')
  );
  if (hasWebhook && callsHttp) {
    warnings.push('⚠️ الـ Flow يستقبل webhook ويرسل HTTP — تأكد ما فيه حلقة');
  }

  if (flowJson.actions.length > 30) {
    blocks.push('❌ أكثر من 30 خطوة — قسم الـ Flow');
  }

  return { safe: blocks.length === 0, blocks, warnings };
}

module.exports = { validateFlowOutput, safeguardFlow, validateSchema };
