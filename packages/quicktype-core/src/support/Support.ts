import { Base64 } from "js-base64";
import * as pako from "pako";
import * as YAML from "yaml";

import { messageError } from "../Messages";

export interface StringMap {
    [name: string]: any;
}

export function isStringMap(x: any): x is StringMap;
export function isStringMap<T>(x: any, checkValue: (v: any) => v is T): x is { [name: string]: T };
export function isStringMap<T>(x: any, checkValue?: (v: any) => v is T): boolean {
    if (typeof x !== "object" || Array.isArray(x) || x === null) {
        return false;
    }

    if (checkValue !== undefined) {
        for (const k of Object.getOwnPropertyNames(x)) {
            const v = x[k];
            if (!checkValue(v)) {
                return false;
            }
        }
    }

    return true;
}

export function checkString(x: any): x is string {
    return typeof x === "string";
}

export function checkStringMap(x: any): StringMap;
export function checkStringMap<T>(x: any, checkValue: (v: any) => v is T): { [name: string]: T };
export function checkStringMap<T>(x: any, checkValue?: (v: any) => v is T): StringMap {
    if (isStringMap(x, checkValue as any)) return x;
    return panic(`Value must be an object, but is ${x}`);
}

export function checkArray(x: any): any[];
export function checkArray<T>(x: any, checkItem: (v: any) => v is T): T[];
export function checkArray<T>(x: any, checkItem?: (v: any) => v is T): T[] {
    if (!Array.isArray(x)) {
        return panic(`Value must be an array, but is ${x}`);
    }

    if (checkItem !== undefined) {
        for (const v of x) {
            if (!checkItem(v)) {
                return panic(`Array item does not satisfy constraint: ${v}`);
            }
        }
    }

    return x;
}

export function defined<T>(x: T | undefined): T {
    if (x !== undefined) return x;
    return panic("Defined value expected, but got undefined");
}

export function nonNull<T>(x: T | null): T {
    if (x !== null) return x;
    return panic("Non-null value expected, but got null");
}

export function assertNever(x: never): never {
    return messageError("InternalError", { message: `Unexpected object ${x as any}` });
}

export function assert(condition: boolean, message = "Assertion failed"): void {
    if (!condition) {
        return messageError("InternalError", { message });
    }
}

export function panic(message: string): never {
    return messageError("InternalError", { message });
}

export function mustNotHappen(): never {
    return panic("This must not happen");
}

export function repeated<T>(n: number, value: T): T[] {
    const arr: T[] = [];
    for (let i = 0; i < n; i++) {
        arr.push(value);
    }

    return arr;
}

export function repeatedCall<T>(n: number, producer: () => T): T[] {
    const arr: T[] = [];
    for (let i = 0; i < n; i++) {
        arr.push(producer());
    }

    return arr;
}

export function errorMessage(e: any): string {
    if (e instanceof Error) {
        return e.message;
    }

    return e.toString();
}

export function inflateBase64(encoded: string): string {
    const bytes = Base64.atob(encoded);
    return pako.inflate(bytes, { to: "string" });
}

export function parseJSON(text: string, description: string, address = "<unknown>"): any {
    try {
        // https://gist.github.com/pbakondy/f5045eff725193dad9c7
        if (text.charCodeAt(0) === 0xfeff) {
            text = text.slice(1);
        }

        return YAML.parse(text);
    } catch (e) {
        let message: string;

        if (e instanceof SyntaxError) {
            message = e.message;
        } else {
            message = `Unknown exception ${e}`;
        }

        return messageError("MiscJSONParseError", { description, address, message });
    }
}

export function indentationString(level: number): string {
    return "  ".repeat(level);
}

export function numberEnumValues(e: { [key: string]: any }): number[] {
    const result: number[] = [];
    for (const k of Object.keys(e)) {
        const v = e[k];
        if (typeof v === "number") {
            result.push(v);
        }
    }

    return result;
}
