/**
 * ═══════════════════════════════════════════════════════════
 * Pieces Registry — كاش محلي لكل الـ Pieces المتاحة
 * ═══════════════════════════════════════════════════════════
 * يجلب من Activepieces API ويبني index سريع
 * يُستخدم مع AI Engine للتحقق والمطابقة
 */

class PiecesRegistry {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.pieces = {};
    this.lastSync = null;
    this.categories = {};
  }

  /**
   * مزامنة كاملة مع Activepieces
   */
  async sync() {
    let piecesData = [];

    try {
      const { getToken } = require('./auth');
      let token;
      try {
        token = await getToken();
      } catch (authErr) {
        console.warn('Auth failed:', authErr.message, '— using fallback catalog');
        this._loadFallback();
        return this.pieces;
      }

      // Try paginated endpoint first
      const response = await fetch(`${this.baseUrl}/api/v1/pieces?limit=500`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.warn(`Pieces API returned ${response.status} — using fallback catalog`);
        this._loadFallback();
        return this.pieces;
      }

      const body = await response.json();
      // Handle both array and paginated {data:[]} formats
      piecesData = Array.isArray(body) ? body : (body.data || []);
    } catch (err) {
      console.warn('Pieces sync failed:', err.message, '— using fallback catalog');
      this._loadFallback();
      return this.pieces;
    }

    if (piecesData.length === 0) {
      console.warn('No pieces returned — using fallback catalog');
      this._loadFallback();
      return this.pieces;
    }

    this.pieces = {};
    this.categories = {};

    for (const piece of piecesData) {
      const entry = {
        name: piece.name,
        displayName: piece.displayName,
        description: piece.description || '',
        version: piece.version,
        logoUrl: piece.logoUrl || '',
        categories: piece.categories || [],
        triggers: {},
        actions: {}
      };

      // فهرسة الـ Triggers
      if (piece.triggers) {
        for (const [key, trigger] of Object.entries(piece.triggers)) {
          entry.triggers[key] = {
            name: key,
            displayName: trigger.displayName,
            description: trigger.description || '',
            props: trigger.props || {},
            type: trigger.type || 'POLLING'
          };
        }
      }

      // فهرسة الـ Actions
      if (piece.actions) {
        for (const [key, action] of Object.entries(piece.actions)) {
          entry.actions[key] = {
            name: key,
            displayName: action.displayName,
            description: action.description || '',
            props: action.props || {},
            requireAuth: action.requireAuth !== false
          };
        }
      }

      this.pieces[piece.name] = entry;

      // فهرسة حسب الفئة
      for (const cat of entry.categories) {
        if (!this.categories[cat]) this.categories[cat] = [];
        this.categories[cat].push(piece.name);
      }
    }

    this.lastSync = new Date();
    return this.pieces;
  }

  /**
   * التحقق من piece + action/trigger
   */
  validate(pieceName, actionOrTriggerName = null) {
    const piece = this.pieces[pieceName];
    if (!piece) {
      return {
        valid: false,
        error: `Piece "${pieceName}" مو موجود`,
        suggestion: this.findSimilar(pieceName)
      };
    }

    if (actionOrTriggerName) {
      const hasAction = piece.actions[actionOrTriggerName];
      const hasTrigger = piece.triggers[actionOrTriggerName];

      if (!hasAction && !hasTrigger) {
        return {
          valid: false,
          error: `"${actionOrTriggerName}" مو موجود في ${piece.displayName}`,
          availableActions: Object.keys(piece.actions),
          availableTriggers: Object.keys(piece.triggers)
        };
      }
    }

    return { valid: true, piece };
  }

  /**
   * البحث عن pieces مشابهة (لما AI يغلط)
   */
  findSimilar(name) {
    const lower = name.toLowerCase();
    return Object.keys(this.pieces)
      .filter(p => p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase()))
      .slice(0, 5);
  }

  /**
   * بناء ملخص خفيف للـ AI prompt
   * (لا نرسل كل التفاصيل — فقط الأسماء والوصف)
   */
  getCompactListForAI() {
    return Object.values(this.pieces).map(p => ({
      name: p.name,
      displayName: p.displayName,
      description: (p.description || '').substring(0, 100),
      triggers: Object.entries(p.triggers || {}).map(([k, v]) => ({
        name: k,
        displayName: v.displayName || k
      })),
      actions: Object.entries(p.actions || {}).map(([k, v]) => ({
        name: k,
        displayName: v.displayName || k
      }))
    }));
  }

  /**
   * جلب تفاصيل piece واحد (للعرض في الواجهة)
   */
  getPiece(name) {
    return this.pieces[name] || null;
  }

  /**
   * إحصائيات
   */
  getStats() {
    const totalPieces = Object.keys(this.pieces).length;
    let totalTriggers = 0;
    let totalActions = 0;

    for (const piece of Object.values(this.pieces)) {
      totalTriggers += Object.keys(piece.triggers).length;
      totalActions += Object.keys(piece.actions).length;
    }

    return {
      totalPieces,
      totalTriggers,
      totalActions,
      lastSync: this.lastSync,
      categories: Object.keys(this.categories)
    };
  }

  /**
   * Fallback catalog — الأساسيات لو API ما اشتغل
   */
  _loadFallback() {
    const fallback = [
      { name: '@activepieces/piece-gmail', displayName: 'Gmail', triggers: { 'new-email': { name: 'new-email', displayName: 'New Email' } }, actions: { 'send-email': { name: 'send-email', displayName: 'Send Email' }, 'read-email': { name: 'read-email', displayName: 'Read Email' } } },
      { name: '@activepieces/piece-slack', displayName: 'Slack', triggers: { 'new-message': { name: 'new-message', displayName: 'New Message' } }, actions: { 'send-channel-message': { name: 'send-channel-message', displayName: 'Send Message to Channel' }, 'send-direct-message': { name: 'send-direct-message', displayName: 'Send Direct Message' } } },
      { name: '@activepieces/piece-google-sheets', displayName: 'Google Sheets', triggers: { 'new-row-added': { name: 'new-row-added', displayName: 'New Row Added' } }, actions: { 'insert-row': { name: 'insert-row', displayName: 'Insert Row' }, 'update-row': { name: 'update-row', displayName: 'Update Row' } } },
      { name: '@activepieces/piece-schedule', displayName: 'Schedule', triggers: { 'cron_expression': { name: 'cron_expression', displayName: 'Cron Expression' }, 'every_hour': { name: 'every_hour', displayName: 'Every Hour' }, 'every_day': { name: 'every_day', displayName: 'Every Day' } }, actions: {} },
      { name: '@activepieces/piece-webhook', displayName: 'Webhook', triggers: { 'webhook': { name: 'webhook', displayName: 'Catch Webhook' } }, actions: {} },
      { name: '@activepieces/piece-http', displayName: 'HTTP', triggers: {}, actions: { 'send-request': { name: 'send-request', displayName: 'Send HTTP Request' } } },
      { name: '@activepieces/piece-openai', displayName: 'OpenAI', triggers: {}, actions: { 'ask-chatgpt': { name: 'ask-chatgpt', displayName: 'Ask ChatGPT' }, 'generate-image': { name: 'generate-image', displayName: 'Generate Image' } } },
      { name: '@activepieces/piece-notion', displayName: 'Notion', triggers: { 'new-database-item': { name: 'new-database-item', displayName: 'New Database Item' } }, actions: { 'create-database-item': { name: 'create-database-item', displayName: 'Create Database Item' }, 'update-database-item': { name: 'update-database-item', displayName: 'Update Database Item' } } },
      { name: '@activepieces/piece-telegram-bot', displayName: 'Telegram Bot', triggers: { 'new-message': { name: 'new-message', displayName: 'New Message' } }, actions: { 'send-text-message': { name: 'send-text-message', displayName: 'Send Text Message' } } },
      { name: '@activepieces/piece-discord', displayName: 'Discord', triggers: { 'new-message': { name: 'new-message', displayName: 'New Message' } }, actions: { 'send-message-webhook': { name: 'send-message-webhook', displayName: 'Send Message (Webhook)' } } },
      { name: '@activepieces/piece-airtable', displayName: 'Airtable', triggers: { 'new-record': { name: 'new-record', displayName: 'New Record' } }, actions: { 'create-record': { name: 'create-record', displayName: 'Create Record' } } },
      { name: '@activepieces/piece-hubspot', displayName: 'HubSpot', triggers: { 'new-contact': { name: 'new-contact', displayName: 'New Contact' } }, actions: { 'create-contact': { name: 'create-contact', displayName: 'Create Contact' }, 'update-contact': { name: 'update-contact', displayName: 'Update Contact' } } },
      { name: '@activepieces/piece-whatsapp', displayName: 'WhatsApp', triggers: {}, actions: { 'send-message': { name: 'send-message', displayName: 'Send Message' } } },
      { name: '@activepieces/piece-google-calendar', displayName: 'Google Calendar', triggers: { 'new-event': { name: 'new-event', displayName: 'New Event' } }, actions: { 'create-event': { name: 'create-event', displayName: 'Create Event' } } },
      { name: '@activepieces/piece-google-drive', displayName: 'Google Drive', triggers: { 'new-file': { name: 'new-file', displayName: 'New File' } }, actions: { 'upload-file': { name: 'upload-file', displayName: 'Upload File' } } },
      { name: '@activepieces/piece-linkedin', displayName: 'LinkedIn', triggers: {}, actions: { 'create-share-update': { name: 'create-share-update', displayName: 'Create Share Update' } } },
      { name: '@activepieces/piece-twitter', displayName: 'Twitter/X', triggers: {}, actions: { 'create-tweet': { name: 'create-tweet', displayName: 'Create Tweet' } } },
      { name: '@activepieces/piece-trello', displayName: 'Trello', triggers: { 'new-card': { name: 'new-card', displayName: 'New Card' } }, actions: { 'create-card': { name: 'create-card', displayName: 'Create Card' } } },
    ];

    this.pieces = {};
    this.categories = {};

    for (const p of fallback) {
      this.pieces[p.name] = {
        name: p.name,
        displayName: p.displayName,
        description: '',
        version: '0.0.1',
        logoUrl: '',
        categories: [],
        triggers: p.triggers || {},
        actions: p.actions || {}
      };
    }

    this.lastSync = new Date();
    console.log(`Loaded ${Object.keys(this.pieces).length} fallback pieces`);
  }
}

module.exports = { PiecesRegistry };
