import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSlackPayload,
  buildTeamsPayload,
  isSlackWebhook,
  sendNotification,
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

  describe('sendNotification', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends Slack payload for slack.com webhooks', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await sendNotification(
        'https://hooks.slack.com/services/T00/B00/xxx',
        'hello',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/T00/B00/xxx',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'hello' }),
        }),
      );
    });

    it('sends Teams payload for office.com webhooks', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await sendNotification(
        'https://example.webhook.office.com/webhook/xxx',
        'hello',
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(callBody.type).toBe('message');
      expect(callBody.attachments[0].contentType).toBe(
        'application/vnd.microsoft.card.adaptive',
      );
    });

    it('does not throw on fetch failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      await expect(
        sendNotification(
          'https://hooks.slack.com/services/T00/B00/xxx',
          'hello',
        ),
      ).resolves.toBeUndefined();
    });
  });
});
