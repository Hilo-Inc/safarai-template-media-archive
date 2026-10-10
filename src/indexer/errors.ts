/** A per-item failure. The message is shown to the owner in the import summary. */
export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

/** An import-level failure whose message is safe to show the owner (no paths, no internals). Any other error is reported generically. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
