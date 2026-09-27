import type { CapabilityArtifactInput } from '../../../../shared/types/capability-studio'

export function buildCapabilityPreviewDocument(artifact: CapabilityArtifactInput, nonce: string): string {
  const bridge = `
    (() => {
      const token = ${JSON.stringify(nonce)};
      const pending = new Map();
      let nextId = 0;
      const reportError = (reason) => window.parent.postMessage({ channel: 'octob-capability', token, type: 'error', error: String(reason) }, '*');
      window.addEventListener('error', (event) => reportError(event.message || 'Erro no script da capability'));
      window.addEventListener('unhandledrejection', (event) => reportError(event.reason && event.reason.message || event.reason));
      window.capability = Object.freeze({
        call(input) {
          const id = String(++nextId);
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            try { window.parent.postMessage({ channel: 'octob-capability', token, type: 'call', id, input }, '*'); }
            catch (error) { pending.delete(id); reject(error); }
          });
        }
      });
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (event.source !== window.parent || !message || message.channel !== 'octob-capability' || message.token !== token || message.type !== 'result') return;
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        if (message.ok) item.resolve(message.result);
        else item.reject(new Error(message.error || 'Capability failed'));
      });
      window.addEventListener('load', () => window.parent.postMessage({ channel: 'octob-capability', token, type: 'ready' }, '*'));
    })();
  `
  const css = artifact.css.replace(/<\/style/gi, '<\\/style')
  const safeBridge = bridge.replace(/<\/script/gi, '<\\/script')
  const safeUi = artifact.javascript.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;font-family:system-ui;color:#e8e8eb;background:#151519}*{box-sizing:border-box}${css}</style></head><body>${artifact.html}<script nonce="${nonce}">${safeBridge}</script><script nonce="${nonce}">${safeUi}</script></body></html>`
}
