"use strict";

import * as stream from "stream";

import { defined, hashCodeInit, addHashCode } from "./Support";
import { isDate, isTime, isDateTime } from "./DateTime";

const makeSource = require("stream-json/main");
const stringHash = require("string-hash");

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
    if (valueTag(v) !== tag) {
        throw "Trying to get index for value with invalid tag";
    }
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
        const jsonSource = makeSource();
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
        const promise = new Promise<Value>(resolve => {
            jsonSource.on("end", () => {
                resolve(this.finish());
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
        if (typeof value !== "number") {
            throw `Interned string value is not a number: ${value}`;
        }
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
        if (typeof value !== "number") {
            throw `CompressedJSON value is not a number: ${value}`;
        }
        if (this._ctx === undefined) {
            if (this._rootValue !== undefined) {
                throw "Committing value but nowhere to commit to - root value still there.";
            }
            this._rootValue = value;
        } else if (this._ctx.currentObject !== undefined) {
            if (this._ctx.currentKey === undefined || this._ctx.currentString !== undefined) {
                throw "Must have key and can't have string when committing";
            }
            this._ctx.currentObject.push(this.internString(this._ctx.currentKey), value);
            this._ctx.currentKey = undefined;
        } else if (this._ctx.currentArray !== undefined) {
            this._ctx.currentArray.push(value);
        } else {
            throw "Committing value but nowhere to commit to";
        }
    };

    private finish = (): Value => {
        const value = this._rootValue;
        if (value === undefined) {
            throw "Finished without root document";
        }
        if (this._ctx !== undefined || this._contextStack.length > 0) {
            throw "Finished with contexts present";
        }
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
        if (this._ctx === undefined) {
            throw "Popping context when there isn't one";
        }
        this._ctx = this._contextStack.pop();
    };

    private handleStartObject = (): void => {
        this.pushContext();
        defined(this._ctx).currentObject = [];
    };

    private handleEndObject = (): void => {
        if (defined(this._ctx).currentObject === undefined) {
            throw "Object ended but not started";
        }
        const obj = defined(defined(this._ctx).currentObject);
        this.popContext();
        this.commitValue(this.internObject(obj));
    };

    private handleStartArray = (): void => {
        this.pushContext();
        defined(this._ctx).currentArray = [];
    };

    private handleEndArray = (): void => {
        if (defined(this._ctx).currentArray === undefined) {
            throw "Array ended but not started";
        }
        const arr = defined(defined(this._ctx).currentArray);
        this.popContext();
        this.commitValue(this.internArray(arr));
    };

    private handleStartKey = (): void => {
        defined(this._ctx).currentString = "";
    };

    private handleEndKey = (): void => {
        if (defined(this._ctx).currentString === undefined) {
            throw "Key ended but no string";
        }
        defined(this._ctx).currentKey = defined(this._ctx).currentString;
        defined(this._ctx).currentString = undefined;
    };

    private handleStartString = (): void => {
        this.pushContext();
        defined(this._ctx).currentString = "";
    };

    private handleStringChunk = (s: string): void => {
        if (defined(this._ctx).currentString === undefined) {
            throw "String chunk but no string";
        }
        defined(this._ctx).currentString += s;
    };

    private handleEndString = (): void => {
        if (defined(this._ctx).currentString === undefined) {
            throw "String ended but not started";
        }
        const str = defined(defined(this._ctx).currentString);
        this.popContext();
        let value: Value | undefined = undefined;
        if (str.length <= 64) {
            if (str.length > 0 && "0123456789".indexOf(str[0]) >= 0) {
                if (this._makeDate && isDate(str)) {
                    value = makeValue(Tag.Date, 0);
                } else if (this._makeTime && isTime(str, false)) {
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
        if (defined(this._ctx).currentNumberIsDouble === undefined) {
            throw "Number ended but not started";
        }
        const numberTag = defined(this._ctx).currentNumberIsDouble ? Tag.Double : Tag.Integer;
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
        let hash = hashCodeInit;
        for (const s of this._strings) {
            hash = addHashCode(hash, stringHash(s));
        }

        for (const s of Object.getOwnPropertyNames(this._stringValues).sort()) {
            hash = addHashCode(hash, stringHash(s));
            hash = addHashCode(hash, this._stringValues[s]);
        }

        for (const o of this._objects) {
            for (const v of o) {
                hash = addHashCode(hash, v);
            }
        }
        for (const o of this._arrays) {
            for (const v of o) {
                hash = addHashCode(hash, v);
            }
        }

        return hash;
    };
}
