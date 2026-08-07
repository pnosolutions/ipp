import {
  CollectionParser,
  IppAttribute,
  IppAttributeValue,
  IppCollection,
  IppTag,
  IppTextWithLanguage,
} from '@pnosolutions/ipp-core';

import { PrintJobOptions, PrintMediaCol } from './types';

import type { IppResolution } from '@pnosolutions/ipp-core';

// Quality mapping
export const QualityMap = {
  draft: 3,
  normal: 4,
  high: 5,
} as const;

// Orientation mapping
export const OrientationMap = {
  portrait: 3,
  landscape: 4,
} as const;

export function str(val: IppAttributeValue | undefined): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return str(val[0]);
  // textWithLanguage / nameWithLanguage decode to { language, value }; callers
  // asking for a string want the text, not the language tag.
  if (isTextWithLanguage(val)) return val.value;
  return String(val);
}

function isTextWithLanguage(
  val: IppAttributeValue,
): val is IppTextWithLanguage {
  return (
    typeof val === 'object' &&
    val !== null &&
    !(val instanceof Uint8Array) &&
    !Array.isArray(val) &&
    typeof (val as IppTextWithLanguage).language === 'string' &&
    typeof (val as IppTextWithLanguage).value === 'string'
  );
}

/**
 * Like {@link str}, but distinguishes "the printer did not report this" from
 * "the printer reported an empty string".
 */
export function strOrNull(val: IppAttributeValue | undefined): string | null {
  if (val === undefined || val === null) return null;
  if (Array.isArray(val)) return val.length === 0 ? null : strOrNull(val[0]);
  return str(val);
}

export function num(val: IppAttributeValue | undefined): number {
  return numOrNull(val) ?? 0;
}

/**
 * Like {@link num}, but distinguishes "the printer did not report this" from
 * a reported value of `0`.
 */
export function numOrNull(val: IppAttributeValue | undefined): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return val;
  if (Array.isArray(val)) return val.length === 0 ? null : numOrNull(val[0]);
  if (typeof val === 'boolean' || val instanceof Uint8Array) return null;
  if (typeof val === 'object') return null;

  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolution(
  val: IppAttributeValue | undefined,
): IppResolution | null {
  if (val === undefined || val === null) return null;
  if (Array.isArray(val)) return val.length === 0 ? null : resolution(val[0]);
  return isResolution(val) ? val : null;
}

export function resolutionArray(
  val: IppAttributeValue | undefined,
): IppResolution[] {
  if (val === undefined || val === null) return [];
  const values = Array.isArray(val) ? val : [val];
  return values.map((v) => resolution(v)).filter((v) => v !== null);
}

function isResolution(val: IppAttributeValue): val is IppResolution {
  return (
    typeof val === 'object' &&
    val !== null &&
    !(val instanceof Uint8Array) &&
    !Array.isArray(val) &&
    typeof (val as IppResolution).x === 'number' &&
    typeof (val as IppResolution).y === 'number' &&
    typeof (val as IppResolution).units === 'number'
  );
}

export function bool(val: IppAttributeValue | undefined): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === 'boolean') return val;
  if (Array.isArray(val)) return bool(val[0]);
  return !!val;
}

export function strArray(val: IppAttributeValue | undefined): string[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val.map((v) => str(v));
  if (typeof val === 'string') return [val];
  return [str(val)];
}

export function numArray(val: IppAttributeValue | undefined): number[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val.map((v) => num(v));
  if (typeof val === 'number') return [val];
  return [];
}

export function collection(val: IppAttributeValue | undefined): IppCollection {
  if (val === undefined || val === null) return {};
  if (Array.isArray(val)) return collection(val[0]);
  // Some printers report media-col-ready as a CUPS-style textual collection
  // rather than a begCollection record.
  if (typeof val === 'string') return new CollectionParser(val).parseObject();
  if (typeof val !== 'object' || val instanceof Uint8Array) return {};
  return val as IppCollection;
}

export function buildJobAttributes(options?: PrintJobOptions): IppAttribute[] {
  if (!options) return [];
  const attrs: IppAttribute[] = [];

  if (options.copies && options.copies > 1) {
    attrs.push({ tag: IppTag.Integer, name: 'copies', value: options.copies });
  }

  if (options.media) {
    attrs.push({ tag: IppTag.Keyword, name: 'media', value: options.media });
  }

  if (options.mediaCol) {
    const value = buildMediaCol(options.mediaCol);
    if (Object.keys(value).length > 0) {
      attrs.push({ tag: IppTag.BegCollection, name: 'media-col', value });
    }
  }

  if (options.orientation) {
    attrs.push({
      tag: IppTag.Enum,
      name: 'orientation-requested',
      value: OrientationMap[options.orientation],
    });
  }

  if (options.quality) {
    attrs.push({
      tag: IppTag.Enum,
      name: 'print-quality',
      value: QualityMap[options.quality],
    });
  }

  if (options.sides) {
    attrs.push({ tag: IppTag.Keyword, name: 'sides', value: options.sides });
  }

  if (options.colorMode) {
    attrs.push({
      tag: IppTag.Keyword,
      name: 'print-color-mode',
      value: options.colorMode,
    });
  }

  if (options.fitToPage) {
    attrs.push({ tag: IppTag.Keyword, name: 'print-scaling', value: 'fit' });
  }

  return attrs;
}

/**
 * Map a {@link PrintMediaCol} onto the IPP `media-col` member names. Members
 * the caller left out are omitted so the printer keeps its own defaults.
 */
export function buildMediaCol(media: PrintMediaCol): IppCollection {
  const value: IppCollection = {};

  const size: IppCollection = {};
  if (media.size?.dimensions) {
    const [x, y] = media.size.dimensions;
    size['x-dimension'] = x;
    size['y-dimension'] = y;
  }
  if (Object.keys(size).length > 0) value['media-size'] = size;

  if (media.size?.name !== undefined) {
    value['media-size-name'] = media.size.name;
  }

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const margin = media.margin?.[side];
    if (margin !== undefined) value[`media-${side}-margin`] = margin;
  }

  if (media.source !== undefined) value['media-source'] = media.source;
  if (media.type !== undefined) value['media-type'] = media.type;

  return value;
}

// TODO: replace with `magic-bytes.js` and sync with https://github.com/OpenPrinting/cups/blob/13ad3c7eb76a7e0198d15d29d7345dd57ca85810/conf/mime.types
export function detectMimeType(data: Uint8Array): string {
  if (
    data.length >= 5 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46 &&
    data[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  if (
    data.length >= 4 &&
    data[0] === 0x25 &&
    data[1] === 0x21 &&
    data[2] === 0x50 &&
    data[3] === 0x53
  ) {
    return 'application/postscript';
  }

  if (
    data.length >= 4 &&
    data[0] === 0x52 &&
    data[1] === 0x61 &&
    data[2] === 0x53 &&
    data[3] === 0x32
  ) {
    return 'image/pwg-raster';
  }

  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return 'image/gif';
  }

  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    data.length >= 4 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }

  return 'application/octet-stream';
}
