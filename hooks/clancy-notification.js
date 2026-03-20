#!/usr/bin/env node
// Clancy Desktop Notification — Notification hook.
// Sends native OS desktop notifications when Claude fires a Notification event.
// Best-effort — never crashes, exit 0 on any error.
//
// Controllable via CLANCY_DESKTOP_NOTIFY=false to suppress.
//
// Platform detection:
//   macOS:   osascript -e 'display notification "msg" with title "Clancy"'
//   Linux:   notify-send "Clancy" "msg"
//   Windows: PowerShell [System.Windows.Forms.MessageBox]::Show("msg", "Clancy")

'use strict';

const { execFileSync } = require('child_process');
const os = require('os');

/**
 * Detect the platform and return a function that sends a notification.
 * Returns null if the platform is unsupported.
 */
function getNotifier() {
  const platform = os.platform();

  if (platform === 'darwin') {
    return function notifyMac(message) {
      const escaped = message.replace(/"/g, '\\"');
      execFileSync('osascript', [
        '-e',
        `display notification "${escaped}" with title "Clancy"`,
      ], { timeout: 5000, windowsHide: true });
    };
  }

  if (platform === 'linux') {
    return function notifyLinux(message) {
      execFileSync('notify-send', ['Clancy', message], {
        timeout: 5000,
        windowsHide: true,
      });
    };
  }

  if (platform === 'win32') {
    return function notifyWindows(message) {
      const escaped = message.replace(/"/g, '`"');
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("${escaped}", "Clancy")`,
      ], { timeout: 5000, windowsHide: true });
    };
  }

  return null;
}

/**
 * Extract a message string from the hook event payload.
 */
function extractMessage(data) {
  // Notification events may carry a message in various shapes
  if (data.message && typeof data.message === 'string') return data.message;
  if (data.notification && typeof data.notification === 'string') return data.notification;
  if (data.text && typeof data.text === 'string') return data.text;
  if (data.hookSpecificOutput && data.hookSpecificOutput.message) return data.hookSpecificOutput.message;
  return 'Clancy notification';
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    // Check if notifications are disabled
    if (process.env.CLANCY_DESKTOP_NOTIFY === 'false') {
      process.exit(0);
    }

    const data = JSON.parse(input);
    const message = extractMessage(data);

    const notifier = getNotifier();
    if (notifier) {
      try {
        notifier(message);
      } catch {
        // OS command failed — fall back to console.log
        console.log(`[Clancy] ${message}`);
      }
    } else {
      // Unsupported platform — fall back to console.log
      console.log(`[Clancy] ${message}`);
    }
  } catch {
    process.exit(0);
  }
});

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = { getNotifier, extractMessage };
}
