export {
  defaultRequestIdGenerator,
  IppClient,
  type IppAuth,
  type IppBasicCredentials,
  type IppClientOptions,
  type IppRequestOptions,
  MAX_REQUEST_ID,
  MIN_REQUEST_ID,
} from './client';

export { Printer, type PrinterOptions } from './printer';

export type {
  JobState,
  PrinterMediaMargins,
  PrinterMediaSize,
  PrinterMediaSizeDimensions,
  PrinterReadyMedia,
  PrinterState,
  PrinterStatus,
  PrintJob,
  PrintJobOptions,
  PrintMediaCol,
} from './types';

export {
  IppClientError,
  IppOperationError,
  type IppOperationErrorOptions,
} from './errors';
