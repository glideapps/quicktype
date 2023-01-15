export function defined<T>(x: T | undefined): T {
  if (x === undefined) {
    throw new Error(`Expected defined value: ${x}`);
  }
  return x;
}

export function withoutExtension(filename: string) {
  const splitAt = filename.lastIndexOf(".");
  return splitAt === -1 ? filename : filename.substr(0, splitAt);
}
