import {
  CollectionParser,
  IppAttribute,
  IppAttributeValue,
  IppCollection,
  IppTag,
} from '@pnosolutions/ipp-core';

import { PrintJobOptions } from './types';

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
  return String(val);
}

export function num(val: IppAttributeValue | undefined): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  if (Array.isArray(val)) return num(val[0]);
  return Number(val) || 0;
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
  return [String(val)];
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
  if (typeof val === 'string') return new CollectionParser(val).parseObject();
  if (val instanceof Uint8Array) return {};
  if (typeof val === 'object') return val;
  return {};
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
