import * as stream from "stream";

import { hash } from "immutable";

import { defined, hashCodeInit, addHashCode, panic, assert } from "../support/Support";
import { isDate, isTime, isDateTime } from "../DateTime";

const Combo = require("stream-json/Combo");
const Source = require("stream-json/Source");

export enum Tag {
    Null,
    False,
    True,
    Integer,
    Double,
    InternedString,
    UninternedString,
    Object,
    Array,
    Date,
    Time,
    DateTime
}

export type Value = number;

const TAG_BITS = 4;
const TAG_MASK = (1 << TAG_BITS) - 1;

function makeValue(t: Tag, index: number): Value {
    return t | (index << TAG_BITS);
}

function getIndex(v: Value, tag: Tag): number {
    assert(valueTag(v) === tag, "Trying to get index for value with invalid tag");
    return v >> TAG_BITS;
}

export function valueTag(v: Value): Tag {
    return v & TAG_MASK;
}

type Context = {
    currentObject: Value[] | undefined;
    currentArray: Value[] | undefined;
    currentKey: string | undefined;
    currentString: string | undefined;
    currentNumberIsDouble: boolean | undefined;
};

export class CompressedJSON {
    private _rootValue: Value | undefined;

    private _ctx: Context | undefined;
    private _contextStack: Context[] = [];

    private _strings: string[] = [];
    private _stringValues: { [str: string]: Value } = {};
    private _objects: Value[][] = [];
    private _arrays: Value[][] = [];

    constructor(
        private readonly _makeDate: boolean,
        private readonly _makeTime: boolean,
        private readonly _makeDateTime: boolean
    ) {}

    async readFromStream(readStream: stream.Readable): Promise<Value> {
        const combo = new Combo();
        const jsonSource = new Source([combo]);
        jsonSource.on("startObject", this.handleStartObject);
        jsonSource.on("endObject", this.handleEndObject);
        jsonSource.on("startArray", this.handleStartArray);
        jsonSource.on("endArray", this.handleEndArray);
        jsonSource.on("startKey", this.handleStartKey);
        jsonSource.on("endKey", this.handleEndKey);
        jsonSource.on("startString", this.handleStartString);
        jsonSource.on("stringChunk", this.handleStringChunk);
        jsonSource.on("endString", this.handleEndString);
        jsonSource.on("startNumber", this.handleStartNumber);
        jsonSource.on("numberChunk", this.handleNumberChunk);
        jsonSource.on("endNumber", this.handleEndNumber);
        jsonSource.on("nullValue", this.handleNullValue);
        jsonSource.on("trueValue", this.handleTrueValue);
        jsonSource.on("falseValue", this.handleFalseValue);
        const promise = new Promise<Value>((resolve, reject) => {
            jsonSource.on("end", () => {
                resolve(this.finish());
            });
            combo.on("error", (err: any) => {
                reject(err);
            });
        });
        readStream.setEncoding("utf8");
        readStream.pipe(jsonSource.input);
        readStream.resume();
        return promise;
    }

    getStringForValue = (v: Value): string => {
        return this._strings[getIndex(v, Tag.InternedString)];
    };

    getObjectForValue = (v: Value): Value[] => {
        return this._objects[getIndex(v, Tag.Object)];
    };

    getArrayForValue = (v: Value): Value[] => {
        return this._arrays[getIndex(v, Tag.Array)];
    };

    private internString = (s: string): Value => {
        if (Object.prototype.hasOwnProperty.call(this._stringValues, s)) {
            return this._stringValues[s];
        }
        const value = makeValue(Tag.InternedString, this._strings.length);
        this._strings.push(s);
        this._stringValues[s] = value;
        assert(typeof value === "number", `Interned string value is not a number: ${value}`);
        return value;
    };

    private internObject = (obj: Value[]): Value => {
        const index = this._objects.length;
        this._objects.push(obj);
        return makeValue(Tag.Object, index);
    };

    private internArray = (arr: Value[]): Value => {
        const index = this._arrays.length;
        this._arrays.push(arr);
        return makeValue(Tag.Array, index);
    };

    private commitValue = (value: Value): void => {
        assert(typeof value === "number", `CompressedJSON value is not a number: ${value}`);
        if (this._ctx === undefined) {
            assert(
                this._rootValue === undefined,
                "Committing value but nowhere to commit to - root value still there."
            );
            this._rootValue = value;
        } else if (this._ctx.currentObject !== undefined) {
            if (this._ctx.currentKey === undefined || this._ctx.currentString !== undefined) {
                return panic("Must have key and can't have string when committing");
            }
            this._ctx.currentObject.push(this.internString(this._ctx.currentKey), value);
            this._ctx.currentKey = undefined;
        } else if (this._ctx.currentArray !== undefined) {
            this._ctx.currentArray.push(value);
        } else {
            return panic("Committing value but nowhere to commit to");
        }
    };

    private finish = (): Value => {
        const value = this._rootValue;
        if (value === undefined) {
            return panic("Finished without root document");
        }
        assert(this._ctx === undefined && this._contextStack.length === 0, "Finished with contexts present");
        this._rootValue = undefined;
        return value;
    };

    private pushContext = (): void => {
        if (this._ctx !== undefined) {
            this._contextStack.push(this._ctx);
        }
        this._ctx = {
            currentObject: undefined,
            currentArray: undefined,
            currentKey: undefined,
            currentString: undefined,
            currentNumberIsDouble: undefined
        };
    };

    private popContext = (): void => {
        assert(this._ctx !== undefined, "Popping context when there isn't one");
        this._ctx = this._contextStack.pop();
    };

    private handleStartObject = (): void => {
        this.pushContext();
        defined(this._ctx).currentObject = [];
    };

    private handleEndObject = (): void => {
        const obj = defined(this._ctx).currentObject;
        if (obj === undefined) {
            return panic("Object ended but not started");
        }
        this.popContext();
        this.commitValue(this.internObject(obj));
    };

    private handleStartArray = (): void => {
        this.pushContext();
        defined(this._ctx).currentArray = [];
    };

    private handleEndArray = (): void => {
        const arr = defined(this._ctx).currentArray;
        if (arr === undefined) {
            return panic("Array ended but not started");
        }
        this.popContext();
        this.commitValue(this.internArray(arr));
    };

    private handleStartKey = (): void => {
        defined(this._ctx).currentString = "";
    };

    private handleEndKey = (): void => {
        const ctx = defined(this._ctx);
        const str = ctx.currentString;
        if (str === undefined) {
            return panic("Key ended but no string");
        }
        ctx.currentKey = str;
        ctx.currentString = undefined;
    };

    private handleStartString = (): void => {
        this.pushContext();
        defined(this._ctx).currentString = "";
    };

    private handleStringChunk = (s: string): void => {
        const ctx = defined(this._ctx);
        if (ctx.currentString === undefined) {
            return panic("String chunk but no string");
        }
        ctx.currentString += s;
    };

    private handleEndString = (): void => {
        const str = defined(this._ctx).currentString;
        if (str === undefined) {
            return panic("String ended but not started");
        }
        this.popContext();
        let value: Value | undefined = undefined;
        if (str.length <= 64) {
            if (str.length > 0 && "0123456789".indexOf(str[0]) >= 0) {
                if (this._makeDate && isDate(str)) {
                    value = makeValue(Tag.Date, 0);
                } else if (this._makeTime && isTime(str)) {
                    value = makeValue(Tag.Time, 0);
                } else if (this._makeDateTime && isDateTime(str)) {
                    value = makeValue(Tag.DateTime, 0);
                }
            }
            if (value === undefined) {
                value = this.internString(str);
            }
        } else {
            value = makeValue(Tag.UninternedString, 0);
        }
        this.commitValue(value);
    };

    private handleStartNumber = (): void => {
        this.pushContext();
        defined(this._ctx).currentNumberIsDouble = false;
    };

    private handleNumberChunk = (s: string): void => {
        if (s.includes(".") || s.includes("e") || s.includes("E")) {
            defined(this._ctx).currentNumberIsDouble = true;
        }
    };

    private handleEndNumber = (): void => {
        const isDouble = defined(this._ctx).currentNumberIsDouble;
        if (isDouble === undefined) {
            return panic("Number ended but not started");
        }
        const numberTag = isDouble ? Tag.Double : Tag.Integer;
        this.popContext();
        this.commitValue(makeValue(numberTag, 0));
    };

    private handleNullValue = (): void => {
        this.commitValue(makeValue(Tag.Null, 0));
    };

    private handleTrueValue = (): void => {
        this.commitValue(makeValue(Tag.True, 0));
    };

    private handleFalseValue = (): void => {
        this.commitValue(makeValue(Tag.False, 0));
    };

    equals = (other: any): boolean => {
        return this === other;
    };

    hashCode = (): number => {
        let hashAccumulator = hashCodeInit;
        for (const s of this._strings) {
            hashAccumulator = addHashCode(hashAccumulator, hash(s));
        }

        for (const s of Object.getOwnPropertyNames(this._stringValues).sort()) {
            hashAccumulator = addHashCode(hashAccumulator, hash(s));
            hashAccumulator = addHashCode(hashAccumulator, this._stringValues[s]);
        }

        for (const o of this._objects) {
            for (const v of o) {
                hashAccumulator = addHashCode(hashAccumulator, v);
            }
        }
        for (const o of this._arrays) {
            for (const v of o) {
                hashAccumulator = addHashCode(hashAccumulator, v);
            }
        }

        return hashAccumulator;
    };
}
