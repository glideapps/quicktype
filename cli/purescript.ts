import * as Either from "Data.Either";
import * as Maybe from "Data.Maybe";

export function fromJust<T>(maybe: Maybe.Maybe<T>): T {
  return Maybe.fromJust<T>(null)(maybe);
}

export function fromRight<L, R>(either: Either.Either<L, R>): R {
  return Either.fromRight<L, R>(null)(either);
}
