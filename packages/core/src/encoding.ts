/// Inspired by: https://github.com/stacksjs/ts-printers/blob/45b7d4e6b4292a1a455178ec305610e9feae1573/src/ipp/encoding.ts

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
  if (Array.isArray(attr.value)) {
    // Multi-valued attribute: first value has the name, subsequent values have empty name
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < attr.value.length; i++) {
      const singleAttr: IppAttribute = {
        tag: attr.tag,
        name: i === 0 ? attr.name : '',
        value: attr.value[i] as string | number | boolean | Uint8Array,
      };
      chunks.push(encodeSingleAttribute(singleAttr));
    }
    return concat(chunks);
  }

  return encodeSingleAttribute(attr);
}

function encodeSingleAttribute(attr: IppAttribute): Uint8Array {
  const nameBytes = textEncoder.encode(attr.name);
  const valueBytes = encodeValue(attr.tag, attr.value);

  // tag(1) + name-length(2) + name + value-length(2) + value
  const buf = new Uint8Array(1 + 2 + nameBytes.length + 2 + valueBytes.length);
  const view = viewOf(buf);
  let offset = 0;

  view.setUint8(offset, attr.tag);
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

function encodeValue(tag: number, value: IppAttributeValue): Uint8Array {
  if (Array.isArray(value)) {
    // Should not reach here for multi-valued (handled above)
    return encodeValue(tag, value[0]);
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
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof value.x === 'number' &&
        typeof value.y === 'number' &&
        typeof value.units === 'number'
      ) {
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
    case IppTag.NoValue:
    case IppTag.Unknown:
    case IppTag.Unsupported: {
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

function readNameAndValue(
  data: Uint8Array,
  view: DataView,
  cursor: DecodeCursor,
): { name: string; nameLength: number; rawValue: Uint8Array } {
  const nameLength = view.getUint16(cursor.pos, false);
  cursor.pos += 2;
  const name = textDecoder.decode(
    data.subarray(cursor.pos, cursor.pos + nameLength),
  );
  cursor.pos += nameLength;
  const valueLength = view.getUint16(cursor.pos, false);
  cursor.pos += 2;
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

    if (nameLength === 0 && currentMember in collection) {
      const existing = collection[currentMember];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        collection[currentMember] = [existing, value];
      }
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

    if (nameLength === 0 && currentGroup.attributes.length > 0) {
      const prevAttr =
        currentGroup.attributes[currentGroup.attributes.length - 1];
      if (Array.isArray(prevAttr.value)) {
        prevAttr.value.push(value);
      } else {
        prevAttr.value = [prevAttr.value, value];
      }
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

function decodeValue(tag: number, raw: Uint8Array): IppAttributeValue {
  switch (tag) {
    case IppTag.Integer:
    case IppTag.Enum: {
      return viewOf(raw).getInt32(0, false);
    }
    case IppTag.Boolean: {
      return viewOf(raw).getUint8(0) !== 0;
    }
    case IppTag.RangeOfInteger: {
      // Return as Uint8Array for now, consumers can interpret
      return raw.slice();
    }
    case IppTag.Resolution: {
      // RFC 8011 §5.1.16: SIGNED-INTEGER xres, SIGNED-INTEGER yres, SIGNED-BYTE units
      const view = viewOf(raw);
      const resolution: IppResolution = {
        x: view.getInt32(0, false),
        y: view.getInt32(4, false),
        units: view.getInt8(8),
      };
      return resolution;
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
