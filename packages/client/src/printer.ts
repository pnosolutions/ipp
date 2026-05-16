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
  num,
  str,
  strArray,
} from './utils';

import type {
  IppAttribute,
  IppAttributeGroup,
  IppAttributeValue,
  IppResponse,
} from '@pnosolutions/ipp-core';

export interface PrinterOptions {
  username?: string;
}

export class Printer {
  readonly client: IppClient;
  readonly username: string;

  constructor(
    readonly uri: string | URL,
    options: PrinterOptions = {},
  ) {
    this.client = new IppClient({ uri: uri.toString() });
    this.username = options.username ?? 'ipp-client';
  }

  async status(): Promise<
    PrinterStatus & { raw: Record<string, IppAttributeValue> }
  > {
    const groups = [this.operationGroup()];
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
      name: str(attrs['printer-name']),
      uri: str(attrs['printer-uri-supported']) || this.uri,
      state: mapPrinterState(num(attrs['printer-state'])),
      stateReasons: strArray(attrs['printer-state-reasons']),
      supportedFormats: strArray(attrs['document-format-supported']),
      supportedMedia: strArray(attrs['media-supported']),
      readyMedia,

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
        num(respAttrs['job-id']) || num(getAttribute(response, 'job-id')) || 0,
      uri:
        str(respAttrs['job-uri']) ||
        str(getAttribute(response, 'job-uri')) ||
        '',
      state: mapJobState(
        num(respAttrs['job-state']) || num(getAttribute(response, 'job-state')),
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
    if (response.statusCode >= 0x0400 && response.statusCode < 0x0600) {
      const msg = str(getAttribute(response, 'status-message'));
      throw new IppOperationError(response.statusCode, msg);
    }
  }
}

function mapPrinterState(state: number): PrinterState {
  switch (state) {
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

function mapJobState(state: number): JobState {
  switch (state) {
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
