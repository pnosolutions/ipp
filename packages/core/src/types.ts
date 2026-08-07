/// Inspired by: https://github.com/stacksjs/ts-printers/blob/45b7d4e6b4292a1a455178ec305610e9feae1573/src/types.ts

// IPP Protocol Types

export interface PrintConfig {
  defaultPrinter?: string;
  printers?: Record<string, PrinterEntry>;
  timeout?: number;
  verbose: boolean;
}

export interface PrinterEntry {
  uri: string;
  name?: string;
  model?: string;
}

// IPP Constants

export const IppVersion = {
  V1_1: [1, 1] as const,
  V2_0: [2, 0] as const,
};

export const IppOperation = {
  PrintJob: 0x0002,
  ValidateJob: 0x0004,
  CreateJob: 0x0005,
  SendDocument: 0x0006,
  CancelJob: 0x0008,
  GetJobAttributes: 0x0009,
  GetJobs: 0x000a,
  GetPrinterAttributes: 0x000b,
  PausePrinter: 0x0010,
  ResumePrinter: 0x0011,
  IdentifyPrinter: 0x003c,
} as const;

export type IppOperationId = (typeof IppOperation)[keyof typeof IppOperation];

export const IppStatusCode = {
  SuccessfulOk: 0x0000,
  SuccessfulOkIgnoredOrSubstituted: 0x0001,
  SuccessfulOkConflicting: 0x0002,
  ClientErrorBadRequest: 0x0400,
  ClientErrorForbidden: 0x0401,
  ClientErrorNotAuthenticated: 0x0402,
  ClientErrorNotAuthorized: 0x0403,
  ClientErrorNotPossible: 0x0404,
  ClientErrorTimeout: 0x0405,
  ClientErrorNotFound: 0x0406,
  ClientErrorGone: 0x0407,
  ClientErrorDocumentFormatNotSupported: 0x040a,
  ClientErrorAttributesOrValuesNotSupported: 0x040b,
  ServerErrorInternalError: 0x0500,
  ServerErrorOperationNotSupported: 0x0501,
  ServerErrorServiceUnavailable: 0x0502,
  ServerErrorVersionNotSupported: 0x0503,
  ServerErrorDeviceError: 0x0504,
  ServerErrorTemporaryError: 0x0505,
  ServerErrorBusy: 0x0507,
} as const;

export const IppTag = {
  // Delimiter tags
  OperationAttributes: 0x01,
  JobAttributes: 0x02,
  EndOfAttributes: 0x03,
  PrinterAttributes: 0x04,
  UnsupportedAttributes: 0x05,

  // Out-of-band value tags
  Unsupported: 0x10,
  Unknown: 0x12,
  NoValue: 0x13,

  // Integer value tags
  Integer: 0x21,
  Boolean: 0x22,
  Enum: 0x23,

  // Octet string value tags
  OctetString: 0x30,
  DateTime: 0x31,
  Resolution: 0x32,
  RangeOfInteger: 0x33,
  BegCollection: 0x34,
  TextWithLanguage: 0x35,
  NameWithLanguage: 0x36,
  EndCollection: 0x37,

  // Character string value tags
  TextWithoutLanguage: 0x41,
  NameWithoutLanguage: 0x42,
  Keyword: 0x44,
  Uri: 0x45,
  UriScheme: 0x46,
  Charset: 0x47,
  NaturalLanguage: 0x48,
  MimeMediaType: 0x49,
  MemberAttrName: 0x4a,
} as const;

export type IppTagValue = (typeof IppTag)[keyof typeof IppTag];

// IPP Request/Response types

export interface IppAttribute {
  tag: number;
  name: string;
  value: IppAttributeValue;
}

export type IppAttributeValue =
  | string
  | number
  | boolean
  | Uint8Array
  | IppResolution
  | IppTextWithLanguage
  | IppTypedValue
  | IppCollection
  | IppAttributeValue[];

export interface IppCollection {
  [memberName: string]: IppAttributeValue;
}

/**
 * A value carrying an explicit IPP value tag.
 *
 * Encoding a collection has to pick a value tag for each member, and the
 * plain JavaScript value alone is not always enough to do that - a string
 * could be a `keyword`, a `uri`, a `mimeMediaType` and so on. Wrap the member
 * to say which:
 *
 * ```ts
 * { 'media-size-name': { tag: IppTag.Keyword, value: 'na_index-4x6_4x6in' } }
 * ```
 *
 * Encode-only: decoding never produces this shape.
 */
export interface IppTypedValue {
  tag: number;
  value: IppAttributeValue;
}

/** RFC 8011 §5.1.16 'resolution' value. */
export interface IppResolution {
  /** Cross-feed direction resolution. */
  x: number;
  /** Feed direction resolution. */
  y: number;
  /** Units: 3 = dots per inch, 4 = dots per centimeter. */
  units: number;
}

export const IppResolutionUnit = {
  DotsPerInch: 3,
  DotsPerCentimeter: 4,
} as const;

/**
 * RFC 8011 §5.1.2.2 'textWithLanguage' / §5.1.3.2 'nameWithLanguage' value.
 *
 * On the wire these are a compound value - a natural-language tag followed by
 * the text - rather than a plain string.
 */
export interface IppTextWithLanguage {
  /** Natural language tag, e.g. 'en-us'. */
  language: string;
  /** The text or name itself. */
  value: string;
}

export interface IppAttributeGroup {
  tag: number;
  attributes: IppAttribute[];
}

export interface IppRequest {
  version?: readonly [number, number];
  operation: IppOperationId;
  requestId?: number;
  groups: IppAttributeGroup[];
  data?: Uint8Array;
}

export interface IppResponse {
  version: [number, number];
  statusCode: number;
  requestId: number;
  groups: IppAttributeGroup[];
  data?: Uint8Array;
}
