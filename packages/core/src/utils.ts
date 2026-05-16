export function viewOf(arr: Uint8Array): DataView {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}

export function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const c of chunks) total += c.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
