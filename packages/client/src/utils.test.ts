import { IppResolutionUnit, IppTag } from '@pnosolutions/ipp-core';
import { describe, expect, it } from 'vitest';

import {
  buildJobAttributes,
  buildMediaCol,
  num,
  numOrNull,
  resolution,
  resolutionArray,
  str,
  strOrNull,
} from './utils';

describe('strOrNull / numOrNull', () => {
  it('distinguishes a missing attribute from an empty or zero value', () => {
    expect(strOrNull(undefined)).toBeNull();
    expect(strOrNull('')).toBe('');
    expect(str(undefined)).toBe('');

    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull(0)).toBe(0);
    expect(num(undefined)).toBe(0);
  });

  it('treats an empty multi-value as missing', () => {
    expect(strOrNull([])).toBeNull();
    expect(numOrNull([])).toBeNull();
  });

  it('unwraps the first value of a multi-value', () => {
    expect(strOrNull(['a', 'b'])).toBe('a');
    expect(numOrNull([7, 8])).toBe(7);
  });

  it('returns null rather than 0 for values that are not numbers', () => {
    expect(numOrNull('not-a-number')).toBeNull();
    expect(numOrNull(true)).toBeNull();
    expect(numOrNull(new Uint8Array([1]))).toBeNull();
    expect(numOrNull({ 'media-type': 'labels' })).toBeNull();
  });

  it('parses numeric strings', () => {
    expect(numOrNull('42')).toBe(42);
  });
});

describe('resolution helpers', () => {
  const dpi600 = { x: 600, y: 600, units: IppResolutionUnit.DotsPerInch };
  const dpi300 = { x: 300, y: 300, units: IppResolutionUnit.DotsPerInch };

  it('reads a single resolution', () => {
    expect(resolution(dpi600)).toEqual(dpi600);
  });

  it('returns null when absent or malformed', () => {
    expect(resolution(undefined)).toBeNull();
    expect(resolution([])).toBeNull();
    // Short records decode to raw bytes rather than a resolution.
    expect(resolution(new Uint8Array([0, 0, 1]))).toBeNull();
    expect(resolution('600dpi')).toBeNull();
  });

  it('reads a multi-valued resolution list', () => {
    expect(resolutionArray([dpi300, dpi600])).toEqual([dpi300, dpi600]);
  });

  it('wraps a single value into a list and drops malformed entries', () => {
    expect(resolutionArray(dpi600)).toEqual([dpi600]);
    expect(resolutionArray([dpi600, 'junk'])).toEqual([dpi600]);
    expect(resolutionArray(undefined)).toEqual([]);
  });
});

describe('buildMediaCol', () => {
  it('maps every field onto its IPP member name', () => {
    expect(
      buildMediaCol({
        size: { name: 'na_index-4x6_4x6in', dimensions: [10160, 15240] },
        margin: { top: 0, right: 100, bottom: 0, left: 100 },
        source: 'main-roll',
        type: 'labels',
      }),
    ).toEqual({
      'media-size': { 'x-dimension': 10160, 'y-dimension': 15240 },
      'media-size-name': 'na_index-4x6_4x6in',
      'media-top-margin': 0,
      'media-right-margin': 100,
      'media-bottom-margin': 0,
      'media-left-margin': 100,
      'media-source': 'main-roll',
      'media-type': 'labels',
    });
  });

  it('omits members the caller did not set', () => {
    expect(buildMediaCol({ type: 'labels' })).toEqual({
      'media-type': 'labels',
    });
    expect(buildMediaCol({})).toEqual({});
  });

  it('keeps a zero margin, which is meaningful', () => {
    expect(buildMediaCol({ margin: { top: 0 } })).toEqual({
      'media-top-margin': 0,
    });
  });
});

describe('buildJobAttributes', () => {
  it('emits media-col as a begCollection attribute', () => {
    const attrs = buildJobAttributes({
      mediaCol: { size: { dimensions: [5715, 3175] }, type: 'labels' },
    });

    expect(attrs).toEqual([
      {
        tag: IppTag.BegCollection,
        name: 'media-col',
        value: {
          'media-size': { 'x-dimension': 5715, 'y-dimension': 3175 },
          'media-type': 'labels',
        },
      },
    ]);
  });

  it('omits media-col when it would be empty', () => {
    expect(buildJobAttributes({ mediaCol: {} })).toEqual([]);
  });

  it('still emits the scalar options alongside media-col', () => {
    const names = buildJobAttributes({
      copies: 2,
      media: 'iso_a4_210x297mm',
      mediaCol: { type: 'labels' },
      sides: 'one-sided',
    }).map((a) => a.name);

    expect(names).toEqual(['copies', 'media', 'media-col', 'sides']);
  });
});
