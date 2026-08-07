/// Inspired by: https://github.com/stacksjs/ts-printers/blob/45b7d4e6b4292a1a455178ec305610e9feae1573/src/ipp/encoding.ts

import { IppDecodeError } from './errors';
import { IppTag, IppVersion } from './types';
import { concat, viewOf } from './utils';

import type {
  IppAttribute,
  IppAttributeGroup,
  IppAttributeValue,
  IppCollection,
  IppRequest,
  IppResolution,
  IppResponse,
  IppTextWithLanguage,
  IppTypedValue,
} from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

/**
 * Encode an IPP request into a binary buffer
 */
export function encodeIppRequest(request: IppRequest): Uint8Array<ArrayBuffer> {
  const version = request.version ?? IppVersion.V2_0;
  const requestId = request.requestId ?? 1;
  const chunks: Uint8Array[] = [];

  // Version (2 bytes)
  const header = new Uint8Array(8);
  const headerView = viewOf(header);
  headerView.setUint8(0, version[0]);
  headerView.setUint8(1, version[1]);
  // Operation ID (2 bytes)
  headerView.setUint16(2, request.operation, false);
  // Request ID (4 bytes)
  headerView.setUint32(4, requestId, false);

  chunks.push(header);

  // Attribute groups
  for (const group of request.groups) {
    // Group delimiter tag
    chunks.push(new Uint8Array([group.tag]));

    for (const attr of group.attributes) {
      chunks.push(encodeAttribute(attr));
    }
  }

  // End-of-attributes tag
  chunks.push(new Uint8Array([IppTag.EndOfAttributes]));

  // Optional document data
  if (request.data) {
    chunks.push(request.data);
  }

  return concat(chunks);
}

/**
 * Encode a single IPP attribute
 */
function encodeAttribute(attr: IppAttribute): Uint8Array {
  // Multi-valued attribute: first value has the name, subsequent values have empty name
  const values = Array.isArray(attr.value) ? attr.value : [attr.value];

  if (attr.tag === IppTag.BegCollection) {
    return concat(
      values.map((value, i) =>
        encodeCollection(i === 0 ? attr.name : '', value),
      ),
    );
  }

  return concat(
    values.map((value, i) =>
      encodeRecord(
        attr.tag,
        i === 0 ? attr.name : '',
        encodeValue(attr.tag, value),
      ),
    ),
  );
}

/** tag(1) + name-length(2) + name + value-length(2) + value */
function encodeRecord(
  tag: number,
  name: string,
  valueBytes: Uint8Array,
): Uint8Array {
  const nameBytes = textEncoder.encode(name);
  const buf = new Uint8Array(1 + 2 + nameBytes.length + 2 + valueBytes.length);
  const view = viewOf(buf);
  let offset = 0;

  view.setUint8(offset, tag);
  offset += 1;
  view.setUint16(offset, nameBytes.length, false);
  offset += 2;
  buf.set(nameBytes, offset);
  offset += nameBytes.length;
  view.setUint16(offset, valueBytes.length, false);
  offset += 2;
  buf.set(valueBytes, offset);

  return buf;
}

/**
 * Encode one collection value (RFC 8011 §5.1.15) as the record run
 *
 *   begCollection[name] (memberAttrName value...)* endCollection
 *
 * Nested collections repeat the run with an empty name. `name` is empty for
 * the second and later values of a multi-valued collection attribute.
 */
function encodeCollection(
  name: string,
  value: IppAttributeValue,
): Uint8Array<ArrayBuffer> {
  const empty = new Uint8Array(0);
  const chunks: Uint8Array[] = [
    encodeRecord(IppTag.BegCollection, name, empty),
  ];

  for (const [member, memberValue] of Object.entries(asCollection(value))) {
    chunks.push(
      encodeRecord(IppTag.MemberAttrName, '', textEncoder.encode(member)),
      ...encodeMemberValues(memberValue),
    );
  }

  chunks.push(encodeRecord(IppTag.EndCollection, '', empty));

  return concat(chunks);
}

/**
 * Encode the value records that follow a memberAttrName. A member may hold
 * several values, in which case each gets its own record.
 */
function encodeMemberValues(value: IppAttributeValue): Uint8Array[] {
  if (Array.isArray(value)) return value.flatMap(encodeMemberValues);

  const { tag, value: unwrapped } = isTypedValue(value)
    ? { tag: value.tag, value: value.value }
    : { tag: inferValueTag(value), value };

  if (tag === IppTag.BegCollection) {
    return [encodeCollection('', unwrapped)];
  }

  return [encodeRecord(tag, '', encodeValue(tag, unwrapped))];
}

/**
 * Pick a value tag for a collection member that was given as a bare
 * JavaScript value. Wrap the member in an {@link IppTypedValue} to override -
 * strings in particular are guessed as `keyword`, which is the common case for
 * collection members but not the only one.
 */
function inferValueTag(value: IppAttributeValue): number {
  if (typeof value === 'number') return IppTag.Integer;
  if (typeof value === 'boolean') return IppTag.Boolean;
  if (value instanceof Uint8Array) return IppTag.OctetString;
  if (isResolution(value)) return IppTag.Resolution;
  if (isTextWithLanguage(value)) return IppTag.TextWithLanguage;
  if (typeof value === 'object' && value !== null) return IppTag.BegCollection;
  return IppTag.Keyword;
}

function asCollection(value: IppAttributeValue): IppCollection {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Uint8Array
  ) {
    return {};
  }
  return value as IppCollection;
}

function isTypedValue(value: IppAttributeValue): value is IppTypedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    typeof (value as IppTypedValue).tag === 'number' &&
    'value' in value
  );
}

function isResolution(value: IppAttributeValue): value is IppResolution {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    typeof (value as IppResolution).x === 'number' &&
    typeof (value as IppResolution).y === 'number' &&
    typeof (value as IppResolution).units === 'number'
  );
}

function isTextWithLanguage(
  value: IppAttributeValue,
): value is IppTextWithLanguage {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    typeof (value as IppTextWithLanguage).language === 'string' &&
    typeof (value as IppTextWithLanguage).value === 'string'
  );
}

function encodeValue(tag: number, value: IppAttributeValue): Uint8Array {
  if (Array.isArray(value)) {
    // Should not reach here for multi-valued (handled above)
    const [first] = value;
    return first === undefined ? new Uint8Array(0) : encodeValue(tag, first);
  }

  switch (tag) {
    case IppTag.Integer:
    case IppTag.Enum: {
      const buf = new Uint8Array(4);
      viewOf(buf).setInt32(0, value as number, false);
      return buf;
    }
    case IppTag.Boolean: {
      return new Uint8Array([value ? 1 : 0]);
    }
    case IppTag.RangeOfInteger: {
      // Expect a Uint8Array with 8 bytes (lower + upper)
      if (value instanceof Uint8Array) return value;
      const buf = new Uint8Array(8);
      const view = viewOf(buf);
      view.setInt32(0, value as number, false);
      view.setInt32(4, value as number, false);
      return buf;
    }
    case IppTag.Resolution: {
      if (value instanceof Uint8Array) return value;
      const buf = new Uint8Array(9);
      if (isResolution(value)) {
        const view = viewOf(buf);
        view.setInt32(0, value.x, false);
        view.setInt32(4, value.y, false);
        view.setInt8(8, value.units);
      }
      return buf;
    }
    case IppTag.DateTime: {
      if (value instanceof Uint8Array) return value;
      return new Uint8Array(11);
    }
    case IppTag.TextWithLanguage:
    case IppTag.NameWithLanguage: {
      if (value instanceof Uint8Array) return value;
      // RFC 8011 §5.1.2.2: language-length(2) language text-length(2) text
      const { language, text } = isTextWithLanguage(value)
        ? { language: value.language, text: value.value }
        : { language: '', text: String(value) };

      const languageBytes = textEncoder.encode(language);
      const textBytes = textEncoder.encode(text);
      const buf = new Uint8Array(
        2 + languageBytes.length + 2 + textBytes.length,
      );
      const view = viewOf(buf);
      view.setUint16(0, languageBytes.length, false);
      buf.set(languageBytes, 2);
      view.setUint16(2 + languageBytes.length, textBytes.length, false);
      buf.set(textBytes, 4 + languageBytes.length);
      return buf;
    }
    // Out-of-band tags have no value. Neither do the collection delimiters -
    // they carry their payload in the surrounding record run.
    case IppTag.NoValue:
    case IppTag.Unknown:
    case IppTag.Unsupported:
    case IppTag.BegCollection:
    case IppTag.EndCollection: {
      return new Uint8Array(0);
    }
    default: {
      // All string-like types: textWithoutLanguage, nameWithoutLanguage, keyword, uri, charset, etc.
      if (value instanceof Uint8Array) return value;
      return textEncoder.encode(String(value));
    }
  }
}

interface DecodeCursor {
  pos: number;
}

/**
 * Guard every read against the end of the buffer so a truncated or non-IPP
 * response surfaces as an {@link IppDecodeError} instead of a bare
 * `RangeError` from `DataView`.
 */
function needBytes(
  data: Uint8Array,
  cursor: DecodeCursor,
  bytes: number,
  what: string,
): void {
  if (cursor.pos + bytes > data.length) {
    throw new IppDecodeError(
      `Truncated IPP message: need ${bytes} byte(s) for ${what} at offset ` +
        `${cursor.pos}, but only ${data.length - cursor.pos} remain`,
      cursor.pos,
    );
  }
}

function readNameAndValue(
  data: Uint8Array,
  view: DataView,
  cursor: DecodeCursor,
): { name: string; nameLength: number; rawValue: Uint8Array } {
  needBytes(data, cursor, 2, 'name-length');
  const nameLength = view.getUint16(cursor.pos, false);
  cursor.pos += 2;

  needBytes(data, cursor, nameLength, 'name');
  const name = textDecoder.decode(
    data.subarray(cursor.pos, cursor.pos + nameLength),
  );
  cursor.pos += nameLength;

  needBytes(data, cursor, 2, 'value-length');
  const valueLength = view.getUint16(cursor.pos, false);
  cursor.pos += 2;

  needBytes(data, cursor, valueLength, 'value');
  const rawValue = data.subarray(cursor.pos, cursor.pos + valueLength);
  cursor.pos += valueLength;

  return { name, nameLength, rawValue };
}

/**
 * Parse a collection body up to and including the EndCollection marker.
 * Cursor must be positioned immediately after a BegCollection record.
 */
function parseCollection(
  data: Uint8Array,
  view: DataView,
  cursor: DecodeCursor,
): IppCollection {
  const collection: IppCollection = {};
  let currentMember: string | null = null;

  while (cursor.pos < data.length) {
    const tag = view.getUint8(cursor.pos);
    cursor.pos += 1;
    const { nameLength, rawValue } = readNameAndValue(data, view, cursor);

    if (tag === IppTag.EndCollection) {
      return collection;
    }

    if (tag === IppTag.MemberAttrName) {
      currentMember = textDecoder.decode(rawValue);
      continue;
    }

    if (currentMember === null) {
      // Stray value without a preceding MemberAttrName; skip.
      continue;
    }

    const value: IppAttributeValue =
      tag === IppTag.BegCollection
        ? parseCollection(data, view, cursor)
        : decodeValue(tag, rawValue);

    const existing = collection[currentMember];
    if (nameLength === 0 && existing !== undefined) {
      collection[currentMember] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      collection[currentMember] = value;
    }
  }

  return collection;
}

/**
 * Decode an IPP response from a binary buffer
 */
export function decodeIppResponse(data: Uint8Array): IppResponse {
  const view = viewOf(data);
  const cursor: DecodeCursor = { pos: 0 };

  needBytes(data, cursor, 8, 'response header');

  // Version (2 bytes)
  const versionMajor = view.getUint8(cursor.pos);
  cursor.pos += 1;
  const versionMinor = view.getUint8(cursor.pos);
  cursor.pos += 1;

  // Status code (2 bytes)
  const statusCode = view.getUint16(cursor.pos, false);
  cursor.pos += 2;

  // Request ID (4 bytes)
  const requestId = view.getUint32(cursor.pos, false);
  cursor.pos += 4;

  // Parse attribute groups
  const groups: IppAttributeGroup[] = [];
  let currentGroup: IppAttributeGroup | null = null;

  while (cursor.pos < data.length) {
    const tag = view.getUint8(cursor.pos);
    cursor.pos += 1;

    if (tag === IppTag.EndOfAttributes) {
      break;
    }

    if (isDelimiterTag(tag)) {
      currentGroup = { tag, attributes: [] };
      groups.push(currentGroup);
      continue;
    }

    if (!currentGroup) {
      continue;
    }

    const { name, nameLength, rawValue } = readNameAndValue(data, view, cursor);

    const value: IppAttributeValue =
      tag === IppTag.BegCollection
        ? parseCollection(data, view, cursor)
        : decodeValue(tag, rawValue);

    const prevAttr = currentGroup.attributes.at(-1);
    if (nameLength === 0 && prevAttr) {
      prevAttr.value = Array.isArray(prevAttr.value)
        ? [...prevAttr.value, value]
        : [prevAttr.value, value];
    } else {
      currentGroup.attributes.push({ tag, name, value });
    }
  }

  // Remaining data after end-of-attributes is document data
  const remainingData =
    cursor.pos < data.length ? data.slice(cursor.pos) : undefined;

  return {
    version: [versionMajor, versionMinor],
    statusCode,
    requestId,
    groups,
    data: remainingData,
  };
}

function isDelimiterTag(tag: number): boolean {
  return tag >= 0x00 && tag <= 0x0f;
}

/**
 * Decode a value record. Values whose length does not match what the tag
 * implies are returned verbatim as bytes rather than throwing - printers do
 * emit short or empty records, and a malformed attribute should not sink the
 * whole response.
 */
function decodeValue(tag: number, raw: Uint8Array): IppAttributeValue {
  switch (tag) {
    case IppTag.Integer:
    case IppTag.Enum: {
      if (raw.length < 4) return raw.slice();
      return viewOf(raw).getInt32(0, false);
    }
    case IppTag.Boolean: {
      if (raw.length < 1) return raw.slice();
      return viewOf(raw).getUint8(0) !== 0;
    }
    case IppTag.RangeOfInteger: {
      // Return as Uint8Array for now, consumers can interpret
      return raw.slice();
    }
    case IppTag.Resolution: {
      // RFC 8011 §5.1.16: SIGNED-INTEGER xres, SIGNED-INTEGER yres, SIGNED-BYTE units
      if (raw.length < 9) return raw.slice();
      const view = viewOf(raw);
      const resolution: IppResolution = {
        x: view.getInt32(0, false),
        y: view.getInt32(4, false),
        units: view.getInt8(8),
      };
      return resolution;
    }
    case IppTag.TextWithLanguage:
    case IppTag.NameWithLanguage: {
      return decodeTextWithLanguage(raw);
    }
    case IppTag.DateTime: {
      return raw.slice();
    }
    case IppTag.NoValue:
    case IppTag.Unknown:
    case IppTag.Unsupported: {
      return '';
    }
    case IppTag.OctetString: {
      return raw.slice();
    }
    default: {
      // All string types
      return textDecoder.decode(raw);
    }
  }
}

/**
 * RFC 8011 §5.1.2.2: language-length(2) language text-length(2) text.
 * Falls back to a plain string for records that do not fit that shape.
 */
function decodeTextWithLanguage(raw: Uint8Array): IppTextWithLanguage | string {
  if (raw.length < 4) return textDecoder.decode(raw);

  const view = viewOf(raw);
  const languageLength = view.getUint16(0, false);
  if (2 + languageLength + 2 > raw.length) return textDecoder.decode(raw);

  const textLength = view.getUint16(2 + languageLength, false);
  const textStart = 4 + languageLength;
  if (textStart + textLength > raw.length) return textDecoder.decode(raw);

  return {
    language: textDecoder.decode(raw.subarray(2, 2 + languageLength)),
    value: textDecoder.decode(raw.subarray(textStart, textStart + textLength)),
  };
}

/**
 * Helper to get a flat map of attribute name -> value from response groups
 */
export function getAttributes(
  response: IppResponse,
  groupTag?: number,
): Record<string, IppAttributeValue> {
  const result: Record<string, IppAttributeValue> = {};

  for (const group of response.groups) {
    if (groupTag !== undefined && group.tag !== groupTag) continue;

    for (const attr of group.attributes) {
      if (attr.name) {
        result[attr.name] = attr.value;
      }
    }
  }

  return result;
}

/**
 * Helper to get a single attribute value
 */
export function getAttribute(
  response: IppResponse,
  name: string,
  groupTag?: number,
): IppAttributeValue | undefined {
  for (const group of response.groups) {
    if (groupTag !== undefined && group.tag !== groupTag) continue;

    for (const attr of group.attributes) {
      if (attr.name === name) {
        return attr.value;
      }
    }
  }
  return undefined;
}
