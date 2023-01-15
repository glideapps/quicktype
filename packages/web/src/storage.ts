const version = 4;

function mkey(key: string) {
  return `v${version}.${key}`;
}

export function save<T>(key: string, val: T): boolean {
  try {
    localStorage[mkey(key)] = JSON.stringify(val);
  } catch (e) {
    return false;
  }
  return true;
}

export function load<T>(key: string, def?: T, onError?: T): T | undefined {
  try {
    const saved = localStorage[mkey(key)];
    if (!saved) {
      return def;
    }
    return JSON.parse(localStorage[mkey(key)]) as T;
  } catch (e) {
    return onError || def;
  }
}
