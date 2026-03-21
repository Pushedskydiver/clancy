/**
 * MSW server helper for integration tests.
 *
 * Provides factory functions for creating, starting, resetting, and stopping
 * MSW SetupServer instances. Each test file should create its own server
 * to avoid handler leakage between tests.
 */
import { type RequestHandler } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';

/**
 * Create a new MSW server instance with optional initial handlers.
 */
export function createIntegrationServer(
  ...handlers: RequestHandler[]
): SetupServer {
  return setupServer(...handlers);
}

/**
 * Start the server with strict unhandled request checking.
 * Any fetch to an unhandled URL will throw — no silent pass-through.
 */
export function startServer(server: SetupServer): void {
  server.listen({ onUnhandledRequest: 'error' });
}

/**
 * Reset handlers to initial state (remove any per-test overrides).
 */
export function resetServer(server: SetupServer): void {
  server.resetHandlers();
}

/**
 * Stop the server and clean up.
 */
export function stopServer(server: SetupServer): void {
  server.close();
}
