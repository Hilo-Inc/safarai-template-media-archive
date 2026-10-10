/** A per-item failure. The message is shown to the owner in the import summary. */
export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}
