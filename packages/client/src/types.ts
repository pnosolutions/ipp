/**
 * @see {@link https://datatracker.ietf.org/doc/html/rfc8011#section-5.4.11 RFC 8011 Section 5.4.11}
 */
export type PrinterState =
  | 'idle'
  | 'processing'
  | 'stopped'
  | `unknown:${number}`;

/**
 * @see {@link https://datatracker.ietf.org/doc/html/rfc8011#section-5.3.7 RFC 8011 Section 5.3.7}
 */
export type JobState =
  | 'pending'
  | 'pending-held'
  | 'processing'
  | 'processing-stopped'
  | 'canceled'
  | 'aborted'
  | 'completed'
  | `unknown:${number}`;

export interface PrinterReadyMedia {
  size: PrinterMediaSize;
  margin: PrinterMediaMargins;
  source?: string;
  type?: string;
}

export interface PrinterMediaMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface PrinterMediaSize {
  name?: string;
  dimensions?: PrinterMediaSizeDimensions;
}

/**
 * Dimensions are always given in hundredths of millimeters (1/2540th of an inch) which are sometimes called "PWG units"
 */
export type PrinterMediaSizeDimensions = readonly [x: number, y: number];

export interface PrinterStatus {
  name: string | null;
  uri: string;

  state: PrinterState;
  stateReasons: string[];

  supportedFormats: string[];

  /**
   * media-supported
   */
  supportedMedia: string[];

  /**
   * media-col-ready
   */
  readyMedia: PrinterReadyMedia | null;

  /**
   * printer-resolution-supported
   */
  supportedResolutions?: string[];

  /**
   * printer-resolution-default
   */
  resolution?: string;
}

export interface PrintJobOptions {
  copies?: number;
  media?: string;
  orientation?: 'portrait' | 'landscape';
  quality?: 'draft' | 'normal' | 'high';
  sides?: 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
  colorMode?: 'color' | 'monochrome';
  documentFormat?: string;
  jobName?: string;
  fitToPage?: boolean;
}

export interface PrintJob {
  id: number;
  uri: string;
  state: string;
  name: string;
  createdAt?: string;
  completedAt?: string;
  sheets?: number;
}
