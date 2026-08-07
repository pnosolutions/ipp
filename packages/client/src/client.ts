import {
  decodeIppResponse,
  encodeIppRequest,
  IppVersion,
} from '@pnosolutions/ipp-core';

import { IppClientError } from './errors';

import type {
  IppAttributeGroup,
  IppOperationId,
  IppRequest,
  IppResponse,
} from '@pnosolutions/ipp-core';

type RequestIdGeneratorFn = (lastRequestId: number | null) => number;

/** Username and password sent as an HTTP Basic `Authorization` header. */
export interface IppBasicCredentials {
  username: string;
  password: string;
}

/**
 * HTTP credentials: either a ready-made `Authorization` header value (for
 * Bearer tokens or any other scheme) or a username/password pair, which is
 * sent as HTTP Basic.
 */
export type IppAuth = string | IppBasicCredentials;

export interface IppClientOptions {
  /** Printer URI, e.g. ipp://printer.local:631/ipp/print */
  uri: string | URL;

  /** Request timeout in milliseconds */
  timeout?: number;

  /** IPP version to use */
  version?: readonly [number, number];

  /**
   * Produces the `request-id` for the next request. Must return an integer in
   * the range {@link MIN_REQUEST_ID}..{@link MAX_REQUEST_ID}.
   */
  requestId?: RequestIdGeneratorFn;

  /**
   * HTTP credentials. Defaults to any credentials embedded in the URI
   * (`ipp://user:pass@host/...`), which are sent as Basic and stripped from
   * the URL - `fetch` does not turn them into an `Authorization` header.
   */
  auth?: IppAuth;

  /**
   * Check that the printer echoed the `request-id` it was sent, as RFC 8011
   * §4.1.1 requires. Defaults to `true`; set `false` for firmware that
   * answers with a different ID (some return `0`).
   */
  validateResponseRequestId?: boolean;
}

export interface IppRequestOptions {
  signal?: AbortSignal;
}

/**
 * RFC 8011 §4.1.1 defines `request-id` as a SIGNED-INTEGER that the client
 * "MUST set to a value in the range from 1 to 2**31 - 1". Values with the high
 * bit set are read back by the printer as negative numbers and rejected with
 * `client-error-bad-request`.
 */
export const MIN_REQUEST_ID = 1;
export const MAX_REQUEST_ID = 0x7fff_ffff;

/** Default IPP port for `ipp:` and `ipps:` URIs (RFC 8010 §5, RFC 7472 §4). */
const IPP_DEFAULT_PORT = '631';

/** Clients constructed so far, used to space their seeds apart. */
let clientSeq = 0;

/**
 * Seed a client's `request-id` sequence.
 *
 * The wall clock separates processes and restarts, the sequence number
 * separates clients within one process, and the random component separates
 * processes that start in the same millisecond. The result is masked to 31
 * bits: the printer reads `request-id` as a SIGNED integer, so the sign bit
 * has to stay clear.
 */
function initialRequestId(): number {
  const offset = clientSeq++ * 0x10_0000 + Math.floor(Math.random() * 0x1_0000);
  // `& MAX_REQUEST_ID` is the 31-bit mask; it clears the sign bit that
  // `& 0xffffffff` would have kept.
  const seed = (Date.now() + offset) & MAX_REQUEST_ID;
  return seed === 0 ? MIN_REQUEST_ID : seed;
}

/**
 * Seeds from the clock, then counts up.
 *
 * The clock alone is not enough: it only advances once per millisecond, so
 * requests issued in the same tick would share an ID - and `request-id` has to
 * be unique among a client's *outstanding* requests, which is exactly the set
 * that fits inside one tick. Incrementing from a clock-derived seed keeps the
 * separation between clients without that collision.
 */
export const defaultRequestIdGenerator: RequestIdGeneratorFn = (
  lastRequestId,
) => {
  if (lastRequestId === null) return initialRequestId();
  return lastRequestId >= MAX_REQUEST_ID ? MIN_REQUEST_ID : lastRequestId + 1;
};

export class IppClient {
  readonly uri: string | URL;
  readonly httpUrl: URL;
  readonly timeout: number;
  readonly version: readonly [number, number];

  /** Resolved `Authorization` header value, or `null` when unauthenticated. */
  readonly authorization: string | null;

  private readonly requestIdGenerator: RequestIdGeneratorFn;
  private readonly validateResponseRequestId: boolean;
  private lastRequestId: number | null = null;

  constructor(options: IppClientOptions) {
    this.uri = options.uri;
    this.timeout = options.timeout ?? 10_000;
    this.version = options.version ?? IppVersion.V2_0;
    this.validateResponseRequestId = options.validateResponseRequestId ?? true;
    this.requestIdGenerator = options.requestId ?? defaultRequestIdGenerator;

    const url = normalizeUri(options.uri);
    this.authorization = resolveAuthorization(options.auth, url);
    // Credentials in the URL are not sent by fetch, and leak into logs.
    url.username = '';
    url.password = '';
    this.httpUrl = url;
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
    const requestId = this.nextRequestId();

    const request: IppRequest = {
      version: this.version,
      operation,
      requestId,
      groups,
      data,
    };

    const encoded = encodeIppRequest(request);

    const signals: AbortSignal[] = [AbortSignal.timeout(this.timeout)];
    if (userSignal) signals.push(userSignal);

    const headers: Record<string, string> = {
      'Content-Type': 'application/ipp',
      Accept: 'application/ipp',
    };
    if (this.authorization) headers.Authorization = this.authorization;

    const response = await fetch(this.httpUrl, {
      method: 'POST',
      headers,
      body: encoded,
      signal: AbortSignal.any(signals),
    });

    if (!response.ok) {
      throw new IppClientError(
        `HTTP error: ${response.status} ${response.statusText}`,
      );
    }

    // A printer that answers 200 with HTML (captive portals, misrouted paths)
    // would otherwise be decoded as garbage attributes.
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('application/ipp')) {
      throw new IppClientError(
        `Expected an application/ipp response, got ${contentType}`,
      );
    }

    const responseBuffer = new Uint8Array(await response.arrayBuffer());
    const decoded = decodeIppResponse(responseBuffer);

    if (
      this.validateResponseRequestId &&
      decoded.requestId !== requestId &&
      // Some printers legitimately answer with 0 when they could not parse the
      // request far enough to read the ID; the status code carries the reason.
      decoded.requestId !== 0
    ) {
      throw new IppClientError(
        `Response request-id ${decoded.requestId} does not match request ` +
          `request-id ${requestId} (RFC 8011 §4.1.1). Pass ` +
          `validateResponseRequestId: false to ignore this.`,
      );
    }

    return decoded;
  }

  private nextRequestId(): number {
    const requestId = this.requestIdGenerator(this.lastRequestId);

    if (
      !Number.isInteger(requestId) ||
      requestId < MIN_REQUEST_ID ||
      requestId > MAX_REQUEST_ID
    ) {
      throw new IppClientError(
        `request-id must be an integer in the range ${MIN_REQUEST_ID}..${MAX_REQUEST_ID} ` +
          `(RFC 8011 §4.1.1), got ${requestId}`,
      );
    }

    this.lastRequestId = requestId;
    return requestId;
  }
}

/**
 * Convert an IPP URI to an HTTP(S) URL for fetch.
 *
 * ipp://host/path       -> http://host:631/path
 * ipps://host/path      -> https://host:631/path
 * ipp://host:8000/path  -> http://host:8000/path
 *
 * `ipp:`/`ipps:` are non-special URL schemes, so the port is never implied by
 * the parser and assigning `url.protocol` is a silent no-op - the URL has to be
 * rebuilt from its parts.
 */
function normalizeUri(uri: string | URL): URL {
  const url = typeof uri === 'string' ? new URL(uri) : uri;

  if (url.protocol !== 'ipp:' && url.protocol !== 'ipps:') {
    return url;
  }

  const httpUrl = new URL(
    `${url.protocol === 'ipps:' ? 'https' : 'http'}://${url.hostname}`,
  );

  httpUrl.port = url.port || IPP_DEFAULT_PORT;
  httpUrl.username = url.username;
  httpUrl.password = url.password;
  httpUrl.pathname = url.pathname;
  httpUrl.search = url.search;
  httpUrl.hash = url.hash;

  return httpUrl;
}

function resolveAuthorization(
  auth: IppAuth | undefined,
  url: URL,
): string | null {
  if (typeof auth === 'string') return auth;
  if (auth) return basicAuth(auth.username, auth.password);

  if (url.username || url.password) {
    return basicAuth(percentDecode(url.username), percentDecode(url.password));
  }

  return null;
}

/**
 * RFC 7617 Basic credentials. `btoa` only accepts code points below 256, so
 * the UTF-8 bytes are widened to a binary string first.
 */
function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function percentDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed escape - use the raw value rather than failing the request.
    return value;
  }
}
