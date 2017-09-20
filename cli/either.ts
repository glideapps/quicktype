export function isRight<T, U>(either: Either<T, U>): boolean {
  return either.constructor.name == "Right";
}

export function isLeft<T, U>(either: Either<T, U>): boolean {
  return either.constructor.name == "Left";
}

export function get<T, U>(either: Either<T, U>): T | U {
  return either.value0;
}

export function fromRight<T>(either: Either<string, T>): T {
  let result = get(either);
  if (isLeft(either)) {
    console.error(result);
    process.exit(1);
  } else {
    return <T>result;
  }
}
