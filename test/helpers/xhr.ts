/**
 * A minimal XMLHttpRequest over fetch, so Uppy's S3 uploader (which uses XHR) can run in Node.
 * Covers only what @uppy/core's fetcher uses: open, setRequestHeader, send, abort, status, responseText, getResponseHeader, upload.onprogress, onload, onerror.
 */
export class FetchXhr {
  status = 0;
  statusText = '';
  responseText = '';
  withCredentials = false;
  responseType = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  private method = 'GET';
  private url = '';
  private headers = new Headers();
  private responseHeaders = new Headers();
  private controller = new AbortController();

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers.append(name, value);
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders.get(name);
  }
  abort(): void {
    this.controller.abort();
  }
  send(body: Blob | string | null): void {
    fetch(this.url, { method: this.method, headers: this.headers, body, signal: this.controller.signal })
      .then(async (res) => {
        this.status = res.status;
        this.statusText = res.statusText;
        this.responseHeaders = res.headers;
        this.responseText = await res.text();
        const size = body === null ? 0 : typeof body === 'string' ? body.length : body.size;
        this.upload.onprogress?.({ lengthComputable: true, loaded: size, total: size });
        this.onload?.();
      })
      .catch(() => {
        if (!this.controller.signal.aborted) this.onerror?.();
      });
  }
}
