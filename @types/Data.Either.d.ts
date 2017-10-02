declare namespace Data_Either {
  export interface Either<L, R> {}

  export function isRight<T, U>(either: Either<T, U>): boolean;
  export function isLeft<T, U>(either: Either<T, U>): boolean;
  export function fromRight<T, U>(partial: any): (either: Either<T, U>) => U;
}

export = Data_Either;
export as namespace Data_Either;
