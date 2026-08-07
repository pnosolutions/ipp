import { IppOperation, IppTag } from '@pnosolutions/ipp-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  defaultRequestIdGenerator,
  IppClient,
  MAX_REQUEST_ID,
  MIN_REQUEST_ID,
} from './client';

import type { IppAttributeGroup } from '@pnosolutions/ipp-core';

/** Minimal successful Get-Printer-Attributes response body. */
function okResponse(requestId = 1): Uint8Array {
  const buf = new Uint8Array(9);
  const view = new DataView(buf.buffer);
  view.setUint8(0, 2);
  view.setUint8(1, 0);
  view.setUint16(2, 0x0000, false);
  view.setUint32(4, requestId, false);
  view.setUint8(8, IppTag.EndOfAttributes);
  return buf;
}

interface StubbedFetch {
  /** request-id read back out of each encoded request body. */
  requestIds: number[];
  urls: string[];
  headers: Record<string, string>[];
}

/**
 * Stubs `fetch` with a printer that echoes the request-id, as RFC 8011
 * requires. Pass `respondWithRequestId` to simulate one that does not.
 */
function stubFetch(respondWithRequestId?: number): StubbedFetch {
  const calls: StubbedFetch = { requestIds: [], urls: [], headers: [] };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init: RequestInit) => {
      calls.urls.push(input.toString());
      calls.headers.push(init.headers as Record<string, string>);
      const body = init.body as Uint8Array;
      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const requestId = view.getUint32(4, false);
      calls.requestIds.push(requestId);

      return new Response(
        okResponse(respondWithRequestId ?? requestId) as BodyInit,
        {
          status: 200,
          headers: { 'Content-Type': 'application/ipp' },
        },
      );
    }),
  );

  return calls;
}

const GROUPS: IppAttributeGroup[] = [
  {
    tag: IppTag.OperationAttributes,
    attributes: [
      { tag: IppTag.Charset, name: 'attributes-charset', value: 'utf-8' },
    ],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request-id', () => {
  it('stays within RFC 8011 §4.1.1 range 1..2^31-1 over many requests', async () => {
    const calls = stubFetch();
    const client = new IppClient({ uri: 'ipp://printer.local:631/ipp/print' });

    for (let i = 0; i < 50; i++) {
      await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    }

    for (const id of calls.requestIds) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(MAX_REQUEST_ID);
      // The wire value must not read as negative when parsed as a
      // SIGNED-INTEGER, which is how printers parse request-id.
      expect(id | 0).toBeGreaterThan(0);
    }
  });

  it('increments monotonically from its seed', async () => {
    const calls = stubFetch();
    const client = new IppClient({ uri: 'ipp://printer.local:631/ipp/print' });

    await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    await client.request(IppOperation.GetPrinterAttributes, GROUPS);

    const [first, second, third] = calls.requestIds as [number, number, number];
    expect(second).toBe(first + 1);
    expect(third).toBe(second + 1);
  });

  it('gives requests issued in the same tick distinct ids', async () => {
    const calls = stubFetch();
    const client = new IppClient({ uri: 'ipp://printer.local:631/ipp/print' });

    // The whole point of counting rather than reading the clock per request:
    // Date.now() only moves once a millisecond, but `request-id` has to be
    // unique across a client's outstanding requests.
    vi.useFakeTimers();
    try {
      await Promise.all(
        Array.from({ length: 20 }, () =>
          client.request(IppOperation.GetPrinterAttributes, GROUPS),
        ),
      );
    } finally {
      vi.useRealTimers();
    }

    expect(new Set(calls.requestIds).size).toBe(20);
  });

  it('passes the previous request-id to a custom generator', async () => {
    stubFetch();
    const seen: (number | null)[] = [];
    const client = new IppClient({
      uri: 'ipp://printer.local:631/ipp/print',
      requestId: (last) => {
        seen.push(last);
        return (last ?? 0) + 10;
      },
    });

    await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    await client.request(IppOperation.GetPrinterAttributes, GROUPS);

    expect(seen).toEqual([null, 10]);
  });

  it('wraps back to 1 instead of overflowing past 2^31-1', () => {
    expect(defaultRequestIdGenerator(1)).toBe(2);
    expect(defaultRequestIdGenerator(MAX_REQUEST_ID - 1)).toBe(MAX_REQUEST_ID);
    expect(defaultRequestIdGenerator(MAX_REQUEST_ID)).toBe(MIN_REQUEST_ID);
  });

  it('seeds from the wall clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000_000_000));
      const early = defaultRequestIdGenerator(null);

      // ~14 hours later, far beyond the per-client seed spacing.
      vi.setSystemTime(new Date(1_000_050_000_000));
      const later = defaultRequestIdGenerator(null);

      expect(later).toBeGreaterThan(early);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives separate clients separate starting points', () => {
    vi.useFakeTimers();
    try {
      // Same millisecond for every client - the case a bare Date.now() seed
      // would collide on.
      vi.setSystemTime(new Date(1786122749217));
      const seeds = Array.from({ length: 50 }, () =>
        defaultRequestIdGenerator(null),
      );

      expect(new Set(seeds).size).toBe(50);

      // Spaced far enough apart that two clients do not converge after a few
      // hundred requests each.
      const sorted = [...seeds].sort((a, b) => a - b);
      const gaps = sorted.slice(1).map((seed, i) => seed - Number(sorted[i]));
      expect(Math.min(...gaps)).toBeGreaterThan(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays in range whatever the clock reads', () => {
    // Regression: `(Date.now() & 0xffffffff) >>> 0` exceeds 2^31-1 for roughly
    // half of every 49.7-day cycle, which printers read as a negative
    // request-id and reject. Masking to 31 bits is what fixes it.
    const inNegativeWindow = [1786122749217, 2 ** 41 - 1];
    expect(
      inNegativeWindow.map((ms) => ((ms & 0xffffffff) >>> 0) | 0),
    ).toSatisfy((ids: number[]) => ids.every((id) => id < 0));

    vi.useFakeTimers();
    try {
      for (const ms of [...inNegativeWindow, 1752346656768, 0x7fff_ffff]) {
        vi.setSystemTime(new Date(ms));
        const id = defaultRequestIdGenerator(null);

        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeGreaterThanOrEqual(MIN_REQUEST_ID);
        expect(id).toBeLessThanOrEqual(MAX_REQUEST_ID);
        expect(id | 0).toBeGreaterThan(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an out-of-range request-id from a custom generator', async () => {
    stubFetch();
    const client = new IppClient({
      uri: 'ipp://printer.local:631/ipp/print',
      requestId: () => 0x8000_0000,
    });

    await expect(
      client.request(IppOperation.GetPrinterAttributes, GROUPS),
    ).rejects.toThrow(/request-id/i);
  });

  it('rejects a request-id of 0', async () => {
    stubFetch();
    const client = new IppClient({
      uri: 'ipp://printer.local:631/ipp/print',
      requestId: () => 0,
    });

    await expect(
      client.request(IppOperation.GetPrinterAttributes, GROUPS),
    ).rejects.toThrow(/request-id/i);
  });
});

describe('uri normalization', () => {
  it.each([
    ['ipp://printer.local/ipp/print', 'http://printer.local:631/ipp/print'],
    ['ipps://printer.local/ipp/print', 'https://printer.local:631/ipp/print'],
    [
      'ipp://printer.local:8000/ipp/print/itpp941',
      'http://printer.local:8000/ipp/print/itpp941',
    ],
    // 443 is the https default, so WHATWG elides it from the serialization.
    ['ipps://printer.local:443/ipp/print', 'https://printer.local/ipp/print'],
    ['http://printer.local/ipp/print', 'http://printer.local/ipp/print'],
    ['https://printer.local/ipp/print', 'https://printer.local/ipp/print'],
  ])('maps %s to %s', (input, expected) => {
    expect(new IppClient({ uri: input }).httpUrl.href).toBe(expected);
  });

  it('defaults ipp:// to the IPP port 631, not HTTP port 80', () => {
    const { httpUrl } = new IppClient({ uri: 'ipp://printer.local/ipp/print' });
    expect(httpUrl.port).toBe('631');
  });

  it('preserves query and path, and strips credentials from the URL', () => {
    const { httpUrl } = new IppClient({
      uri: 'ipp://alice:secret@printer.local/ipp/print?x=1',
    });
    expect(httpUrl.username).toBe('');
    expect(httpUrl.password).toBe('');
    expect(httpUrl.href).not.toContain('secret');
    expect(httpUrl.pathname).toBe('/ipp/print');
    expect(httpUrl.search).toBe('?x=1');
  });

  it('does not mangle a host that contains "ipp"', () => {
    const { httpUrl } = new IppClient({ uri: 'ipp://ipp-printer.local/ipp' });
    expect(httpUrl.hostname).toBe('ipp-printer.local');
  });
});

describe('authentication', () => {
  it('sends no Authorization header when unauthenticated', async () => {
    const calls = stubFetch();
    const client = new IppClient({ uri: 'ipp://printer.local/ipp/print' });
    expect(client.authorization).toBeNull();

    await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    expect(calls.headers[0]?.Authorization).toBeUndefined();
  });

  it('sends Basic auth from a username/password pair', async () => {
    const calls = stubFetch();
    const client = new IppClient({
      uri: 'ipp://printer.local/ipp/print',
      auth: { username: 'alice', password: 'secret' },
    });

    await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    expect(calls.headers[0]?.Authorization).toBe(
      `Basic ${btoa('alice:secret')}`,
    );
  });

  it('sends Basic auth from credentials embedded in the URI', async () => {
    const calls = stubFetch();
    const client = new IppClient({
      uri: 'ipps://alice:secret@printer.local/ipp/print',
    });

    await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    expect(calls.headers[0]?.Authorization).toBe(
      `Basic ${btoa('alice:secret')}`,
    );
  });

  it('percent-decodes credentials taken from the URI', () => {
    const client = new IppClient({
      uri: 'ipp://a%40b.com:p%3Aw@printer.local/ipp/print',
    });
    expect(client.authorization).toBe(`Basic ${btoa('a@b.com:p:w')}`);
  });

  it('encodes non-ASCII credentials as UTF-8', () => {
    const client = new IppClient({
      uri: 'ipp://printer.local/ipp/print',
      auth: { username: 'jörg', password: 'pläne' },
    });

    const encoded = client.authorization?.slice('Basic '.length) ?? '';
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe('jörg:pläne');
  });

  it('passes an explicit header value through untouched', async () => {
    const calls = stubFetch();
    const client = new IppClient({
      uri: 'ipp://printer.local/ipp/print',
      auth: 'Bearer abc123',
    });

    await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    expect(calls.headers[0]?.Authorization).toBe('Bearer abc123');
  });

  it('prefers an explicit auth option over URI credentials', () => {
    const client = new IppClient({
      uri: 'ipp://alice:secret@printer.local/ipp/print',
      auth: 'Bearer abc123',
    });
    expect(client.authorization).toBe('Bearer abc123');
  });
});

describe('response request-id validation', () => {
  it('accepts a response that echoes the request-id', async () => {
    const calls = stubFetch();
    const client = new IppClient({ uri: 'ipp://printer.local/ipp/print' });

    const res = await client.request(IppOperation.GetPrinterAttributes, GROUPS);
    expect(res.requestId).toBe(calls.requestIds[0]);
  });

  it('throws when the printer answers with a different request-id', async () => {
    stubFetch(99);
    const client = new IppClient({ uri: 'ipp://printer.local/ipp/print' });

    await expect(
      client.request(IppOperation.GetPrinterAttributes, GROUPS),
    ).rejects.toThrow(/request-id 99 does not match/);
  });

  it('tolerates a response request-id of 0', async () => {
    stubFetch(0);
    const client = new IppClient({ uri: 'ipp://printer.local/ipp/print' });

    await expect(
      client.request(IppOperation.GetPrinterAttributes, GROUPS),
    ).resolves.toMatchObject({ requestId: 0 });
  });

  it('can be disabled', async () => {
    stubFetch(99);
    const client = new IppClient({
      uri: 'ipp://printer.local/ipp/print',
      validateResponseRequestId: false,
    });

    await expect(
      client.request(IppOperation.GetPrinterAttributes, GROUPS),
    ).resolves.toMatchObject({ requestId: 99 });
  });
});

describe('http errors', () => {
  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('nope', { status: 401, statusText: 'Unauthorized' }),
      ),
    );

    const client = new IppClient({ uri: 'ipp://printer.local:631/ipp/print' });
    await expect(
      client.request(IppOperation.GetPrinterAttributes, GROUPS),
    ).rejects.toThrow(/401/);
  });
});
