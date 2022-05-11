"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const js_base64_1 = require("js-base64");
const pako = require("pako");
const Messages_1 = require("../Messages");
const YAML = require("yaml");
function isStringMap(x, checkValue) {
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
exports.isStringMap = isStringMap;
function checkString(x) {
    return typeof x === "string";
}
exports.checkString = checkString;
function checkStringMap(x, checkValue) {
    if (isStringMap(x, checkValue))
        return x;
    return panic(`Value must be an object, but is ${x}`);
}
exports.checkStringMap = checkStringMap;
function checkArray(x, checkItem) {
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
exports.checkArray = checkArray;
function defined(x) {
    if (x !== undefined)
        return x;
    return panic("Defined value expected, but got undefined");
}
exports.defined = defined;
function nonNull(x) {
    if (x !== null)
        return x;
    return panic("Non-null value expected, but got null");
}
exports.nonNull = nonNull;
function assertNever(x) {
    return Messages_1.messageError("InternalError", { message: `Unexpected object ${x}` });
}
exports.assertNever = assertNever;
function assert(condition, message = "Assertion failed") {
    if (!condition) {
        return Messages_1.messageError("InternalError", { message });
    }
}
exports.assert = assert;
function panic(message) {
    return Messages_1.messageError("InternalError", { message });
}
exports.panic = panic;
function mustNotHappen() {
    return panic("This must not happen");
}
exports.mustNotHappen = mustNotHappen;
function repeated(n, value) {
    const arr = [];
    for (let i = 0; i < n; i++) {
        arr.push(value);
    }
    return arr;
}
exports.repeated = repeated;
function repeatedCall(n, producer) {
    const arr = [];
    for (let i = 0; i < n; i++) {
        arr.push(producer());
    }
    return arr;
}
exports.repeatedCall = repeatedCall;
function errorMessage(e) {
    if (e instanceof Error) {
        return e.message;
    }
    return e.toString();
}
exports.errorMessage = errorMessage;
function inflateBase64(encoded) {
    const bytes = js_base64_1.Base64.atob(encoded);
    return pako.inflate(bytes, { to: "string" });
}
exports.inflateBase64 = inflateBase64;
function parseJSON(text, description, address = "<unknown>") {
    try {
        // https://gist.github.com/pbakondy/f5045eff725193dad9c7
        if (text.charCodeAt(0) === 0xfeff) {
            text = text.slice(1);
        }
        return YAML.parse(text);
    }
    catch (e) {
        let message;
        if (e instanceof SyntaxError) {
            message = e.message;
        }
        else {
            message = `Unknown exception ${e}`;
        }
        return Messages_1.messageError("MiscJSONParseError", { description, address, message });
    }
}
exports.parseJSON = parseJSON;
function indentationString(level) {
    return "  ".repeat(level);
}
exports.indentationString = indentationString;
function numberEnumValues(e) {
    const result = [];
    for (const k of Object.keys(e)) {
        const v = e[k];
        if (typeof v === "number") {
            result.push(v);
        }
    }
    return result;
}
exports.numberEnumValues = numberEnumValues;
