import express from 'express';
import { calculateAverageMessagesPerSession } from '../safety.js';

export function createMetricsRouter({ sessions, eventBus }) {
  const router = express.Router();

  /**
   * GET /api/metrics/summary
   * Total sessions, messages, avg session length, model distribution, experience distribution
   */
  router.get('/summary', (req, res) => {
    const allEvents = eventBus.getAll();
    const sessionStarts = allEvents.filter(e => e.event_type === 'session_start');
    const messagesSent = allEvents.filter(e => e.event_type === 'message_sent');

    // Model distribution from message_sent events
    const modelDist = {};
    messagesSent.forEach(e => {
      const key = e.model || 'unknown';
      modelDist[key] = (modelDist[key] || 0) + 1;
    });

    // Experience distribution
    const expDist = {};
    sessionStarts.forEach(e => {
      const key = e.experience || 'unknown';
      expDist[key] = (expDist[key] || 0) + 1;
    });

    // Avg messages per session (from active sessions)
    const sessionList = Array.from(sessions.values());
    const avgMessages = calculateAverageMessagesPerSession(allEvents, sessionList);

    res.json({
      success: true,
      summary: {
        totalSessions: new Set(sessionStarts.map((event) => event.session_id)).size,
        activeSessions: sessions.size,
        totalMessages: messagesSent.length,
        avgMessagesPerSession: avgMessages,
        modelDistribution: modelDist,
        experienceDistribution: expDist
      }
    });
  });

  /**
   * GET /api/metrics/safety
   * Input classifications, blocked inputs, output filter events over time
   */
  router.get('/safety', (req, res) => {
    const allEvents = eventBus.getAll();

    const classified = allEvents.filter(e => e.event_type === 'input_classified');
    const blocked = allEvents.filter(e => e.event_type === 'input_blocked');
    const filtered = allEvents.filter(e => e.event_type === 'output_filtered');

    const classificationBreakdown = { safe: 0, sensitive: 0, blocked: 0 };
    classified.forEach(e => {
      const cat = e.metadata?.category || 'safe';
      classificationBreakdown[cat] = (classificationBreakdown[cat] || 0) + 1;
    });

    const blockReasons = {};
    blocked.forEach(e => {
      const reason = e.metadata?.reason || 'unknown';
      blockReasons[reason] = (blockReasons[reason] || 0) + 1;
    });

    const filterTypes = {};
    filtered.forEach(e => {
      (e.metadata?.flags || []).forEach(f => {
        filterTypes[f.type] = (filterTypes[f.type] || 0) + 1;
      });
    });

    res.json({
      success: true,
      safety: {
        totalClassified: classified.length,
        classificationBreakdown,
        totalBlocked: blocked.length,
        blockReasons,
        totalOutputsFiltered: filtered.length,
        filterTypes,
        recentBlocked: blocked.slice(-10).map(e => ({
          timestamp: e.timestamp,
          session_id: e.session_id,
          reason: e.metadata?.reason
        }))
      }
    });
  });

  /**
   * GET /api/metrics/feedback
   * Positive/negative ratio per model and per experience
   */
  router.get('/feedback', (req, res) => {
    const allEvents = eventBus.getAll();
    const positive = allEvents.filter(e => e.event_type === 'feedback_positive');
    const negative = allEvents.filter(e => e.event_type === 'feedback_negative');

    const byModel = {};
    [...positive, ...negative].forEach(e => {
      const key = e.model || 'unknown';
      if (!byModel[key]) byModel[key] = { positive: 0, negative: 0 };
      if (e.event_type === 'feedback_positive') byModel[key].positive++;
      else byModel[key].negative++;
    });

    const byExperience = {};
    [...positive, ...negative].forEach(e => {
      const key = e.experience || 'unknown';
      if (!byExperience[key]) byExperience[key] = { positive: 0, negative: 0 };
      if (e.event_type === 'feedback_positive') byExperience[key].positive++;
      else byExperience[key].negative++;
    });

    res.json({
      success: true,
      feedback: {
        totalPositive: positive.length,
        totalNegative: negative.length,
        byModel,
        byExperience
      }
    });
  });

  /**
   * GET /api/metrics/errors
   * Error rate, error types, affected models
   */
  router.get('/errors', (req, res) => {
    const allEvents = eventBus.getAll();
    const errors = allEvents.filter(e => e.event_type === 'error');
    const messages = allEvents.filter(e => e.event_type === 'message_sent');

    const byModel = {};
    errors.forEach(e => {
      const key = e.model || 'unknown';
      byModel[key] = (byModel[key] || 0) + 1;
    });

    const errorRate = messages.length > 0
      ? ((errors.length / messages.length) * 100).toFixed(1)
      : '0.0';

    // Errors in the last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentErrors = eventBus.getSince(fiveMinAgo).filter(e => e.event_type === 'error');

    res.json({
      success: true,
      errors: {
        total: errors.length,
        errorRatePercent: Number(errorRate),
        byModel,
        recentCount: recentErrors.length,
        recent: recentErrors.slice(-10).map(e => ({
          timestamp: e.timestamp,
          session_id: e.session_id,
          model: e.model,
          error: e.metadata?.error
        }))
      }
    });
  });

  return router;
}
