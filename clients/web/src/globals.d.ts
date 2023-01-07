declare var ace: any;
declare var embedded: boolean;

declare module "query-string" {
  function parse<T>(query: string): T;
  function stringify(params: {}): string;
}

declare module "hashcode" {
  interface Hasher {
    value(val: any): number;
  }

  export function hashCode(): Hasher;
}
