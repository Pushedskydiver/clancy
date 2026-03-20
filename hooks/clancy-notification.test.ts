import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getNotifier, extractMessage } = require(resolve(
  __dirname,
  'clancy-notification.js',
));

describe('clancy-notification', () => {
  describe('getNotifier', () => {
    it('returns a function for the current platform', () => {
      const notifier = getNotifier();
      // On macOS/Linux/Windows it should return a function; on other platforms null
      const platform = process.platform;
      if (['darwin', 'linux', 'win32'].includes(platform)) {
        expect(typeof notifier).toBe('function');
      } else {
        expect(notifier).toBeNull();
      }
    });

    it('returned function has a name reflecting the platform', () => {
      const notifier = getNotifier();
      if (!notifier) return; // skip on unsupported platforms

      const platform = process.platform;
      if (platform === 'darwin') {
        expect(notifier.name).toBe('notifyMac');
      } else if (platform === 'linux') {
        expect(notifier.name).toBe('notifyLinux');
      } else if (platform === 'win32') {
        expect(notifier.name).toBe('notifyWindows');
      }
    });
  });

  describe('extractMessage', () => {
    it('extracts message field', () => {
      expect(extractMessage({ message: 'hello' })).toBe('hello');
    });

    it('extracts notification field', () => {
      expect(extractMessage({ notification: 'done' })).toBe('done');
    });

    it('extracts text field', () => {
      expect(extractMessage({ text: 'update' })).toBe('update');
    });

    it('extracts hookSpecificOutput.message', () => {
      expect(
        extractMessage({ hookSpecificOutput: { message: 'from hook' } }),
      ).toBe('from hook');
    });

    it('returns default message when no field found', () => {
      expect(extractMessage({})).toBe('Clancy notification');
    });

    it('prefers message over other fields', () => {
      expect(
        extractMessage({ message: 'primary', text: 'secondary' }),
      ).toBe('primary');
    });
  });

  describe('env var disable', () => {
    it('module exports are available for unit testing', () => {
      expect(typeof getNotifier).toBe('function');
      expect(typeof extractMessage).toBe('function');
    });
  });
});
