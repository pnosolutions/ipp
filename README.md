# ipp

A TypeScript implementation of the [Internet Printing Protocol (IPP)](https://datatracker.ietf.org/doc/html/rfc8011) for Node.js.

This repository is a small monorepo with two packages:

| Package                                         | Description                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`@pnosolutions/ipp-core`](./packages/core)     | Zero-dependency IPP message encoder/decoder, type definitions, and tag/operation constants.       |
| [`@pnosolutions/ipp-client`](./packages/client) | High-level client for talking to IPP printers — query status, submit print jobs, parse responses. |

> **Status:** early `0.1.0`. The API surface is intentionally small and may shift.

## Features

- Pure TypeScript, ESM-only, no Node.js built-ins - only web-platform APIs (`fetch`, `TextEncoder`, `AbortSignal`).
- Speaks IPP/1.1 and IPP/2.0 over HTTP and HTTPS (`ipp://` and `ipps://` URIs are normalized to `http://` / `https://`, defaulting to the IPP port 631 when the URI omits one).
- Encode **and** decode IPP messages, including nested collections (`begCollection` / `endCollection`), resolutions, `textWithLanguage`, and `media-col` structures.
- High-level helpers for the most common operations: `Get-Printer-Attributes` and `Print-Job`.
- Auto-detection of common document MIME types (PDF, PostScript, PWG raster, PNG, JPEG, GIF).
- HTTP Basic (or any `Authorization` header) for password-protected queues.
- Typed error classes (`IppOperationError`, `IppClientError`, `IppDecodeError`) carrying the IPP status code, human-readable name, and decode offset.

## Installation

```sh
npm install @pnosolutions/ipp-client
# or
pnpm add @pnosolutions/ipp-client
# or
yarn add @pnosolutions/ipp-client
```

`@pnosolutions/ipp-core` is installed automatically as a dependency of the client. Install it directly only if you want to work with raw IPP messages.

## Quick start

```ts
import { readFile } from 'node:fs/promises';
import { Printer } from '@pnosolutions/ipp-client';

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

## Usage

### `new Printer(uri, options?)`

Creates a printer wrapper for a given IPP URI. Both `ipp://` and `ipps://` are accepted and are mapped to `http://` and `https://` respectively under the hood.

```ts
const printer = new Printer('ipps://secure-printer.example.com/ipp/print', {
  username: 'alice', // sent as `requesting-user-name`
  auth: { username: 'alice', password: 's3cr3t' }, // HTTP Basic
  timeout: 5_000,
});
```

`username` is the IPP-level `requesting-user-name`; `auth` is HTTP transport
authentication and is unrelated to it. Credentials embedded in the URI are used
when `auth` is omitted:

```ts
// Equivalent to auth: { username: 'alice', password: 's3cr3t' }
new Printer('ipps://alice:s3cr3t@printer.local/ipp/print');
```

They are converted into an `Authorization` header and stripped from the URL -
`fetch` neither sends them nor errors on them, so leaving them in place would
silently produce unauthenticated requests. Pass a string to supply the header
verbatim (`auth: 'Bearer …'`).

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

The `raw` field is the unparsed `printer-attributes` group, useful for printer-specific attributes that the high-level interface does not expose yet.

Attributes the printer did not report are `null` (or `'unknown'` for the state enums) rather than `0`/`''`, so a genuine zero is distinguishable from a missing value.

### `printer.print(data, options?)`

Sends a `Print-Job` operation with the given bytes as the document. The MIME type is auto-detected from the data unless `documentFormat` is provided.

Supported job options:

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
  jobName?: string;
  fitToPage?: boolean;
}
```

The returned `PrintJob` contains the IPP-assigned `id` (`null` if the printer did not report one), `uri`, `state`, and the `name` you submitted.

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

Members you leave out are omitted from the request, so the printer keeps its own defaults for them.

### Error handling

Operation-level failures (any IPP status code `>= 0x0400`) throw `IppOperationError`:

```ts
import { IppOperationError } from '@pnosolutions/ipp-client';

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

HTTP-level failures (non-2xx responses, or a `200` that isn't `application/ipp`) throw `IppClientError`. Timeouts surface as `AbortError`. A truncated or non-IPP response body throws `IppDecodeError` from `@pnosolutions/ipp-core`, carrying the byte `offset` where decoding gave up.

### `request-id`

RFC 8011 §4.1.1 defines `request-id` as a _signed_ 32-bit integer in the range `1..2**31 - 1`. A value with the high bit set is read back by the printer as negative and rejected, so the clock cannot be used raw - `Date.now()` overflows that range for roughly half of every 49.7-day cycle.

Each `IppClient` seeds its sequence from the wall clock (masked to 31 bits, spaced apart per client) and then counts up from there. The seed keeps separate clients - and separate processes, and restarts - from starting at the same place; counting rather than re-reading the clock keeps two requests issued in the same millisecond from sharing an ID, which is what `request-id` actually has to guarantee: uniqueness across one client's _outstanding_ requests.

Reusing an ID against a different client's connection is harmless - the printer only echoes it back so you can match your own responses. (CUPS sends `1` for every request it builds.)

Supply your own scheme via `requestId` if you need one. It must stay in range or `IppClient` throws before touching the network:

```ts
const client = new IppClient({
  uri: 'ipp://printer.local/ipp/print',
  requestId: (last) => (last === null || last >= 0x7fffffff ? 1 : last + 1),
});
```

Responses are checked to make sure the printer echoed the ID it was sent, which is what lets you trust that a response belongs to the request you made. A response ID of `0` is tolerated, since printers use it when they could not parse the request far enough to read one. Firmware that echoes something else entirely will need the check turned off:

```ts
new IppClient({ uri, validateResponseRequestId: false });
```

## Low-level usage

For operations not yet wrapped by `Printer`, drop down to `IppClient` and the core encoding API.

```ts
import { IppClient } from '@pnosolutions/ipp-client';
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

`@pnosolutions/ipp-core` exports `encodeIppRequest` / `decodeIppResponse` as well, if you want to handle transport yourself:

```ts
import {
  decodeIppResponse,
  encodeIppRequest,
  IppOperation,
  IppTag,
} from '@pnosolutions/ipp-core';

const buffer = encodeIppRequest({
  operation: IppOperation.GetPrinterAttributes,
  groups: [
    /* ... */
  ],
});

const response = decodeIppResponse(receivedBytes);
```

### Collections

Collections encode and decode symmetrically. Use the `begCollection` tag and give a plain object as the value; nesting and multiple values work as you would expect:

```ts
{
  tag: IppTag.BegCollection,
  name: 'media-col',
  value: {
    'media-size': { 'x-dimension': 5715, 'y-dimension': 3175 },
    'media-type': 'labels',
    'media-top-margin': 0,
  },
}
```

Member value tags are inferred from the JavaScript type - numbers become `integer`, booleans `boolean`, objects nested collections, and **strings `keyword`**, which covers most collection members but not all. Wrap a member to say otherwise:

```ts
value: {
  'media-source': 'main-roll',                                    // keyword
  'some-uri': { tag: IppTag.Uri, value: 'ipp://printer/x' },      // explicit
}
```

An array as the attribute value means several collections under one name; an array as a member value means a multi-valued member.

## Compatibility

- Node.js 20.3 or newer. The library itself is engine-agnostic, but it needs global `fetch`, `AbortSignal.timeout` (Node 17.3+) and `AbortSignal.any` (Node 20.3+).
- Designed against [RFC 8011](https://datatracker.ietf.org/doc/html/rfc8011) (IPP/1.1) and the PWG IPP Everywhere profile.
- Tested informally against CUPS and PWG raster–capable label printers. Reports of compatibility with other firmware are welcome.

## Development

This repo uses [pnpm](https://pnpm.io/) workspaces.

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck   # tsc -b (sources) + tsc -p tsconfig.test.json (tests)
pnpm lint
```

## License

[ISC](./LICENSE) © PNO Solutions Limited
