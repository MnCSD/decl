import { execFile } from 'node:child_process';

/**
 * Runs a program and returns its stdout.
 * - execFile (not exec) passes args directly with no shell, so nothing can be injected.
 * - windowsHide stops a console window from flashing on screen each time.
 * - extraEnv is how we hand data to scripts (instead of pasting it into script text).
 */
export function run(file: string, args: string[], timeoutMs = 5000, extraEnv?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

/** Runs a fixed PowerShell script. Never build `script` from network input; pass data via extraEnv. */
export function runPowerShell(script: string, timeoutMs = 8000, extraEnv?: Record<string, string>): Promise<string> {
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    timeoutMs,
    extraEnv,
  );
}
