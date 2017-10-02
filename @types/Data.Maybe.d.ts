declare namespace Data_Maybe {
  export interface Maybe<T> {}

  export function isJust<T>(maybe: Maybe<T>): boolean;
  export function fromJust<T>(unused: any): (maybe: Maybe<T>) => T;
  export const fromMaybe: <T>(def: T) => (maybe: Maybe<T>) => T;
}
export = Data_Maybe;
export as namespace Data_Maybe;
