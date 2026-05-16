import { StatusCodes } from './status-codes';

export class IppClientError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export interface IppOperationErrorOptions extends ErrorOptions {
  statusCode?: number;
}

export class IppOperationError extends IppClientError {
  constructor(
    public readonly statusCode: number,
    message?: string,
    options?: ErrorOptions,
  ) {
    if (!message) {
      const statusName = StatusCodes[statusCode]?.name ?? 'unknown';
      message = `IPP operation error (0x${statusCode.toString(16)} - ${statusName})`;
    }

    super(message, options);
    this.name = this.constructor.name;
  }
}
