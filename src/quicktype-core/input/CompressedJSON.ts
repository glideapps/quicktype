import * as stream from "stream";

import stringHash = require("string-hash");
import { addHashCode, hashCodeInit } from "collection-utils";

import { defined, panic, assert } from "../support/Support";
import { isDate, isTime, isDateTime } from "../DateTime";

const Combo = require("stream-json/Combo");

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
    currentNumberIsDouble: boolean | undefined;
};

const methodMap: any = {
    startObject: "handleStartObject",
    endObject: "handleEndObject",
    startArray: "handleStartArray",
    endArray: "handleEndArray",
    startNumber: "handleStartNumber",
    numberChunk: "handleNumberChunk",
    endNumber: "handleEndNumber",
    keyValue: "handleKeyValue",
    stringValue: "handleStringValue",
    nullValue: "handleNullValue",
    trueValue: "handleTrueValue",
    falseValue: "handleFalseValue"
};

export class CompressedJSON {
    private _rootValue: Value | undefined;

    private _ctx: Context | undefined;
    private _contextStack: Context[] = [];

    private _strings: string[] = [];
    private _stringValues: { [str: string]: Value } = {};
    private _objects: Value[][] = [];
    private _arrays: Value[][] = [];

    [key: string]: any;

    constructor(
        private readonly _makeDate: boolean,
        private readonly _makeTime: boolean,
        private readonly _makeDateTime: boolean
    ) {}

    async readFromStream(readStream: stream.Readable): Promise<Value> {
        const combo = new Combo({ packKeys: true, packStrings: true });
        combo.on("data", (item: any) => {
            if (typeof methodMap[item.name] === "string") {
                this[methodMap[item.name]](item.value);
            }
        });
        const promise = new Promise<Value>((resolve, reject) => {
            combo.on("end", () => {
                resolve(this.finish());
            });
            combo.on("error", (err: any) => {
                reject(err);
            });
        });
        readStream.setEncoding("utf8");
        readStream.pipe(combo);
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
            if (this._ctx.currentKey === undefined) {
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
            currentNumberIsDouble: undefined
        };
    };

    private popContext = (): void => {
        assert(this._ctx !== undefined, "Popping context when there isn't one");
        this._ctx = this._contextStack.pop();
    };

    protected handleStartObject = (): void => {
        this.pushContext();
        defined(this._ctx).currentObject = [];
    };

    protected handleEndObject = (): void => {
        const obj = defined(this._ctx).currentObject;
        if (obj === undefined) {
            return panic("Object ended but not started");
        }
        this.popContext();
        this.commitValue(this.internObject(obj));
    };

    protected handleStartArray = (): void => {
        this.pushContext();
        defined(this._ctx).currentArray = [];
    };

    protected handleEndArray = (): void => {
        const arr = defined(this._ctx).currentArray;
        if (arr === undefined) {
            return panic("Array ended but not started");
        }
        this.popContext();
        this.commitValue(this.internArray(arr));
    };

    protected handleKeyValue = (s: string): void => {
        defined(this._ctx).currentKey = s;
    };

    protected handleStringValue = (s: string): void => {
        let value: Value | undefined = undefined;
        if (s.length <= 64) {
            if (s.length > 0 && "0123456789".indexOf(s[0]) >= 0) {
                if (this._makeDate && isDate(s)) {
                    value = makeValue(Tag.Date, 0);
                } else if (this._makeTime && isTime(s)) {
                    value = makeValue(Tag.Time, 0);
                } else if (this._makeDateTime && isDateTime(s)) {
                    value = makeValue(Tag.DateTime, 0);
                }
            }
            if (value === undefined) {
                value = this.internString(s);
            }
        } else {
            value = makeValue(Tag.UninternedString, 0);
        }
        this.commitValue(value);
    };

    protected handleStartNumber = (): void => {
        this.pushContext();
        defined(this._ctx).currentNumberIsDouble = false;
    };

    protected handleNumberChunk = (s: string): void => {
        if (s.includes(".") || s.includes("e") || s.includes("E")) {
            defined(this._ctx).currentNumberIsDouble = true;
        }
    };

    protected handleEndNumber = (): void => {
        const isDouble = defined(this._ctx).currentNumberIsDouble;
        const numberTag = isDouble ? Tag.Double : Tag.Integer;
        this.popContext();
        this.commitValue(makeValue(numberTag, 0));
    };

    protected handleNullValue = (): void => {
        this.commitValue(makeValue(Tag.Null, 0));
    };

    protected handleTrueValue = (): void => {
        this.commitValue(makeValue(Tag.True, 0));
    };

    protected handleFalseValue = (): void => {
        this.commitValue(makeValue(Tag.False, 0));
    };

    equals = (other: any): boolean => {
        return this === other;
    };

    hashCode = (): number => {
        let hashAccumulator = hashCodeInit;
        for (const s of this._strings) {
            hashAccumulator = addHashCode(hashAccumulator, stringHash(s));
        }

        for (const s of Object.getOwnPropertyNames(this._stringValues).sort()) {
            hashAccumulator = addHashCode(hashAccumulator, stringHash(s));
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
