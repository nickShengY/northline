export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function fitsJsonByteLimit(maxBytes: number) {
  return (value: unknown) => jsonByteLength(value) <= maxBytes;
}
