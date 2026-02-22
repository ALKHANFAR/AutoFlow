/**
 * ═══════════════════════════════════════════════════════════
 * AI Engine — يدعم عدة مزودين (مفتوح المصدر + تجاري)
 * ═══════════════════════════════════════════════════════════
 * 
 *  المزود         │ النماذج              │ التكلفة          │ السرعة
 *  ───────────────┼──────────────────────┼──────────────────┼────────
 *  Groq           │ Llama 3.3 70B        │ مجاني تقريباً   │ ⚡⚡⚡
 *  OpenRouter     │ 30+ نموذج مجاني     │ مجاني/رخيص      │ ⚡⚡
 *  Ollama (محلي)  │ أي نموذج            │ مجاني 100%      │ ⚡
 *  Anthropic      │ Claude Sonnet        │ $3/M tokens      │ ⚡⚡
 */

const { validateFlowOutput } = require('./validation');

// ─── Provider Configs ────────────────────────────────────

const PROVIDERS = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'qwen/qwen-2.5-72b-instruct',
  },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    envKey: null,
    defaultModel: 'qwen2.5:14b',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    isAnthropicFormat: true,
  }
};

// ─── System Prompt ───────────────────────────────────────

const SYSTEM_PROMPT = `أنت "Flow Architect" — خبير في تحويل الأوامر النصية (عربي أو إنجليزي) إلى Activepieces workflows.

## مهمتك:
حول طلب المستخدم إلى JSON يمثل Activepieces Flow قابل للتنفيذ.

## قواعد صارمة:
1. كل Flow يبدأ بـ trigger واحد فقط
2. الـ actions تكون مصفوفة مرتبة
3. استخدم فقط الـ pieces المتاحة في PIECES_CATALOG
4. لو ذكر وقت/جدول/يومياً → trigger type = "SCHEDULE"
5. لو ذكر "لما يجي/عند/إذا وصل" → trigger type = "PIECE_TRIGGER" أو "WEBHOOK"
6. لو فيه شرط "لو/إذا" → action type = "BRANCH"
7. رجع JSON فقط — بدون أي نص أو markdown

## أنواع الـ Triggers:
- SCHEDULE: مجدول (cron) — piece: @activepieces/piece-schedule
- PIECE_TRIGGER: حدث من تطبيق
- WEBHOOK: رابط يستقبل بيانات — piece: @activepieces/piece-webhook

## أنواع الـ Actions:
- PIECE: استخدام piece موجود
- BRANCH: تفرع شرطي — يحتاج conditions + onSuccessActions + onFailureActions
- CODE: كود JavaScript مخصص

## قواعد SCHEDULE:
- "كل يوم": "0 8 * * *"
- "كل ساعة": "0 * * * *"
- "كل اثنين": "0 8 * * 1"
- timezone دائماً: "Asia/Riyadh"

## هيكل JSON المطلوب:
{
  "displayName": "اسم واضح",
  "trigger": {
    "type": "SCHEDULE | PIECE_TRIGGER | WEBHOOK",
    "pieceName": "@activepieces/piece-xxx",
    "triggerName": "trigger-name",
    "displayName": "وصف",
    "input": {}
  },
  "actions": [
    {
      "type": "PIECE",
      "pieceName": "@activepieces/piece-xxx",
      "actionName": "action-name",
      "displayName": "وصف",
      "input": {}
    }
  ],
  "connections_needed": [],
  "explanation_ar": "شرح بالعربي سطرين"
}

## مهم:
- رجع JSON فقط بدون backticks أو كلام
- لو الطلب مو ممكن: {"error": "السبب"}
- الـ data بين الخطوات: {{trigger.field}} أو {{step_1.field}}`;

// ─── Get Active Provider ─────────────────────────────────

function getActiveProvider() {
  const id = (process.env.AI_PROVIDER || 'groq').toLowerCase();
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`مزود غير معروف: ${id}. الخيارات: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  return {
    ...provider,
    id,
    baseUrl: process.env.AI_BASE_URL || provider.baseUrl,
    activeModel: process.env.AI_MODEL || provider.defaultModel,
    apiKey: process.env.AI_API_KEY ||
      (provider.envKey ? process.env[provider.envKey] : null) ||
      process.env.ANTHROPIC_API_KEY || 'not-needed'
  };
}

// ─── OpenAI-Compatible Call (Groq, OpenRouter, Ollama) ───

async function callOpenAI(provider, systemPrompt, messages, temperature) {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Ollama لا يحتاج مفتاح
  if (provider.id !== 'ollama') {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  // OpenRouter يحتاج headers إضافية
  if (provider.id === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'https://prompt-to-automation.app';
    headers['X-Title'] = 'Prompt-to-Automation';
  }

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.activeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature,
      max_tokens: 4000,
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`${provider.name} API Error ${response.status}:`, err);
    throw new AIEngineError(`${provider.name} API Error: ${response.status} — ${err.substring(0, 200)}`, 'API_ERROR', err);
  }

  const data = await response.json();
  return { text: data.choices[0].message.content, usage: data.usage || {} };
}

// ─── Anthropic Call ──────────────────────────────────────

async function callAnthropic(provider, systemPrompt, messages, temperature) {
  const response = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: provider.activeModel,
      max_tokens: 4000,
      temperature,
      system: systemPrompt,
      messages
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new AIEngineError(`Anthropic Error: ${response.status}`, 'API_ERROR', err);
  }

  const data = await response.json();
  return { text: data.content[0].text, usage: data.usage || {} };
}

// ─── Unified Call ────────────────────────────────────────

async function callAI(systemPrompt, messages, temperature = 0.1) {
  const provider = getActiveProvider();
  if (provider.isAnthropicFormat) {
    return callAnthropic(provider, systemPrompt, messages, temperature);
  }
  return callOpenAI(provider, systemPrompt, messages, temperature);
}

// ─── Convert Text → Flow ─────────────────────────────────

async function convertToFlow(userMessage, piecesRegistry, conversationHistory = []) {
  const catalog = piecesRegistry.getCompactListForAI();
  // Limit catalog to avoid exceeding context window
  const limitedCatalog = catalog.slice(0, 50);
  const fullPrompt = SYSTEM_PROMPT + `\n\n## PIECES_CATALOG (${catalog.length} total, showing top ${limitedCatalog.length}):\n${JSON.stringify(limitedCatalog, null, 2)}`;

  const messages = [...conversationHistory, { role: 'user', content: userMessage }];
  
  let result;
  try {
    result = await callAI(fullPrompt, messages);
  } catch (err) {
    console.error('AI call failed:', err.message);
    throw new AIEngineError(`AI call failed: ${err.message}`, 'AI_CALL_FAILED', err.message);
  }
  
  const raw = result.text.trim();

  // Extract JSON
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new AIEngineError('AI ما رجع JSON صحيح', 'INVALID_RESPONSE', raw);
  }

  let flowJson;
  try {
    flowJson = JSON.parse(jsonMatch[0]);
  } catch (e) {
    // Fix trailing commas
    try {
      flowJson = JSON.parse(jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
    } catch (e2) {
      throw new AIEngineError('JSON parsing failed', 'PARSE_ERROR', raw);
    }
  }

  const validation = validateFlowOutput(flowJson, piecesRegistry);
  if (!validation.valid && validation.errors.length > 0 && !validation.isUserError) {
    return retryWithErrors(userMessage, flowJson, validation.errors, catalog);
  }

  return {
    success: true,
    flow: flowJson,
    warnings: validation.warnings || [],
    tokensUsed: result.usage,
    provider: getActiveProvider().name
  };
}

// ─── Retry ───────────────────────────────────────────────

async function retryWithErrors(originalMsg, failedJson, errors, catalog) {
  const prompt = `صلح الأخطاء التالية في الـ JSON ورجع JSON صحيح فقط:

الأخطاء:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

JSON الأصلي:
${JSON.stringify(failedJson, null, 2)}

الطلب: ${originalMsg}`;

  const fullPrompt = SYSTEM_PROMPT + `\n\n## PIECES_CATALOG:\n${JSON.stringify(catalog, null, 2)}`;
  const result = await callAI(fullPrompt, [{ role: 'user', content: prompt }], 0);
  const match = result.text.trim().match(/\{[\s\S]*\}/);

  if (!match) throw new AIEngineError('فشلت إعادة المحاولة', 'RETRY_FAILED', result.text);

  return {
    success: true,
    flow: JSON.parse(match[0]),
    retried: true,
    warnings: ['تم إعادة التوليد بعد تصحيح أخطاء'],
    tokensUsed: result.usage
  };
}

// ─── Explain Flow ────────────────────────────────────────

async function generateFlowExplanation(flowJson) {
  const result = await callAI(
    'اشرح workflows بالعربي باختصار.',
    [{ role: 'user', content: `اشرح هذا (3 أسطر):\n${JSON.stringify(flowJson)}` }],
    0.3
  );
  return result.text.trim();
}

// ─── Provider Info ───────────────────────────────────────

function getProviderInfo() {
  const p = getActiveProvider();
  return { provider: p.name, model: p.activeModel, hasApiKey: !!p.apiKey && p.apiKey !== 'not-needed' };
}

// ─── Error Class ─────────────────────────────────────────

class AIEngineError extends Error {
  constructor(message, code, rawResponse) {
    super(message);
    this.name = 'AIEngineError';
    this.code = code;
    this.rawResponse = rawResponse;
  }
}

module.exports = { convertToFlow, generateFlowExplanation, getProviderInfo, AIEngineError, PROVIDERS };
