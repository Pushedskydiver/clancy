import { describe, expect, it } from 'vitest';

import {
  buildSlackPayload,
  buildTeamsPayload,
  isSlackWebhook,
} from './notify.js';

describe('notify', () => {
  describe('isSlackWebhook', () => {
    it('returns true for Slack URLs', () => {
      expect(
        isSlackWebhook('https://hooks.slack.com/services/T00/B00/xxx'),
      ).toBe(true);
    });

    it('returns false for non-Slack URLs', () => {
      expect(
        isSlackWebhook('https://example.webhook.office.com/webhook/xxx'),
      ).toBe(false);
    });
  });

  describe('buildSlackPayload', () => {
    it('builds a simple text payload', () => {
      const payload = JSON.parse(buildSlackPayload('hello'));
      expect(payload).toEqual({ text: 'hello' });
    });
  });

  describe('buildTeamsPayload', () => {
    it('builds an adaptive card payload', () => {
      const payload = JSON.parse(buildTeamsPayload('hello'));

      expect(payload.type).toBe('message');
      expect(payload.attachments).toHaveLength(1);
      expect(payload.attachments[0].contentType).toBe(
        'application/vnd.microsoft.card.adaptive',
      );
      expect(payload.attachments[0].content.body[0].text).toBe('hello');
    });
  });
});
