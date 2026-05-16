# ipp

A TypeScript implementation of the [Internet Printing Protocol (IPP)](https://datatracker.ietf.org/doc/html/rfc8011) for Node.js.

This repository is a small monorepo with two packages:

| Package                                         | Description                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`@pnosolutions/ipp-core`](./packages/core)     | Zero-dependency IPP message encoder/decoder, type definitions, and tag/operation constants.       |
| [`@pnosolutions/ipp-client`](./packages/client) | High-level client for talking to IPP printers — query status, submit print jobs, parse responses. |

> **Status:** early `0.1.0`. The API surface is intentionally small and may shift.

## Features

- Pure TypeScript, ESM-only, runs on Node.js with `fetch` (Node 18+).
- Speaks IPP/1.1 and IPP/2.0 over HTTP and HTTPS (`ipp://` and `ipps://` URIs are normalized to `http://` / `https://`).
- Encode and decode IPP messages, including collections (`begCollection` / `endCollection`), resolutions, and `media-col` structures.
- High-level helpers for the most common operations: `Get-Printer-Attributes` and `Print-Job`.
- Auto-detection of common document MIME types (PDF, PostScript, PWG raster, PNG, JPEG, GIF).
- Typed error class (`IppOperationError`) carrying the IPP status code and human-readable name.

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
});
```

### `printer.status()`

Sends `Get-Printer-Attributes` and returns a normalized snapshot:

```ts
const {
  name, // printer-name
  uri, // printer-uri-supported (or the URI you passed in)
  state, // 'idle' | 'processing' | 'stopped' | `unknown:${n}`
  stateReasons, // string[]
  supportedFormats, // document-format-supported
  supportedMedia, // media-supported
  readyMedia, // parsed media-col-ready (size, margins, source, type)
  raw, // full attribute dictionary, untouched
} = await printer.status();
```

The `raw` field is the unparsed `printer-attributes` group, useful for printer-specific attributes that the high-level interface does not expose yet.

### `printer.print(data, options?)`

Sends a `Print-Job` operation with the given bytes as the document. The MIME type is auto-detected from the data unless `documentFormat` is provided.

Supported job options:

```ts
interface PrintJobOptions {
  copies?: number;
  media?: string; // e.g. 'iso_a4_210x297mm'
  orientation?: 'portrait' | 'landscape';
  quality?: 'draft' | 'normal' | 'high';
  sides?: 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
  colorMode?: 'color' | 'monochrome';
  documentFormat?: string; // override MIME detection
  jobName?: string;
  fitToPage?: boolean;
}
```

The returned `PrintJob` contains the IPP-assigned `id`, `uri`, `state`, and the `name` you submitted.

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

HTTP-level failures (non-`200` responses) and timeouts surface as regular `Error`s and `AbortError`s.

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

## Compatibility

- Node.js 18 or newer (uses the global `fetch`, `AbortSignal.timeout`, and `AbortSignal.any`).
- Designed against [RFC 8011](https://datatracker.ietf.org/doc/html/rfc8011) (IPP/1.1) and the PWG IPP Everywhere profile.
- Tested informally against CUPS and PWG raster–capable label printers. Reports of compatibility with other firmware are welcome.

## Development

This repo uses [pnpm](https://pnpm.io/) workspaces.

```sh
pnpm install
pnpm -r build
pnpm -r test
```


## License

[ISC](./LICENSE) © PNO Solutions Limited
