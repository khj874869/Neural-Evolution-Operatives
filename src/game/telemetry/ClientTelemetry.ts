export interface ClientErrorReport {
  type: 'runtime' | 'promise';
  message: string;
  fingerprint: string;
}
export function createClientErrorReport(type: ClientErrorReport['type'], reason: unknown): ClientErrorReport {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? 'unknown');
  const message = sanitizeErrorMessage(rawMessage);
  return { type, message, fingerprint: hash(`${type}:${message}`) };
}

export function installGlobalErrorReporting(report: (error: ClientErrorReport) => void): () => void {
  const runtime = (event: ErrorEvent) => report(createClientErrorReport('runtime', event.message || event.error));
  const promise = (event: PromiseRejectionEvent) => report(createClientErrorReport('promise', event.reason));
  window.addEventListener('error', runtime);
  window.addEventListener('unhandledrejection', promise);
  return () => {
    window.removeEventListener('error', runtime);
    window.removeEventListener('unhandledrejection', promise);
  };
}

export function sanitizeErrorMessage(value: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[id]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'unknown';
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}
