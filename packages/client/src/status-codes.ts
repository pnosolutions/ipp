export type StatusCodeClass =
  | 'successful'
  | 'informational'
  | 'redirection'
  | 'client-error'
  | 'server-error';

export interface StatusCodeInfo {
  type: StatusCodeClass;
  name: string;
}

/**
 * @see https://datatracker.ietf.org/doc/html/rfc2911#section-13.1
 */
export const StatusCodes: Record<number, StatusCodeInfo> = {
  0x0000: { type: 'informational', name: 'ok' },
  0x0001: {
    type: 'informational',
    name: 'ok-ignored-or-substituted-attributes',
  },
  0x0002: { type: 'informational', name: 'ok-conflicting-attributes' },

  0x0400: { type: 'client-error', name: 'bad-request' },
  0x0401: { type: 'client-error', name: 'forbidden' },
  0x0402: { type: 'client-error', name: 'not-authenticated' },
  0x0403: { type: 'client-error', name: 'not-authorized' },
  0x0404: { type: 'client-error', name: 'not-possible' },
  0x0405: { type: 'client-error', name: 'timeout' },
  0x0406: { type: 'client-error', name: 'not-found' },
  0x0407: { type: 'client-error', name: 'gone' },
  0x0408: { type: 'client-error', name: 'request-entity-too-large' },
  0x0409: { type: 'client-error', name: 'request-value-too-long' },
  0x040a: { type: 'client-error', name: 'document-format-not-supported' },
  0x040b: { type: 'client-error', name: 'attributes-not-supported' },
  0x040c: { type: 'client-error', name: 'uri-scheme-not-supported' },
  0x040d: { type: 'client-error', name: 'charset-not-supported' },
  0x040e: { type: 'client-error', name: 'conflicting-attributes' },
  0x040f: { type: 'client-error', name: 'compression-not-supported' },
  0x0410: { type: 'client-error', name: 'compression-error' },
  0x0411: { type: 'client-error', name: 'document-format-error' },
  0x0412: { type: 'client-error', name: 'document-access-error' },

  0x0500: { type: 'server-error', name: 'internal-error' },
  0x0501: { type: 'server-error', name: 'operation-not-supported' },
  0x0502: { type: 'server-error', name: 'service-unavailable' },
  0x0503: { type: 'server-error', name: 'version-not-supported' },
  0x0504: { type: 'server-error', name: 'device-error' },
  0x0505: { type: 'server-error', name: 'temporary-error' },
  0x0506: { type: 'server-error', name: 'not-accepting-jobs' },
  0x0507: { type: 'server-error', name: 'busy' },
  0x0508: { type: 'server-error', name: 'job-canceled' },
  0x0509: {
    type: 'server-error',
    name: 'multiple-document-jobs-not-supported',
  },
};
