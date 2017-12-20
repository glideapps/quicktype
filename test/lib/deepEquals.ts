import * as moment from "moment";
import { Moment } from "moment";

function pathToString(path: string[]): string {
  return "." + path.join(".");
}

declare namespace Math {
  // TypeScript cannot find this function
  function fround(n: number): number;
}

function tryParseMoment(s: string): [Moment | undefined, boolean] {
  let m = moment(s);
  if (m.isValid()) return [m, false];
  m = moment(s, "HH:mm:ss.SSZ");
  if (m.isValid()) return [m, true];
  return [undefined, false];
}

function momentsEqual(x: Moment, y: Moment, isTime: boolean): boolean {
  if (!isTime) {
    return x.isSame(y);
  }
  return (
    x.hour() === y.hour() &&
    x.minute() === y.minute() &&
    x.second() === y.second() &&
    x.millisecond() === y.millisecond()
  );
}

// https://stackoverflow.com/questions/1068834/object-comparison-in-javascript
export default function deepEquals(
  x: any,
  y: any,
  allowMissingNull: boolean,
  path: string[] = []
): boolean {
  // remember that NaN === NaN returns false
  // and isNaN(undefined) returns true
  if (typeof x === "number" && typeof y === "number") {
    if (isNaN(x) && isNaN(y)) {
      return true;
    }
    // because sometimes Newtonsoft.JSON is not exact
    if (Math.fround(x) === Math.fround(y)) {
      return true;
    }
    console.error(`Numbers are not equal at path ${pathToString(path)}.`);
    return false;
  }

  // Compare primitives and functions.
  // Check if both arguments link to the same object.
  // Especially useful on the step where we compare prototypes
  if (x === y) {
    return true;
  }

  if (typeof x === "string" && typeof y === "string") {
    if (x === y) return true;
    const [xMoment, isTime] = tryParseMoment(x);
    const [yMoment, _] = tryParseMoment(y);
    if (
      xMoment !== undefined &&
      yMoment !== undefined &&
      momentsEqual(xMoment, yMoment, isTime)
    ) {
      return true;
    }
    console.error(`Strings not equal at path ${pathToString(path)}.`);
  }

  if (x instanceof String && y instanceof String) {
    if (x.toString() === y.toString()) return true;
    console.error(`Number or string not equal at path ${pathToString(path)}.`);
    return false;
  }

  // At last checking prototypes as good as we can
  if (!(x instanceof Object && y instanceof Object)) {
    console.error(`One is not an object at path ${pathToString(path)}.`);
    return false;
  }

  // If the objects have an own property "constructor" then we need to
  // compare it regularly.
  if (x.constructor instanceof String && x.constructor !== y.constructor) {
    console.error(
      `Not the same constructor at path ${pathToString(path)}: should be ${
        x.constructor
      } but is ${y.constructor}.`
    );
    return false;
  }

  if (x.prototype !== y.prototype) {
    console.error(`Not the same prototype at path ${pathToString(path)}.`);
    return false;
  }

  if (Array.isArray(x)) {
    if (x.length !== y.length) {
      console.error(
        `Arrays don't have the same length at path ${pathToString(path)}.`
      );
      return false;
    }
    for (let i = 0; i < x.length; i++) {
      path.push(i.toString());
      if (!deepEquals(x[i], y[i], allowMissingNull, path)) {
        return false;
      }
      path.pop();
    }
    return true;
  }

  // FIXMEL The way we're looking up properties with `indexOf` makes this
  // quadratic.  So far no problem, so meh.
  const xKeys = Object.keys(x);
  const yKeys = Object.keys(y);

  for (const p of yKeys) {
    // We allow properties in y that aren't present in x
    // so long as they're null.
    if (xKeys.indexOf(p) < 0) {
      if (y[p] !== null) {
        console.error(
          `Non-null property ${p} is not expected at path ${pathToString(
            path
          )}.`
        );
        return false;
      }
      continue;
    }
    if (typeof y[p] !== typeof x[p]) {
      console.error(
        `Properties ${p} don't have the same types at path ${pathToString(
          path
        )}.`
      );
      return false;
    }
  }

  for (const p of xKeys) {
    if (yKeys.indexOf(p) < 0) {
      if (allowMissingNull && x[p] === null) {
        continue;
      }
      console.error(
        `Expected property ${p} not found at path ${pathToString(path)}.`
      );
      return false;
    }
    if (typeof x[p] !== typeof y[p]) {
      console.error(
        `Properties ${p} don't have the same types at path ${pathToString(
          path
        )}.`
      );
      return false;
    }

    path.push(p);
    if (!deepEquals(x[p], y[p], allowMissingNull, path)) {
      return false;
    }
    path.pop();
  }

  return true;
}
