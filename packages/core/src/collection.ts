import { IppAttributeValue, IppCollection } from './types';

export class CollectionParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parseObject(): IppCollection {
    const obj: IppCollection = {};
    this.skipWs();
    if (this.src[this.pos] !== '{') return obj;
    this.pos++;
    this.skipWs();

    while (this.pos < this.src.length && this.src[this.pos] !== '}') {
      const key = this.readToken();
      if (!key) break;
      this.skipWs();
      if (this.src[this.pos] === '=') this.pos++;
      this.skipWs();
      obj[key] = this.parseValue();
      this.skipWs();
    }

    if (this.src[this.pos] === '}') this.pos++;
    return obj;
  }

  private parseValue(): IppAttributeValue {
    if (this.src[this.pos] === '{') return this.parseObject();
    return coerce(this.readToken());
  }

  private readToken(): string {
    const start = this.pos;
    while (this.pos < this.src.length) {
      const char = this.src[this.pos];
      if (char === undefined || /[\s={}]/.test(char)) break;
      this.pos++;
    }
    return this.src.slice(start, this.pos);
  }

  private skipWs(): void {
    while (this.pos < this.src.length) {
      const char = this.src[this.pos];
      if (char === undefined || !/\s/.test(char)) break;
      this.pos++;
    }
  }
}

function coerce(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  return raw;
}
