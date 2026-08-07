import type { IppResolution } from '@pnosolutions/ipp-core';

/**
 * `'unknown'` means the printer did not report the attribute at all;
 * `` `unknown:${number}` `` means it reported a value this library does not
 * recognise.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc8011#section-5.4.11 RFC 8011 Section 5.4.11}
 */
export type PrinterState =
  | 'idle'
  | 'processing'
  | 'stopped'
  | 'unknown'
  | `unknown:${number}`;

/**
 * `'unknown'` means the printer did not report the attribute at all;
 * `` `unknown:${number}` `` means it reported a value this library does not
 * recognise.
 *
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
  | 'unknown'
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
  supportedResolutions: IppResolution[];

  /**
   * printer-resolution-default, or `null` if the printer did not report it.
   */
  resolution: IppResolution | null;
}

/**
 * `media-col` for a single job - per-job sheet geometry, for printers that
 * take it instead of (or as well as) a `media` keyword.
 *
 * @see {@link https://ftp.pwg.org/pub/pwg/candidates/cs-ippjobprinterext3v10-20120727-5100.13.pdf PWG 5100.13}
 */
export interface PrintMediaCol {
  size?: {
    /** media-size-name, e.g. 'na_index-4x6_4x6in' */
    name?: string;
    /** media-size, in hundredths of a millimetre (PWG units) */
    dimensions?: PrinterMediaSizeDimensions;
  };
  /** Margins in hundredths of a millimetre (PWG units) */
  margin?: PrinterMediaMargins;
  /** media-source, e.g. 'main-roll' */
  source?: string;
  /** media-type, e.g. 'labels' */
  type?: string;
}

export interface PrintJobOptions {
  copies?: number;
  media?: string;
  mediaCol?: PrintMediaCol;
  orientation?: 'portrait' | 'landscape';
  quality?: 'draft' | 'normal' | 'high';
  sides?: 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
  colorMode?: 'color' | 'monochrome';
  documentFormat?: string;
  jobName?: string;
  fitToPage?: boolean;
}

export interface PrintJob {
  /** job-id, or `null` if the printer did not report one. */
  id: number | null;
  uri: string;
  state: JobState;
  name: string;
  createdAt?: string;
  completedAt?: string;
  sheets?: number;
}
