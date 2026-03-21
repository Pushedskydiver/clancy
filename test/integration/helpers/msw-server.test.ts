import { http, HttpResponse } from 'msw';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';

import { parseJson } from '~/utils/parse-json/parse-json.js';

import {
  createIntegrationServer,
  startServer,
  stopServer,
} from './msw-server.js';

describe('msw-server', () => {
  describe('REST interception', () => {
    const server = createIntegrationServer(
      http.get('https://example.com/api/test', () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    beforeAll(() => startServer(server));
    afterAll(() => stopServer(server));

    it('intercepts a handled REST URL and returns mock response', async () => {
      const res = await fetch('https://example.com/api/test');
      const data = await res.json();
      expect(data).toEqual({ ok: true });
    });

    it('throws on unhandled URLs (onUnhandledRequest: error)', async () => {
      await expect(
        fetch('https://example.com/api/unhandled'),
      ).rejects.toThrow();
    });
  });

  describe('GraphQL interception', () => {
    const server = createIntegrationServer(
      http.post('https://example.com/graphql', async ({ request }) => {
        const body = (await request.json()) as { query: string };
        if (body.query.includes('viewer')) {
          return HttpResponse.json({ data: { viewer: { id: '1' } } });
        }
        return HttpResponse.json(
          { errors: [{ message: 'Unknown query' }] },
          { status: 400 },
        );
      }),
    );

    beforeAll(() => startServer(server));
    afterAll(() => stopServer(server));

    it('intercepts GraphQL POST and routes by query content', async () => {
      const res = await fetch('https://example.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ viewer { id } }' }),
      });
      const data = await res.json();
      expect(data).toEqual({ data: { viewer: { id: '1' } } });
    });

    it('returns 400 for unmatched GraphQL queries', async () => {
      const res = await fetch('https://example.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ unknownField }' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('import resolution', () => {
    it('resolves ~/ path alias to src/', () => {
      // Verify the parseJson import from src/ resolved correctly
      expect(typeof parseJson).toBe('function');
      const result = parseJson('{"a":1}');
      expect(result).toEqual({ a: 1 });
    });
  });
});
