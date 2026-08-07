/**
 * Thrown when an IPP message cannot be decoded - truncated, or otherwise not a
 * well-formed IPP response. Carries the byte offset where decoding gave up so
 * a raw capture can be lined up against it.
 */
export class IppDecodeError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'IppDecodeError';
  }
}
