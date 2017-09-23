export function isJust<T>(maybe: Maybe<T>): boolean {
  return maybe.constructor.name === "Just";
}

export function fromJust<T>(maybe: Maybe<T>): T {
  if (!maybe.value0) throw "fromJust invoked on Nothing";
  return maybe.value0;
}
