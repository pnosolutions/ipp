# @pnosolutions/ipp-core

Zero-dependency encoder and decoder for [Internet Printing Protocol](https://datatracker.ietf.org/doc/html/rfc8011) messages, plus the type definitions and tag/operation/status constants that go with them.

This package handles the wire format only — turning an `IppRequest` into bytes and bytes back into an `IppResponse`. It does no I/O. If you want a client that talks to a printer over HTTP, use [`@pnosolutions/ipp`](../client), which is built on this.

## Installation

```sh
npm install @pnosolutions/ipp-core
# or
pnpm add @pnosolutions/ipp-core
# or
yarn add @pnosolutions/ipp-core
```

ESM-only. Requires Node.js 18 or newer (or any runtime with `TextEncoder`/`TextDecoder`) — this package uses no Node.js built-ins.

## Quick start

```ts
import {
  decodeIppResponse,
  encodeIppRequest,
  getAttribute,
  IppOperation,
  IppTag,
} from '@pnosolutions/ipp-core';

const body = encodeIppRequest({
  operation: IppOperation.GetPrinterAttributes,
  groups: [
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
  ],
});

const http = await fetch('http://printer.local:631/ipp/print', {
  method: 'POST',
  headers: { 'Content-Type': 'application/ipp' },
  body,
});

const response = decodeIppResponse(new Uint8Array(await http.arrayBuffer()));

console.log(response.statusCode);
console.log(getAttribute(response, 'printer-state-reasons'));
```

## API

### `encodeIppRequest(request): Uint8Array`

Serializes an `IppRequest` into an IPP message body.

```ts
interface IppRequest {
  version?: readonly [number, number]; // defaults to IppVersion.V2_0
  operation: IppOperationId;
  requestId?: number; // defaults to 1
  groups: IppAttributeGroup[];
  data?: Uint8Array; // document data, appended after end-of-attributes
}
```

The end-of-attributes delimiter is written for you; groups are emitted in the order given. An attribute whose `value` is an array is encoded as a multi-valued attribute (the first record carries the name, the rest carry an empty name), which is what the protocol requires.

### `decodeIppResponse(data): IppResponse`

Parses an IPP message body.

```ts
interface IppResponse {
  version: [number, number];
  statusCode: number;
  requestId: number;
  groups: IppAttributeGroup[];
  data?: Uint8Array; // anything after end-of-attributes
}
```

Decoding is deliberately forgiving about individual values and strict about the framing:

- Every length-prefixed read is bounds-checked. A truncated or non-IPP body throws `IppDecodeError` with the byte `offset` where decoding gave up, instead of a bare `RangeError` from `DataView`.
- A value whose length does not match what its tag implies (printers do send short or empty records) is returned verbatim as a `Uint8Array` rather than throwing, so one malformed attribute does not sink the whole response.

### `getAttributes(response, groupTag?)` / `getAttribute(response, name, groupTag?)`

Flatten the group structure into a name → value map, or pull out a single value. Pass a group tag to restrict the search:

```ts
const printerAttrs = getAttributes(response, IppTag.PrinterAttributes);
const jobId = getAttribute(response, 'job-id', IppTag.JobAttributes);
```

### `CollectionParser`

Parses the CUPS-style textual form of a collection — `{key=value nested={a=1 b=2}}` — into an `IppCollection`. Some printers report attributes such as `media-col-ready` as a plain string in this shape rather than as a `begCollection` record.

```ts
const parsed = new CollectionParser(
  '{media-size={x-dimension=5715 y-dimension=3175} media-type=labels}',
).parseObject();
// { 'media-size': { 'x-dimension': 5715, 'y-dimension': 3175 }, 'media-type': 'labels' }
```

Bare tokens are coerced to `boolean`, `number`, or left as `string`.

## Value mapping

| IPP type                                    | JavaScript value                                      |
| ------------------------------------------- | ----------------------------------------------------- |
| `integer`, `enum`                           | `number`                                              |
| `boolean`                                   | `boolean`                                             |
| `keyword`, `uri`, `charset`, `text…`, etc.  | `string`                                              |
| `textWithLanguage`, `nameWithLanguage`      | `{ language: string; value: string }`                 |
| `resolution`                                | `{ x: number; y: number; units: number }`             |
| `begCollection` … `endCollection`           | plain object (`IppCollection`), nesting preserved     |
| `octetString`, `dateTime`, `rangeOfInteger` | `Uint8Array` (raw bytes, for the caller to interpret) |
| `no-value`, `unknown`, `unsupported`        | `''`                                                  |
| multi-valued attribute                      | array of the above                                    |

`IppResolutionUnit.DotsPerInch` (3) and `IppResolutionUnit.DotsPerCentimeter` (4) name the `units` values.

## Collections

Collections encode and decode symmetrically. Use the `begCollection` tag and give a plain object as the value:

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

Member value tags are inferred from the JavaScript type — numbers become `integer`, booleans `boolean`, objects nested collections, and **strings `keyword`**, which covers most collection members but not all. Wrap a member in an `IppTypedValue` to say otherwise:

```ts
value: {
  'media-source': 'main-roll',                               // inferred keyword
  'some-uri': { tag: IppTag.Uri, value: 'ipp://printer/x' }, // explicit
}
```

`IppTypedValue` is encode-only; decoding never produces that shape.

An array as the _attribute_ value means several collections under one name; an array as a _member_ value means a multi-valued member.

## Constants

- `IppVersion` — `V1_1`, `V2_0`.
- `IppOperation` — the operation IDs this library names (`PrintJob`, `ValidateJob`, `CreateJob`, `SendDocument`, `CancelJob`, `GetJobAttributes`, `GetJobs`, `GetPrinterAttributes`, `PausePrinter`, `ResumePrinter`, `IdentifyPrinter`). Any other operation ID works too — `operation` is just a number on the wire.
- `IppStatusCode` — common success and error codes.
- `IppTag` — delimiter, out-of-band, integer, octet-string, and character-string value tags.

## Errors

`IppDecodeError` is thrown when a message cannot be framed. It carries `offset`, the byte position where decoding stopped, so a raw capture can be lined up against it.

```ts
import { IppDecodeError } from '@pnosolutions/ipp-core';

try {
  decodeIppResponse(bytes);
} catch (err) {
  if (err instanceof IppDecodeError) {
    console.error(`bad IPP message at byte ${err.offset}: ${err.message}`);
  }
}
```

## License

[ISC](../../LICENSE) © PNO Solutions Limited
