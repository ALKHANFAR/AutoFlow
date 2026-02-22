/**
 * ═══════════════════════════════════════════════════════════
 * Flow Builder — يحول JSON إلى Flow حقيقي في Activepieces
 * ═══════════════════════════════════════════════════════════
 * يتعامل مع Activepieces REST API:
 * 1. إنشاء Flow فارغ
 * 2. تحديث الـ Trigger
 * 3. إضافة الـ Actions بالترتيب
 * 4. (اختياري) نشر الـ Flow
 */

class FlowBuilder {
  constructor(baseUrl, apiKey, projectId) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.projectId = projectId;
  }

  /**
   * بناء Flow كامل من AI output
   */
  async buildFlow(aiOutput, options = {}) {
    const { autoPublish = false, folderId = null } = options;

    // ── Step 1: إنشاء Flow فارغ ──────────────────────
    const flow = await this.api('POST', '/api/v1/flows', {
      displayName: aiOutput.displayName,
      projectId: this.projectId,
      ...(folderId && { folderId })
    });

    const flowId = flow.id;

    try {
      // ── Step 2: تحديث الـ Trigger ────────────────────
      await this.updateTrigger(flowId, aiOutput.trigger);

      // ── Step 3: إضافة الـ Actions بالترتيب ───────────
      let parentStep = 'trigger';
      let stepIndex = 1;

      for (const action of aiOutput.actions) {
        const stepName = await this.addAction(
          flowId,
          action,
          parentStep,
          stepIndex
        );
        // لو مو branch، الخطوة التالية تتبع هذي
        if (action.type !== 'BRANCH') {
          parentStep = stepName;
        } else {
          parentStep = stepName;
        }
        stepIndex++;
      }

      // ── Step 4: نشر (اختياري) ────────────────────────
      if (autoPublish) {
        await this.publishFlow(flowId);
      }

      return {
        success: true,
        flowId,
        flowUrl: `${this.baseUrl}/flows/${flowId}`,
        status: autoPublish ? 'PUBLISHED' : 'DRAFT',
        stepsCreated: stepIndex - 1
      };

    } catch (error) {
      // لو فيه خطأ بعد إنشاء الـ Flow — نحذفه
      try {
        await this.api('DELETE', `/api/v1/flows/${flowId}`);
      } catch (deleteErr) {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * تحديث الـ Trigger
   */
  async updateTrigger(flowId, trigger) {
    const settings = this.buildTriggerSettings(trigger);

    return this.api('POST', `/api/v1/flows/${flowId}`, {
      type: 'UPDATE_TRIGGER',
      request: {
        name: 'trigger',
        type: trigger.type === 'SCHEDULE'
          ? 'PIECE_TRIGGER'  // Schedule هو piece في AP
          : trigger.type,
        displayName: trigger.displayName,
        settings,
        valid: true
      }
    });
  }

  /**
   * بناء settings الـ Trigger
   */
  buildTriggerSettings(trigger) {
    if (trigger.type === 'SCHEDULE') {
      return {
        pieceName: '@activepieces/piece-schedule',
        pieceVersion: '~0.0.0',
        pieceType: 'OFFICIAL',
        packageType: 'REGISTRY',
        triggerName: trigger.triggerName || 'cron_expression',
        input: {
          cronExpression: trigger.input?.cronExpression || '0 8 * * *',
          timezone: trigger.input?.timezone || 'Asia/Riyadh'
        },
        inputUiInfo: {},
        propertySettings: {}
      };
    }

    if (trigger.type === 'WEBHOOK') {
      return {
        pieceName: '@activepieces/piece-webhook',
        pieceVersion: '~0.0.0',
        pieceType: 'OFFICIAL',
        packageType: 'REGISTRY',
        triggerName: 'catch_request',
        input: trigger.input || {},
        inputUiInfo: {},
        propertySettings: {}
      };
    }

    // PIECE_TRIGGER
    return {
      pieceName: trigger.pieceName,
      pieceVersion: '~0.0.0',
      pieceType: 'OFFICIAL',
      packageType: 'REGISTRY',
      triggerName: trigger.triggerName,
      input: trigger.input || {},
      inputUiInfo: {},
      propertySettings: {}
    };
  }

  /**
   * إضافة Action واحد
   */
  async addAction(flowId, action, parentStep, index) {
    const stepName = `step_${index}`;

    if (action.type === 'BRANCH') {
      return this.addBranch(flowId, action, parentStep, stepName, index);
    }

    const settings = this.buildActionSettings(action);

    await this.api('POST', `/api/v1/flows/${flowId}`, {
      type: 'ADD_ACTION',
      request: {
        parentStep,
        stepLocationRelativeToParent: 'AFTER',
        action: {
          name: stepName,
          type: action.type === 'CODE' ? 'CODE' : 'PIECE',
          displayName: action.displayName,
          settings,
          valid: true
        }
      }
    });

    return stepName;
  }

  /**
   * بناء settings الـ Action
   */
  buildActionSettings(action) {
    if (action.type === 'CODE') {
      return {
        input: {
          code: action.code || action.input?.code || '// Add your code here',
          ...(action.input || {})
        },
        inputUiInfo: {},
        propertySettings: {}
      };
    }

    return {
      pieceName: action.pieceName,
      pieceVersion: '~0.0.0',
      pieceType: 'OFFICIAL',
      packageType: 'REGISTRY',
      actionName: action.actionName,
      input: action.input || {},
      inputUiInfo: {},
      propertySettings: {}
    };
  }

  /**
   * إضافة Branch (تفرع شرطي)
   */
  async addBranch(flowId, action, parentStep, stepName, index) {
    // أولاً: إضافة الـ branch نفسه
    await this.api('POST', `/api/v1/flows/${flowId}`, {
      type: 'ADD_ACTION',
      request: {
        parentStep,
        stepLocationRelativeToParent: 'AFTER',
        action: {
          name: stepName,
          type: 'BRANCH',
          displayName: action.displayName,
          settings: {
            conditions: action.conditions || [[{
              firstValue: '',
              operator: 'TEXT_EXACTLY_MATCHES',
              secondValue: '',
              caseSensitive: false
            }]]
          },
          valid: true
        }
      }
    });

    // إضافة actions داخل الـ true branch
    if (action.onSuccessActions && action.onSuccessActions.length > 0) {
      let branchParent = stepName;
      let subIndex = 1;
      for (const subAction of action.onSuccessActions) {
        const subStepName = `${stepName}_true_${subIndex}`;
        const subSettings = this.buildActionSettings(subAction);

        await this.api('POST', `/api/v1/flows/${flowId}`, {
          type: 'ADD_ACTION',
          request: {
            parentStep: branchParent,
            stepLocationRelativeToParent: subIndex === 1 ? 'INSIDE_TRUE_BRANCH' : 'AFTER',
            branchIndex: 0,
            action: {
              name: subStepName,
              type: subAction.type === 'CODE' ? 'CODE' : 'PIECE',
              displayName: subAction.displayName,
              settings: subSettings,
              valid: true
            }
          }
        });

        branchParent = subStepName;
        subIndex++;
      }
    }

    // إضافة actions داخل الـ false branch
    if (action.onFailureActions && action.onFailureActions.length > 0) {
      let branchParent = stepName;
      let subIndex = 1;
      for (const subAction of action.onFailureActions) {
        const subStepName = `${stepName}_false_${subIndex}`;
        const subSettings = this.buildActionSettings(subAction);

        await this.api('POST', `/api/v1/flows/${flowId}`, {
          type: 'ADD_ACTION',
          request: {
            parentStep: branchParent,
            stepLocationRelativeToParent: subIndex === 1 ? 'INSIDE_FALSE_BRANCH' : 'AFTER',
            branchIndex: 0,
            action: {
              name: subStepName,
              type: subAction.type === 'CODE' ? 'CODE' : 'PIECE',
              displayName: subAction.displayName,
              settings: subSettings,
              valid: true
            }
          }
        });

        branchParent = subStepName;
        subIndex++;
      }
    }

    return stepName;
  }

  /**
   * نشر الـ Flow
   */
  async publishFlow(flowId) {
    return this.api('POST', `/api/v1/flows/${flowId}`, {
      type: 'LOCK_AND_PUBLISH',
      request: {}
    });
  }

  /**
   * تغيير حالة الـ Flow (enable/disable)
   */
  async setFlowStatus(flowId, enabled) {
    return this.api('POST', `/api/v1/flows/${flowId}`, {
      type: 'CHANGE_STATUS',
      request: {
        status: enabled ? 'ENABLED' : 'DISABLED'
      }
    });
  }

  /**
   * حذف Flow
   */
  async deleteFlow(flowId) {
    return this.api('DELETE', `/api/v1/flows/${flowId}`);
  }

  /**
   * جلب تفاصيل Flow
   */
  async getFlow(flowId) {
    return this.api('GET', `/api/v1/flows/${flowId}`);
  }

  /**
   * استعراض كل الـ Flows
   */
  async listFlows(limit = 50) {
    return this.api('GET', `/api/v1/flows?limit=${limit}&projectId=${this.projectId}`);
  }

  /**
   * جلب الاتصالات
   */
  async listConnections() {
    return this.api('GET', `/api/v1/connections?projectId=${this.projectId}`);
  }

  /**
   * جلب سجل التنفيذ
   */
  async listRuns(flowId, limit = 10) {
    const query = flowId
      ? `?flowId=${flowId}&limit=${limit}`
      : `?limit=${limit}&projectId=${this.projectId}`;
    return this.api('GET', `/api/v1/flow-runs${query}`);
  }

  /**
   * API call helper
   */
  async api(method, path, body = null) {
    const { getToken } = require('./auth');
    const token = await getToken();
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new FlowBuilderError(
        `Activepieces API Error: ${response.status}`,
        response.status,
        errorText,
        path
      );
    }

    // DELETE ممكن يرجع 204 بدون body
    if (response.status === 204) return { success: true };

    return response.json();
  }
}

class FlowBuilderError extends Error {
  constructor(message, statusCode, apiResponse, path) {
    super(message);
    this.name = 'FlowBuilderError';
    this.statusCode = statusCode;
    this.apiResponse = apiResponse;
    this.path = path;
  }
}

module.exports = { FlowBuilder, FlowBuilderError };
