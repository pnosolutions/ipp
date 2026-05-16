import { describe, expect, it } from 'vitest';

import {
  decodeIppResponse,
  encodeIppRequest,
  getAttribute,
  getAttributes,
} from './encoding';
import {
  IppOperation,
  IppResolutionUnit,
  IppTag,
  IppVersion,
} from './types';

import type { IppRequest, IppResolution, IppResponse } from './types';

const textEncoder = new TextEncoder();

function viewOf(arr: Uint8Array): DataView {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe('encodeIppRequest', () => {
  it('writes header with provided version, operation, and requestId', () => {
    const req: IppRequest = {
      version: IppVersion.V1_1,
      operation: IppOperation.GetPrinterAttributes,
      requestId: 0x01020304,
      groups: [],
    };
    const out = encodeIppRequest(req);
    const view = viewOf(out);

    expect(out[0]).toBe(1);
    expect(out[1]).toBe(1);
    expect(view.getUint16(2, false)).toBe(IppOperation.GetPrinterAttributes);
    expect(view.getUint32(4, false)).toBe(0x01020304);
    // Then immediately EndOfAttributes since groups is empty
    expect(out[8]).toBe(IppTag.EndOfAttributes);
    expect(out.length).toBe(9);
  });

  it('defaults to IPP v2.0 and requestId 1 when omitted', () => {
    const out = encodeIppRequest({
      operation: IppOperation.GetPrinterAttributes,
      groups: [],
    });
    const view = viewOf(out);

    expect(out[0]).toBe(2);
    expect(out[1]).toBe(0);
    expect(view.getUint32(4, false)).toBe(1);
  });

  it('emits group delimiter tags before their attributes', () => {
    const out = encodeIppRequest({
      operation: IppOperation.GetPrinterAttributes,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            {
              tag: IppTag.Charset,
              name: 'attributes-charset',
              value: 'utf-8',
            },
          ],
        },
      ],
    });

    // header is 8 bytes, then delimiter tag
    expect(out[8]).toBe(IppTag.OperationAttributes);
    // attribute tag follows
    expect(out[9]).toBe(IppTag.Charset);
    // last byte is EndOfAttributes
    expect(out[out.length - 1]).toBe(IppTag.EndOfAttributes);
  });

  it('appends document data after EndOfAttributes', () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const out = encodeIppRequest({
      operation: IppOperation.PrintJob,
      requestId: 1,
      groups: [],
      data,
    });
    // header(8) + EndOfAttributes(1) + data(4)
    expect(out.length).toBe(13);
    expect(out[8]).toBe(IppTag.EndOfAttributes);
    expect(Array.from(out.slice(9))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('encodes a string attribute with tag, name-length, name, value-length, value', () => {
    const out = encodeIppRequest({
      operation: IppOperation.GetPrinterAttributes,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            {
              tag: IppTag.Charset,
              name: 'attributes-charset',
              value: 'utf-8',
            },
          ],
        },
      ],
    });

    // Slice past header(8) + group delimiter(1)
    const attr = out.subarray(9);
    const view = viewOf(attr);
    expect(attr[0]).toBe(IppTag.Charset);
    const nameLen = view.getUint16(1, false);
    expect(nameLen).toBe('attributes-charset'.length);
    const name = new TextDecoder().decode(attr.subarray(3, 3 + nameLen));
    expect(name).toBe('attributes-charset');
    const valLen = view.getUint16(3 + nameLen, false);
    expect(valLen).toBe('utf-8'.length);
    const val = new TextDecoder().decode(
      attr.subarray(3 + nameLen + 2, 3 + nameLen + 2 + valLen),
    );
    expect(val).toBe('utf-8');
  });

  it('encodes an integer attribute as 4-byte big-endian', () => {
    const out = encodeIppRequest({
      operation: IppOperation.PrintJob,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            { tag: IppTag.Integer, name: 'copies', value: 0x12345678 },
          ],
        },
      ],
    });

    const attr = out.subarray(9);
    const view = viewOf(attr);
    expect(attr[0]).toBe(IppTag.Integer);
    const nameLen = view.getUint16(1, false);
    const valLenOffset = 3 + nameLen;
    expect(view.getUint16(valLenOffset, false)).toBe(4);
    expect(view.getInt32(valLenOffset + 2, false)).toBe(0x12345678);
  });

  it('encodes a boolean attribute as a single byte', () => {
    const out = encodeIppRequest({
      operation: IppOperation.PrintJob,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            { tag: IppTag.Boolean, name: 't', value: true },
            { tag: IppTag.Boolean, name: 'f', value: false },
          ],
        },
      ],
    });

    // group delimiter at 8, first attribute tag at 9
    // attribute layout: tag(1) + nameLen(2) + name(1='t') + valLen(2) + val(1) = 7 bytes
    const first = out.subarray(9, 9 + 7);
    expect(first[0]).toBe(IppTag.Boolean);
    expect(viewOf(first).getUint16(1, false)).toBe(1);
    expect(first[3]).toBe('t'.charCodeAt(0));
    expect(viewOf(first).getUint16(4, false)).toBe(1);
    expect(first[6]).toBe(1);

    const second = out.subarray(9 + 7, 9 + 14);
    expect(second[6]).toBe(0);
  });

  it('encodes multi-valued attribute with name only on first value', () => {
    const out = encodeIppRequest({
      operation: IppOperation.PrintJob,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            {
              tag: IppTag.Keyword,
              name: 'media-supported',
              value: ['a4', 'letter'],
            },
          ],
        },
      ],
    });

    const attr = out.subarray(9);
    const view = viewOf(attr);
    expect(attr[0]).toBe(IppTag.Keyword);
    const firstNameLen = view.getUint16(1, false);
    expect(firstNameLen).toBe('media-supported'.length);
    const firstValLenOffset = 3 + firstNameLen;
    const firstValLen = view.getUint16(firstValLenOffset, false);
    expect(firstValLen).toBe(2); // 'a4'

    const secondStart = firstValLenOffset + 2 + firstValLen;
    expect(attr[secondStart]).toBe(IppTag.Keyword);
    expect(view.getUint16(secondStart + 1, false)).toBe(0); // empty name
    expect(view.getUint16(secondStart + 3, false)).toBe(6); // 'letter'
  });

  it('passes through a Uint8Array value for octet-style tags', () => {
    const range = new Uint8Array(8);
    viewOf(range).setInt32(0, 1, false);
    viewOf(range).setInt32(4, 100, false);

    const out = encodeIppRequest({
      operation: IppOperation.PrintJob,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            { tag: IppTag.RangeOfInteger, name: 'page-ranges', value: range },
          ],
        },
      ],
    });

    const attr = out.subarray(9);
    const view = viewOf(attr);
    const nameLen = view.getUint16(1, false);
    const valLenOffset = 3 + nameLen;
    expect(view.getUint16(valLenOffset, false)).toBe(8);
    expect(view.getInt32(valLenOffset + 2, false)).toBe(1);
    expect(view.getInt32(valLenOffset + 6, false)).toBe(100);
  });

  it('encodes a Resolution as two int32s and a signed byte', () => {
    const out = encodeIppRequest({
      operation: IppOperation.PrintJob,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            {
              tag: IppTag.Resolution,
              name: 'printer-resolution-default',
              value: { x: 600, y: 1200, units: IppResolutionUnit.DotsPerInch },
            },
          ],
        },
      ],
    });

    const attr = out.subarray(9);
    const view = viewOf(attr);
    expect(attr[0]).toBe(IppTag.Resolution);
    const nameLen = view.getUint16(1, false);
    const valLenOffset = 3 + nameLen;
    expect(view.getUint16(valLenOffset, false)).toBe(9);
    expect(view.getInt32(valLenOffset + 2, false)).toBe(600);
    expect(view.getInt32(valLenOffset + 6, false)).toBe(1200);
    expect(view.getInt8(valLenOffset + 10)).toBe(IppResolutionUnit.DotsPerInch);
  });

  it('passes through a Uint8Array Resolution value unchanged', () => {
    const raw = new Uint8Array([0, 0, 1, 0x2c, 0, 0, 2, 0x58, 4]); // 300 x 600 dpcm
    const out = encodeIppRequest({
      operation: IppOperation.PrintJob,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            {
              tag: IppTag.Resolution,
              name: 'printer-resolution-default',
              value: raw,
            },
          ],
        },
      ],
    });

    const attr = out.subarray(9);
    const view = viewOf(attr);
    const nameLen = view.getUint16(1, false);
    const valLenOffset = 3 + nameLen;
    expect(view.getUint16(valLenOffset, false)).toBe(9);
    expect(Array.from(attr.subarray(valLenOffset + 2, valLenOffset + 11))).toEqual(
      Array.from(raw),
    );
  });

  it('emits zero-length value for NoValue / Unknown / Unsupported tags', () => {
    const out = encodeIppRequest({
      operation: IppOperation.GetPrinterAttributes,
      requestId: 1,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [{ tag: IppTag.NoValue, name: 'job-name', value: '' }],
        },
      ],
    });

    const attr = out.subarray(9);
    const view = viewOf(attr);
    const nameLen = view.getUint16(1, false);
    expect(view.getUint16(3 + nameLen, false)).toBe(0);
  });
});

describe('decodeIppResponse', () => {
  function buildResponse(opts: {
    versionMajor?: number;
    versionMinor?: number;
    statusCode?: number;
    requestId?: number;
    body?: Uint8Array;
  }): Uint8Array {
    const header = new Uint8Array(8);
    const v = viewOf(header);
    v.setUint8(0, opts.versionMajor ?? 2);
    v.setUint8(1, opts.versionMinor ?? 0);
    v.setUint16(2, opts.statusCode ?? 0, false);
    v.setUint32(4, opts.requestId ?? 1, false);
    return concat([
      header,
      opts.body ?? new Uint8Array([IppTag.EndOfAttributes]),
    ]);
  }

  function buildStringAttribute(
    tag: number,
    name: string,
    value: string,
  ): Uint8Array {
    const nameBytes = textEncoder.encode(name);
    const valBytes = textEncoder.encode(value);
    const out = new Uint8Array(1 + 2 + nameBytes.length + 2 + valBytes.length);
    const view = viewOf(out);
    view.setUint8(0, tag);
    view.setUint16(1, nameBytes.length, false);
    out.set(nameBytes, 3);
    view.setUint16(3 + nameBytes.length, valBytes.length, false);
    out.set(valBytes, 3 + nameBytes.length + 2);
    return out;
  }

  function buildIntAttribute(
    tag: number,
    name: string,
    value: number,
  ): Uint8Array {
    const nameBytes = textEncoder.encode(name);
    const out = new Uint8Array(1 + 2 + nameBytes.length + 2 + 4);
    const view = viewOf(out);
    view.setUint8(0, tag);
    view.setUint16(1, nameBytes.length, false);
    out.set(nameBytes, 3);
    view.setUint16(3 + nameBytes.length, 4, false);
    view.setInt32(3 + nameBytes.length + 2, value, false);
    return out;
  }

  it('decodes header fields', () => {
    const data = buildResponse({
      versionMajor: 2,
      versionMinor: 0,
      statusCode: 0x0000,
      requestId: 42,
    });
    const res = decodeIppResponse(data);
    expect(res.version).toEqual([2, 0]);
    expect(res.statusCode).toBe(0x0000);
    expect(res.requestId).toBe(42);
    expect(res.groups).toEqual([]);
    expect(res.data).toBeUndefined();
  });

  it('decodes a group with a single string attribute', () => {
    const body = concat([
      new Uint8Array([IppTag.OperationAttributes]),
      buildStringAttribute(IppTag.Charset, 'attributes-charset', 'utf-8'),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));

    expect(res.groups.length).toBe(1);
    const group = res.groups[0];
    expect(group.tag).toBe(IppTag.OperationAttributes);
    expect(group.attributes.length).toBe(1);
    expect(group.attributes[0]).toEqual({
      tag: IppTag.Charset,
      name: 'attributes-charset',
      value: 'utf-8',
    });
  });

  it('decodes integer and boolean attributes', () => {
    const boolAttr = new Uint8Array(1 + 2 + 1 + 2 + 1);
    const bv = viewOf(boolAttr);
    bv.setUint8(0, IppTag.Boolean);
    bv.setUint16(1, 1, false);
    boolAttr[3] = 'x'.charCodeAt(0);
    bv.setUint16(4, 1, false);
    boolAttr[6] = 1;

    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      buildIntAttribute(IppTag.Integer, 'copies-supported', 99),
      boolAttr,
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));

    const attrs = res.groups[0].attributes;
    expect(attrs[0].value).toBe(99);
    expect(attrs[1].value).toBe(true);
  });

  it('coalesces additional values into multi-valued attribute array', () => {
    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      buildStringAttribute(IppTag.Keyword, 'media-supported', 'a4'),
      // Second value: same tag, empty name
      buildStringAttribute(IppTag.Keyword, '', 'letter'),
      buildStringAttribute(IppTag.Keyword, '', 'legal'),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));

    const attrs = res.groups[0].attributes;
    expect(attrs.length).toBe(1);
    expect(attrs[0].name).toBe('media-supported');
    expect(attrs[0].value).toEqual(['a4', 'letter', 'legal']);
  });

  it('decodes document data trailing EndOfAttributes', () => {
    const body = concat([
      new Uint8Array([IppTag.EndOfAttributes]),
      new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));
    expect(res.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(res.data ?? [])).toEqual([0xca, 0xfe, 0xba, 0xbe]);
  });

  it('returns Uint8Array for octet/range/datetime values', () => {
    const range = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 10]);
    const nameBytes = textEncoder.encode('page-ranges');
    const attr = new Uint8Array(1 + 2 + nameBytes.length + 2 + range.length);
    const view = viewOf(attr);
    view.setUint8(0, IppTag.RangeOfInteger);
    view.setUint16(1, nameBytes.length, false);
    attr.set(nameBytes, 3);
    view.setUint16(3 + nameBytes.length, range.length, false);
    attr.set(range, 3 + nameBytes.length + 2);

    const body = concat([
      new Uint8Array([IppTag.JobAttributes]),
      attr,
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));
    const value = res.groups[0].attributes[0].value;
    expect(value).toBeInstanceOf(Uint8Array);
    expect(Array.from(value as Uint8Array)).toEqual(Array.from(range));
  });

  it('decodes Resolution into { x, y, units } per RFC 8011 §5.1.16', () => {
    const raw = new Uint8Array(9);
    const rawView = viewOf(raw);
    rawView.setInt32(0, 600, false);
    rawView.setInt32(4, 1200, false);
    rawView.setInt8(8, IppResolutionUnit.DotsPerInch);

    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      buildRecord(IppTag.Resolution, 'printer-resolution-default', raw),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));
    expect(res.groups[0].attributes[0].value).toEqual({
      x: 600,
      y: 1200,
      units: IppResolutionUnit.DotsPerInch,
    });
  });

  it('decodes Resolution with dots-per-centimeter units', () => {
    const raw = new Uint8Array(9);
    const rawView = viewOf(raw);
    rawView.setInt32(0, 118, false);
    rawView.setInt32(4, 236, false);
    rawView.setInt8(8, IppResolutionUnit.DotsPerCentimeter);

    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      buildRecord(IppTag.Resolution, 'printer-resolution-supported', raw),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));
    expect(res.groups[0].attributes[0].value).toEqual({
      x: 118,
      y: 236,
      units: IppResolutionUnit.DotsPerCentimeter,
    });
  });

  it('round-trips a Resolution through encode and decode', () => {
    const original: IppResolution = {
      x: 300,
      y: 300,
      units: IppResolutionUnit.DotsPerInch,
    };

    const encoded = encodeIppRequest({
      operation: IppOperation.GetPrinterAttributes,
      requestId: 1,
      groups: [
        {
          tag: IppTag.PrinterAttributes,
          attributes: [
            {
              tag: IppTag.Resolution,
              name: 'printer-resolution-default',
              value: original,
            },
          ],
        },
      ],
    });

    // Re-frame the encoded request as a response (same header layout) by
    // overwriting bytes 2-3 with a status code rather than operation id.
    viewOf(encoded).setUint16(2, 0, false);
    const res = decodeIppResponse(encoded);
    expect(res.groups[0].attributes[0].value).toEqual(original);
  });

  it('returns empty string for out-of-band tags (NoValue/Unknown/Unsupported)', () => {
    const nameBytes = textEncoder.encode('job-name');
    const attr = new Uint8Array(1 + 2 + nameBytes.length + 2);
    const view = viewOf(attr);
    view.setUint8(0, IppTag.NoValue);
    view.setUint16(1, nameBytes.length, false);
    attr.set(nameBytes, 3);
    view.setUint16(3 + nameBytes.length, 0, false);

    const body = concat([
      new Uint8Array([IppTag.JobAttributes]),
      attr,
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));
    expect(res.groups[0].attributes[0].value).toBe('');
  });

  function buildRecord(
    tag: number,
    name: string,
    value: Uint8Array,
  ): Uint8Array {
    const nameBytes = textEncoder.encode(name);
    const out = new Uint8Array(1 + 2 + nameBytes.length + 2 + value.length);
    const view = viewOf(out);
    view.setUint8(0, tag);
    view.setUint16(1, nameBytes.length, false);
    out.set(nameBytes, 3);
    view.setUint16(3 + nameBytes.length, value.length, false);
    out.set(value, 3 + nameBytes.length + 2);
    return out;
  }

  function int32(n: number): Uint8Array {
    const buf = new Uint8Array(4);
    viewOf(buf).setInt32(0, n, false);
    return buf;
  }

  it('decodes a collection attribute into a nested object', () => {
    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      buildRecord(IppTag.BegCollection, 'media-col-ready', new Uint8Array(0)),
      buildRecord(
        IppTag.MemberAttrName,
        '',
        textEncoder.encode('media-bottom-margin'),
      ),
      buildRecord(IppTag.Integer, '', int32(1)),
      buildRecord(
        IppTag.MemberAttrName,
        '',
        textEncoder.encode('media-source'),
      ),
      buildRecord(IppTag.Keyword, '', textEncoder.encode('main-roll')),
      buildRecord(IppTag.EndCollection, '', new Uint8Array(0)),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));

    expect(res.groups[0].attributes.length).toBe(1);
    expect(res.groups[0].attributes[0]).toEqual({
      tag: IppTag.BegCollection,
      name: 'media-col-ready',
      value: {
        'media-bottom-margin': 1,
        'media-source': 'main-roll',
      },
    });
  });

  it('decodes nested collections', () => {
    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      buildRecord(IppTag.BegCollection, 'media-col-ready', new Uint8Array(0)),
      buildRecord(IppTag.MemberAttrName, '', textEncoder.encode('media-size')),
      buildRecord(IppTag.BegCollection, '', new Uint8Array(0)),
      buildRecord(IppTag.MemberAttrName, '', textEncoder.encode('x-dimension')),
      buildRecord(IppTag.Integer, '', int32(5715)),
      buildRecord(IppTag.MemberAttrName, '', textEncoder.encode('y-dimension')),
      buildRecord(IppTag.Integer, '', int32(3175)),
      buildRecord(IppTag.EndCollection, '', new Uint8Array(0)),
      buildRecord(
        IppTag.MemberAttrName,
        '',
        textEncoder.encode('media-source'),
      ),
      buildRecord(IppTag.Keyword, '', textEncoder.encode('main-roll')),
      buildRecord(IppTag.EndCollection, '', new Uint8Array(0)),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));

    expect(res.groups[0].attributes[0].value).toEqual({
      'media-size': { 'x-dimension': 5715, 'y-dimension': 3175 },
      'media-source': 'main-roll',
    });
  });

  it('coalesces multi-valued collection attribute into an array of objects', () => {
    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      // First value: named collection
      buildRecord(
        IppTag.BegCollection,
        'media-col-supported',
        new Uint8Array(0),
      ),
      buildRecord(IppTag.MemberAttrName, '', textEncoder.encode('media-type')),
      buildRecord(IppTag.Keyword, '', textEncoder.encode('labels')),
      buildRecord(IppTag.EndCollection, '', new Uint8Array(0)),
      // Second value: empty name = additional value for the same attribute
      buildRecord(IppTag.BegCollection, '', new Uint8Array(0)),
      buildRecord(IppTag.MemberAttrName, '', textEncoder.encode('media-type')),
      buildRecord(IppTag.Keyword, '', textEncoder.encode('photographic')),
      buildRecord(IppTag.EndCollection, '', new Uint8Array(0)),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));

    expect(res.groups[0].attributes.length).toBe(1);
    expect(res.groups[0].attributes[0].name).toBe('media-col-supported');
    expect(res.groups[0].attributes[0].value).toEqual([
      { 'media-type': 'labels' },
      { 'media-type': 'photographic' },
    ]);
  });

  it('coalesces multi-valued members within a collection', () => {
    const body = concat([
      new Uint8Array([IppTag.PrinterAttributes]),
      buildRecord(IppTag.BegCollection, 'sample-col', new Uint8Array(0)),
      buildRecord(
        IppTag.MemberAttrName,
        '',
        textEncoder.encode('x-image-position'),
      ),
      buildRecord(IppTag.Keyword, '', textEncoder.encode('left')),
      buildRecord(IppTag.Keyword, '', textEncoder.encode('right')),
      buildRecord(IppTag.EndCollection, '', new Uint8Array(0)),
      new Uint8Array([IppTag.EndOfAttributes]),
    ]);
    const res = decodeIppResponse(buildResponse({ body }));

    expect(res.groups[0].attributes[0].value).toEqual({
      'x-image-position': ['left', 'right'],
    });
  });
});

describe('round-trip', () => {
  it('encodes then decodes preserving attribute values', () => {
    const requestId = 7;
    const request: IppRequest = {
      version: IppVersion.V2_0,
      operation: IppOperation.GetPrinterAttributes,
      requestId,
      groups: [
        {
          tag: IppTag.OperationAttributes,
          attributes: [
            {
              tag: IppTag.Charset,
              name: 'attributes-charset',
              value: 'utf-8',
            },
            {
              tag: IppTag.NaturalLanguage,
              name: 'attributes-natural-language',
              value: 'en-us',
            },
            { tag: IppTag.Integer, name: 'copies', value: 3 },
            { tag: IppTag.Boolean, name: 'duplex', value: true },
            {
              tag: IppTag.Keyword,
              name: 'media-supported',
              value: ['a4', 'letter'],
            },
          ],
        },
      ],
    };

    // The request layout is identical to a response except byte offset 2..4
    // holds operation instead of statusCode — decodeIppResponse treats it
    // structurally the same.
    const encoded = encodeIppRequest(request);
    const decoded: IppResponse = decodeIppResponse(encoded);

    expect(decoded.version).toEqual([2, 0]);
    expect(decoded.statusCode).toBe(IppOperation.GetPrinterAttributes);
    expect(decoded.requestId).toBe(requestId);
    expect(decoded.groups.length).toBe(1);

    const attrs = decoded.groups[0].attributes;
    expect(attrs[0]).toEqual({
      tag: IppTag.Charset,
      name: 'attributes-charset',
      value: 'utf-8',
    });
    expect(attrs[1].value).toBe('en-us');
    expect(attrs[2].value).toBe(3);
    expect(attrs[3].value).toBe(true);
    expect(attrs[4].name).toBe('media-supported');
    expect(attrs[4].value).toEqual(['a4', 'letter']);
  });
});

describe('getAttributes / getAttribute', () => {
  const response: IppResponse = {
    version: [2, 0],
    statusCode: 0,
    requestId: 1,
    groups: [
      {
        tag: IppTag.OperationAttributes,
        attributes: [
          { tag: IppTag.Charset, name: 'attributes-charset', value: 'utf-8' },
        ],
      },
      {
        tag: IppTag.PrinterAttributes,
        attributes: [
          { tag: IppTag.Keyword, name: 'printer-state', value: 'idle' },
          { tag: IppTag.Integer, name: 'copies-supported', value: 99 },
          // attribute with empty name should be skipped by getAttributes
          { tag: IppTag.Keyword, name: '', value: 'ignored' },
        ],
      },
    ],
  };

  it('getAttributes returns flat map across all groups by default', () => {
    const map = getAttributes(response);
    expect(map['attributes-charset']).toBe('utf-8');
    expect(map['printer-state']).toBe('idle');
    expect(map['copies-supported']).toBe(99);
    // empty-name attribute excluded
    expect(Object.keys(map).sort()).toEqual([
      'attributes-charset',
      'copies-supported',
      'printer-state',
    ]);
  });

  it('getAttributes filters by groupTag when provided', () => {
    const map = getAttributes(response, IppTag.PrinterAttributes);
    expect(map['printer-state']).toBe('idle');
    expect(map['attributes-charset']).toBeUndefined();
  });

  it('getAttribute returns the matching value', () => {
    expect(getAttribute(response, 'printer-state')).toBe('idle');
    expect(getAttribute(response, 'copies-supported')).toBe(99);
  });

  it('getAttribute returns undefined when not found', () => {
    expect(getAttribute(response, 'does-not-exist')).toBeUndefined();
  });

  it('getAttribute respects groupTag filter', () => {
    expect(
      getAttribute(response, 'printer-state', IppTag.OperationAttributes),
    ).toBeUndefined();
    expect(
      getAttribute(response, 'printer-state', IppTag.PrinterAttributes),
    ).toBe('idle');
  });
});
