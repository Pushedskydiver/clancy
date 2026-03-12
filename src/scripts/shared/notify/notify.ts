/**
 * Webhook notification sender for Slack and Microsoft Teams.
 *
 * Sends completion notifications after a ticket is processed.
 * Best-effort — never throws on failure.
 */

/**
 * Detect whether a webhook URL is for Slack (vs Teams/other).
 *
 * @param url - The webhook URL to check.
 * @returns `true` if the URL contains `hooks.slack.com`.
 */
export function isSlackWebhook(url: string): boolean {
  return url.includes('hooks.slack.com');
}

/**
 * Build a Slack webhook payload.
 *
 * @param message - The notification message text.
 * @returns The JSON payload string for a Slack incoming webhook.
 */
export function buildSlackPayload(message: string): string {
  return JSON.stringify({ text: message });
}

/**
 * Build a Microsoft Teams webhook payload using an adaptive card.
 *
 * @param message - The notification message text.
 * @returns The JSON payload string for a Teams incoming webhook.
 */
export function buildTeamsPayload(message: string): string {
  return JSON.stringify({
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: message,
              wrap: true,
            },
          ],
        },
      },
    ],
  });
}

/**
 * Send a notification to a webhook URL.
 *
 * Automatically detects Slack vs Teams format based on the URL.
 * Best-effort — logs a warning on failure but never throws.
 *
 * @param webhookUrl - The Slack or Teams webhook URL.
 * @param message - The notification message to send.
 *
 * @example
 * ```ts
 * await sendNotification(
 *   'https://hooks.slack.com/services/xxx/yyy/zzz',
 *   '✓ Clancy completed [PROJ-123] Add login page',
 * );
 * ```
 */
export async function sendNotification(
  webhookUrl: string,
  message: string,
): Promise<void> {
  const payload = isSlackWebhook(webhookUrl)
    ? buildSlackPayload(message)
    : buildTeamsPayload(message);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    if (!response.ok) {
      console.warn(`⚠ Notification failed: HTTP ${response.status}`);
    }
  } catch {
    console.warn('⚠ Notification failed: could not reach webhook');
  }
}
