import {
  decodeIppResponse,
  encodeIppRequest,
  IppVersion,
} from '@pnosolutions/ipp-core';

import type {
  IppAttributeGroup,
  IppOperationId,
  IppRequest,
  IppResponse,
} from '@pnosolutions/ipp-core';

type RequestIdGeneratorFn = (lastRequestId: number | null) => number;

export interface IppClientOptions {
  /** Printer URI, e.g. ipp://printer.local:631/ipp/print */
  uri: string | URL;

  /** Request timeout in milliseconds */
  timeout?: number;

  /** IPP version to use */
  version?: readonly [number, number];

  requestId?: RequestIdGeneratorFn;
}

export interface IppRequestOptions {
  signal?: AbortSignal;
}

const defaultRequestIdGenerator = () => (Date.now() & 0xffffffff) >>> 0;

export class IppClient {
  readonly uri: string | URL;
  readonly httpUrl: URL;
  readonly timeout: number;
  readonly version: readonly [number, number];

  private readonly requestIdGenerator: RequestIdGeneratorFn;
  private lastRequestId: number | null = null;

  constructor(options: IppClientOptions) {
    this.uri = options.uri;
    this.timeout = options.timeout ?? 10_000;
    this.version = options.version ?? IppVersion.V2_0;
    this.httpUrl = normalizeUri(options.uri);

    this.requestIdGenerator = options.requestId ?? defaultRequestIdGenerator;
  }

  /**
   * Send a raw IPP request and get the decoded response
   */
  async request(
    operation: IppOperationId,
    groups: IppAttributeGroup[],
    data?: Uint8Array,
    { signal: userSignal }: IppRequestOptions = {},
  ): Promise<IppResponse> {
    const requestId = this.requestIdGenerator(this.lastRequestId);

    const request: IppRequest = {
      version: this.version,
      operation,
      requestId,
      groups,
      data,
    };

    const encoded = encodeIppRequest(request);

    const controller = new AbortController();

    const signals = [controller.signal, AbortSignal.timeout(this.timeout)];

    if (userSignal) signals.push(userSignal);

    const response = await fetch(this.httpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ipp',
        Accept: 'application/ipp',
      },
      body: encoded,
      signal: AbortSignal.any(signals),
    });

    if (!response.ok && response.status !== 200) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const responseBuffer = new Uint8Array(await response.arrayBuffer());
    return decodeIppResponse(responseBuffer);
  }
}

/**
 * Convert an IPP URI to an HTTP(S) URL for fetch
 * 
 * ipp://host:631/path -> http://host:631/path
 * ipps://host:443/path -> https://host:443/path
 */
function normalizeUri(uri: string | URL): URL {
  const url = typeof uri === 'string' ? new URL(uri) : uri;

  if (url.protocol === 'ipp:' || url.protocol === 'ipps:') {
    return new URL(url.toString().replace('ipp', 'http'));
  }

  return url;
}
