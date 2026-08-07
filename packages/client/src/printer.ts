import {
  getAttribute,
  getAttributes,
  IppOperation,
  IppTag,
} from '@pnosolutions/ipp-core';

import { IppClient } from './client';
import { IppOperationError } from './errors';
import {
  JobState,
  PrinterReadyMedia,
  PrinterState,
  PrinterStatus,
  PrintJob,
  PrintJobOptions,
} from './types';
import {
  buildJobAttributes,
  collection,
  detectMimeType,
  numOrNull,
  resolution,
  resolutionArray,
  str,
  strArray,
  strOrNull,
} from './utils';

import type {
  IppAttribute,
  IppAttributeGroup,
  IppAttributeValue,
  IppResponse,
} from '@pnosolutions/ipp-core';
import type { IppAuth } from './client';

export interface PrinterOptions {
  /** Sent as `requesting-user-name`. Defaults to `'ipp-client'`. */
  username?: string;

  /**
   * HTTP credentials. Defaults to any credentials embedded in the URI. This is
   * transport-level auth and is unrelated to `requesting-user-name`.
   */
  auth?: IppAuth;

  /** Request timeout in milliseconds. Defaults to 10000. */
  timeout?: number;
}

export class Printer {
  readonly client: IppClient;
  readonly username: string;
  readonly uri: string;

  constructor(uri: string | URL, options: PrinterOptions = {}) {
    this.uri = uri.toString();
    this.client = new IppClient({
      uri: this.uri,
      auth: options.auth,
      timeout: options.timeout,
    });
    this.username = options.username ?? 'ipp-client';
  }

  async status(): Promise<
    PrinterStatus & { raw: Record<string, IppAttributeValue> }
  > {
    const groups = [
      this.operationGroup([
        {
          tag: IppTag.NameWithoutLanguage,
          name: 'requesting-user-name',
          value: this.username,
        },
        {
          tag: IppTag.Keyword,
          name: 'requested-attributes',
          value: 'all',
        },
      ]),
    ];

    const response = await this.client.request(
      IppOperation.GetPrinterAttributes,
      groups,
    );

    Printer.ensureSuccessStatusCode(response);

    const attrs = getAttributes(response, IppTag.PrinterAttributes);

    const readyMedia = attrs['media-col-ready']
      ? parseReadyMedia(attrs['media-col-ready'])
      : null;

    return {
      name: strOrNull(attrs['printer-name']),
      uri: str(attrs['printer-uri-supported']) || this.uri,
      state: mapPrinterState(numOrNull(attrs['printer-state'])),
      stateReasons: strArray(attrs['printer-state-reasons']),
      supportedFormats: strArray(attrs['document-format-supported']),
      supportedMedia: strArray(attrs['media-supported']),
      readyMedia,
      supportedResolutions: resolutionArray(
        attrs['printer-resolution-supported'],
      ),
      resolution: resolution(attrs['printer-resolution-default']),

      raw: attrs,
    };
  }

  async print(data: Uint8Array, options?: PrintJobOptions): Promise<PrintJob> {
    const format = options?.documentFormat ?? detectMimeType(data);
    const jobName = options?.jobName ?? `job-${Date.now()}`;

    const operationAttrs = this.operationGroup([
      {
        tag: IppTag.NameWithoutLanguage,
        name: 'requesting-user-name',
        value: this.username,
      },
      { tag: IppTag.NameWithoutLanguage, name: 'job-name', value: jobName },
      { tag: IppTag.MimeMediaType, name: 'document-format', value: format },
    ]);

    const jobAttrs: IppAttributeGroup = {
      tag: IppTag.JobAttributes,
      attributes: buildJobAttributes(options),
    };

    const groups =
      jobAttrs.attributes.length > 0
        ? [operationAttrs, jobAttrs]
        : [operationAttrs];

    const response = await this.client.request(
      IppOperation.PrintJob,
      groups,
      data,
    );
    Printer.ensureSuccessStatusCode(response);

    const respAttrs = getAttributes(response, IppTag.JobAttributes);

    return {
      id:
        numOrNull(respAttrs['job-id']) ??
        numOrNull(getAttribute(response, 'job-id')),
      uri:
        str(respAttrs['job-uri']) ||
        str(getAttribute(response, 'job-uri')) ||
        '',
      state: mapJobState(
        numOrNull(respAttrs['job-state']) ??
          numOrNull(getAttribute(response, 'job-state')),
      ),
      name: jobName,
    };
  }

  protected operationGroup(extra?: IppAttribute[]): IppAttributeGroup {
    return {
      tag: IppTag.OperationAttributes,
      attributes: [
        { tag: IppTag.Charset, name: 'attributes-charset', value: 'utf-8' },
        {
          tag: IppTag.NaturalLanguage,
          name: 'attributes-natural-language',
          value: 'en',
        },
        { tag: IppTag.Uri, name: 'printer-uri', value: this.uri },
        ...(extra || []),
      ],
    };
  }

  protected static ensureSuccessStatusCode(response: IppResponse): void {
    // RFC 8011 §4.1.7: 0x0000-0x00ff is successful, 0x0400+ is an error.
    // Anything above 0x05ff is vendor territory and still not a success.
    if (response.statusCode >= 0x0400) {
      const msg = str(getAttribute(response, 'status-message'));
      throw new IppOperationError(response.statusCode, msg);
    }
  }
}

function mapPrinterState(state: number | null): PrinterState {
  switch (state) {
    case null:
      return 'unknown';
    case 3:
      return 'idle';
    case 4:
      return 'processing';
    case 5:
      return 'stopped';
    default:
      return `unknown:${state}`;
  }
}

function mapJobState(state: number | null): JobState {
  switch (state) {
    case null:
      return 'unknown';
    case 3:
      return 'pending';
    case 4:
      return 'pending-held';
    case 5:
      return 'processing';
    case 6:
      return 'processing-stopped';
    case 7:
      return 'canceled';
    case 8:
      return 'aborted';
    case 9:
      return 'completed';
    default:
      return `unknown:${state}`;
  }
}

function parseReadyMedia(value: IppAttributeValue): PrinterReadyMedia {
  const rawData = collection(value);

  const data: PrinterReadyMedia = {
    margin: {},
    size: {},
  };

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = rawData[`media-${side}-margin`];
    if (isValidNumber(value)) {
      data.margin[side] = value;
    }
  }

  if (typeof rawData['media-type'] === 'string') {
    data.type = rawData['media-type'];
  }

  if (typeof rawData['media-source'] === 'string') {
    data.source = rawData['media-source'];
  }

  if (typeof rawData['media-size-name'] === 'string') {
    data.size.name = rawData['media-size-name'];
  }

  const size = rawData['media-size'];
  if (typeof size === 'object') {
    if (
      'x-dimension' in size &&
      'y-dimension' in size &&
      isValidNumber(size['x-dimension']) &&
      isValidNumber(size['y-dimension'])
    ) {
      data.size.dimensions = [size['x-dimension'], size['y-dimension']];
    }
  }

  return data;
}

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
