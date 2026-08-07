# @pnosolutions/ipp

A client for [Internet Printing Protocol](https://datatracker.ietf.org/doc/html/rfc8011) printers — query status, submit print jobs, and drop down to raw IPP operations when you need to.

Built on [`@pnosolutions/ipp-core`](../core), which does the message encoding and decoding. Pure TypeScript, ESM-only, and no Node.js built-ins: transport is plain `fetch`.

## Installation

```sh
npm install @pnosolutions/ipp
# or
pnpm add @pnosolutions/ipp
# or
yarn add @pnosolutions/ipp
```

`@pnosolutions/ipp-core` comes along as a dependency; install it directly only if you also want to work with raw IPP messages.

Requires Node.js 20.3 or newer. The library is engine-agnostic, but it needs global `fetch`, `AbortSignal.timeout` (Node 17.3+), and `AbortSignal.any` (Node 20.3+).

## Quick start

```ts
import { readFile } from 'node:fs/promises';
import { Printer } from '@pnosolutions/ipp';

const printer = new Printer('ipp://printer.local:631/ipp/print');

// 1. Query printer status
const status = await printer.status();
console.log(status.name, status.state, status.stateReasons);

// 2. Send a document. The MIME type is auto-detected from magic bytes.
const pdf = await readFile('./invoice.pdf');
const job = await printer.print(pdf, {
  copies: 1,
  sides: 'two-sided-long-edge',
  colorMode: 'monochrome',
  jobName: 'invoice-2024-11',
});

console.log('Submitted job', job.id, '->', job.state);
```

## `new Printer(uri, options?)`

Wraps an IPP URI. Both `ipp://` and `ipps://` are accepted and mapped to `http://` and `https://`, defaulting to port 631 when the URI omits one.

```ts
const printer = new Printer('ipps://secure-printer.example.com/ipp/print', {
  username: 'alice', // sent as `requesting-user-name`
  auth: { username: 'alice', password: 's3cr3t' }, // HTTP Basic
  timeout: 5_000, // milliseconds, default 10000
});
```

`username` is the IPP-level `requesting-user-name` (default `'ipp-client'`); `auth` is HTTP transport authentication and is unrelated to it.

Credentials embedded in the URI are used when `auth` is omitted:

```ts
// Equivalent to auth: { username: 'alice', password: 's3cr3t' }
new Printer('ipps://alice:s3cr3t@printer.local/ipp/print');
```

They are converted into an `Authorization` header and stripped from the URL — `fetch` neither sends them nor errors on them, so leaving them in place would silently produce unauthenticated requests. Pass a string to supply the header verbatim (`auth: 'Bearer …'`).

The underlying client is available as `printer.client` if you need to issue an operation the wrapper does not cover.

### `printer.status()`

Sends `Get-Printer-Attributes` and returns a normalized snapshot:

```ts
const {
  name, // printer-name, or null if not reported
  uri, // printer-uri-supported (or the URI you passed in)
  state, // 'idle' | 'processing' | 'stopped' | 'unknown' | `unknown:${n}`
  stateReasons, // string[]
  supportedFormats, // document-format-supported
  supportedMedia, // media-supported
  readyMedia, // parsed media-col-ready (size, margins, source, type)
  supportedResolutions, // printer-resolution-supported, as { x, y, units }[]
  resolution, // printer-resolution-default, or null
  raw, // full attribute dictionary, untouched
} = await printer.status();
```

`raw` is the unparsed `printer-attributes` group, useful for printer-specific attributes the high-level interface does not expose yet.

Attributes the printer did not report are `null` (or `'unknown'` for the state enums) rather than `0`/`''`, so a genuine zero is distinguishable from a missing value. A state the printer reported but this library does not recognise comes back as `` `unknown:${number}` ``.

### `printer.print(data, options?)`

Sends `Print-Job` with the given bytes as the document. The MIME type is auto-detected from magic bytes (PDF, PostScript, PWG raster, PNG, JPEG, GIF; otherwise `application/octet-stream`) unless `documentFormat` is given.

```ts
interface PrintJobOptions {
  copies?: number;
  media?: string; // e.g. 'iso_a4_210x297mm'
  mediaCol?: PrintMediaCol; // per-job sheet geometry, see below
  orientation?: 'portrait' | 'landscape';
  quality?: 'draft' | 'normal' | 'high';
  sides?: 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
  colorMode?: 'color' | 'monochrome';
  documentFormat?: string; // override MIME detection
  jobName?: string; // defaults to `job-${Date.now()}`
  fitToPage?: boolean; // print-scaling: 'fit'
}
```

Options you leave out are not sent, so the printer keeps its own defaults.

The returned `PrintJob` contains the IPP-assigned `id` (`null` if the printer did not report one), `uri`, `state`, and the `name` submitted.

#### `media-col`

Printers that do not accept a `media` keyword for the size you want usually take a `media-col` collection instead. Dimensions and margins are in hundredths of a millimetre ("PWG units"):

```ts
await printer.print(label, {
  mediaCol: {
    size: { dimensions: [5715, 3175] }, // 57.15mm x 31.75mm
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    source: 'main-roll',
    type: 'labels',
  },
});
```

Members you leave out are omitted from the request.

## Error handling

Operation-level failures (any IPP status code `>= 0x0400`) throw `IppOperationError`, which carries `statusCode` and, when the printer did not send a `status-message`, a message naming the code:

```ts
import { IppOperationError } from '@pnosolutions/ipp';

try {
  await printer.print(data);
} catch (err) {
  if (err instanceof IppOperationError) {
    console.error(`IPP error 0x${err.statusCode.toString(16)}: ${err.message}`);
  } else {
    throw err;
  }
}
```

HTTP-level failures — a non-2xx response, a `200` that isn't `application/ipp`, or a `request-id` mismatch — throw `IppClientError` (`IppOperationError` extends it). Timeouts surface as `AbortError` from `fetch`. A truncated or non-IPP body throws `IppDecodeError` from `@pnosolutions/ipp-core`, carrying the byte `offset` where decoding gave up.

## Low-level usage

For operations `Printer` does not wrap, use `IppClient` directly with the tags and operation IDs from the core package.

```ts
import { IppClient } from '@pnosolutions/ipp';
import { IppOperation, IppTag } from '@pnosolutions/ipp-core';

const client = new IppClient({
  uri: 'ipp://printer.local:631/ipp/print',
  timeout: 5_000,
});

const response = await client.request(IppOperation.GetPrinterAttributes, [
  {
    tag: IppTag.OperationAttributes,
    attributes: [
      { tag: IppTag.Charset, name: 'attributes-charset', value: 'utf-8' },
      {
        tag: IppTag.NaturalLanguage,
        name: 'attributes-natural-language',
        value: 'en',
      },
      {
        tag: IppTag.Uri,
        name: 'printer-uri',
        value: 'ipp://printer.local:631/ipp/print',
      },
      { tag: IppTag.Keyword, name: 'requested-attributes', value: 'all' },
    ],
  },
]);

console.log(response.statusCode, response.groups);
```

`request(operation, groups, data?, options?)` returns the decoded `IppResponse` without inspecting its status code — check `response.statusCode` yourself. Pass `{ signal }` in the fourth argument to cancel a request; it is combined with the client's own timeout.

```ts
interface IppClientOptions {
  uri: string | URL;
  timeout?: number; // ms, default 10000
  version?: readonly [number, number]; // default IppVersion.V2_0
  requestId?: (lastRequestId: number | null) => number;
  auth?: string | { username: string; password: string };
  validateResponseRequestId?: boolean; // default true
}
```

## `request-id`

RFC 8011 §4.1.1 defines `request-id` as a _signed_ 32-bit integer in the range `1..2**31 - 1`. A value with the high bit set is read back by the printer as negative and rejected, so the clock cannot be used raw — `Date.now()` overflows that range for roughly half of every 49.7-day cycle.

Each `IppClient` seeds its sequence from the wall clock (masked to 31 bits, spaced apart per client) and then counts up. The seed keeps separate clients — and separate processes, and restarts — from starting at the same place; counting rather than re-reading the clock keeps two requests issued in the same millisecond from sharing an ID, which is what `request-id` actually has to guarantee: uniqueness across one client's _outstanding_ requests.

Reusing an ID against a different client's connection is harmless — the printer only echoes it back so you can match your own responses. (CUPS sends `1` for every request it builds.)

Supply your own scheme via `requestId`. It must return an integer in `MIN_REQUEST_ID..MAX_REQUEST_ID` or `IppClient` throws before touching the network:

```ts
import { IppClient, MAX_REQUEST_ID } from '@pnosolutions/ipp';

const client = new IppClient({
  uri: 'ipp://printer.local/ipp/print',
  requestId: (last) => (last === null || last >= MAX_REQUEST_ID ? 1 : last + 1),
});
```

Responses are checked to make sure the printer echoed the ID it was sent, which is what lets you trust that a response belongs to the request you made. A response ID of `0` is tolerated, since printers use it when they could not parse the request far enough to read one. Firmware that echoes something else entirely needs the check turned off:

```ts
new IppClient({ uri, validateResponseRequestId: false });
```

## Compatibility

- Speaks IPP/1.1 and IPP/2.0 over HTTP and HTTPS.
- Designed against [RFC 8011](https://datatracker.ietf.org/doc/html/rfc8011) and the PWG IPP Everywhere profile.
- Tested informally against CUPS and PWG raster–capable label printers. Reports of compatibility with other firmware are welcome.

## License

[ISC](../../LICENSE) © PNO Solutions Limited
