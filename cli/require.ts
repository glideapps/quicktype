export function tryRequire(...paths: string[]): any {
  for (let path of paths) {
    try {
      return require(path);
    } catch (e) {
      continue;
    }
  }
  throw "No path could be required";
}

export function psRequire<T>(path: string): T {
  return tryRequire(`../output/${path}`, path);
}
