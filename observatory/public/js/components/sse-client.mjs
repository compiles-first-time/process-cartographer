export class SSEClient {
  constructor(url, { onInit, onDelta, onFileChanged, onConnect, onDisconnect } = {}) {
    this._url = url;
    this._onInit = onInit;
    this._onDelta = onDelta;
    this._onFileChanged = onFileChanged;
    this._onConnect = onConnect;
    this._onDisconnect = onDisconnect;
    this._source = null;
    this._retryMs = 1000;
  }

  connect() {
    this._source = new EventSource(this._url);

    this._source.onopen = () => {
      this._retryMs = 1000;
      if (this._onConnect) this._onConnect();
    };

    this._source.addEventListener("state_init", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this._onInit) this._onInit(data);
      } catch { /* malformed */ }
    });

    this._source.addEventListener("delta", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this._onDelta) this._onDelta(data);
      } catch { /* malformed */ }
    });

    this._source.addEventListener("file_changed", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this._onFileChanged) this._onFileChanged(data);
      } catch { /* malformed */ }
    });

    this._source.onerror = () => {
      this._source.close();
      if (this._onDisconnect) this._onDisconnect();
      setTimeout(() => this.connect(), this._retryMs);
      this._retryMs = Math.min(this._retryMs * 2, 30000);
    };
  }

  close() {
    if (this._source) {
      this._source.close();
      this._source = null;
    }
  }
}
