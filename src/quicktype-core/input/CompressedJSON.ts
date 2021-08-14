import { addHashCode, hashCodeInit, hashString } from "collection-utils";
import { parse as JSON5parse } from "json5";

import { defined, panic, assert } from "../support/Support";
import { TransformedStringTypeKind, isPrimitiveStringTypeKind, transformedStringTypeTargetTypeKindsMap } from "../Type";
import { DateTimeRecognizer } from "../DateTime";
import { inferTransformedStringTypeKindForString } from "../attributes/StringTypes";

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
    StringFormat,
    TransformedString
}

export type Value = number;

const TAG_BITS = 4;
const TAG_MASK = (1 << TAG_BITS) - 1;

export function makeValue(t: Tag, index: number): Value {
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
    currentNumberIsDouble: boolean;
};

export abstract class CompressedJSON<T> {
    private _rootValue: Value | undefined;

    private _ctx: Context | undefined;
    private _contextStack: Context[] = [];

    private _strings: string[] = [];
    private _stringIndexes: { [str: string]: number } = {};
    private _objects: Value[][] = [];
    private _arrays: Value[][] = [];

    constructor(readonly dateTimeRecognizer: DateTimeRecognizer, readonly handleRefs: boolean) {}

    abstract parse(input: T): Promise<Value>;

    parseSync(_input: T): Value {
        return panic("parseSync not implemented in CompressedJSON");
    }

    getStringForValue(v: Value): string {
        const tag = valueTag(v);
        assert(tag === Tag.InternedString || tag === Tag.TransformedString);
        return this._strings[getIndex(v, tag)];
    }

    getObjectForValue = (v: Value): Value[] => {
        return this._objects[getIndex(v, Tag.Object)];
    };

    getArrayForValue = (v: Value): Value[] => {
        return this._arrays[getIndex(v, Tag.Array)];
    };

    getStringFormatTypeKind(v: Value): TransformedStringTypeKind {
        const kind = this._strings[getIndex(v, Tag.StringFormat)];
        if (!isPrimitiveStringTypeKind(kind) || kind === "string") {
            return panic("Not a transformed string type kind");
        }
        return kind;
    }

    protected get context(): Context {
        return defined(this._ctx);
    }

    protected internString(s: string): number {
        if (Object.prototype.hasOwnProperty.call(this._stringIndexes, s)) {
            return this._stringIndexes[s];
        }
        const index = this._strings.length;
        this._strings.push(s);
        this._stringIndexes[s] = index;
        return index;
    }

    protected makeString(s: string): Value {
        const value = makeValue(Tag.InternedString, this.internString(s));
        assert(typeof value === "number", `Interned string value is not a number: ${value}`);
        return value;
    }

    protected internObject(obj: Value[]): Value {
        const index = this._objects.length;
        this._objects.push(obj);
        return makeValue(Tag.Object, index);
    }

    protected internArray = (arr: Value[]): Value => {
        const index = this._arrays.length;
        this._arrays.push(arr);
        return makeValue(Tag.Array, index);
    };

    protected get isExpectingRef(): boolean {
        return this._ctx !== undefined && this._ctx.currentKey === "$ref";
    }

    protected commitValue(value: Value): void {
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
            this._ctx.currentObject.push(this.makeString(this._ctx.currentKey), value);
            this._ctx.currentKey = undefined;
        } else if (this._ctx.currentArray !== undefined) {
            this._ctx.currentArray.push(value);
        } else {
            return panic("Committing value but nowhere to commit to");
        }
    }

    protected commitNull(): void {
        this.commitValue(makeValue(Tag.Null, 0));
    }

    protected commitBoolean(v: boolean): void {
        this.commitValue(makeValue(v ? Tag.True : Tag.False, 0));
    }

    protected commitNumber(isDouble: boolean): void {
        const numberTag = isDouble ? Tag.Double : Tag.Integer;
        this.commitValue(makeValue(numberTag, 0));
    }

    protected commitString(s: string): void {
        let value: Value | undefined = undefined;
        if (this.handleRefs && this.isExpectingRef) {
            value = this.makeString(s);
        } else {
            const format = inferTransformedStringTypeKindForString(s, this.dateTimeRecognizer);
            if (format !== undefined) {
                if (defined(transformedStringTypeTargetTypeKindsMap.get(format)).attributesProducer !== undefined) {
                    value = makeValue(Tag.TransformedString, this.internString(s));
                } else {
                    value = makeValue(Tag.StringFormat, this.internString(format));
                }
            } else if (s.length <= 64) {
                value = this.makeString(s);
            } else {
                value = makeValue(Tag.UninternedString, 0);
            }
        }
        this.commitValue(value);
    }

    protected finish(): Value {
        const value = this._rootValue;
        if (value === undefined) {
            return panic("Finished without root document");
        }
        assert(this._ctx === undefined && this._contextStack.length === 0, "Finished with contexts present");
        this._rootValue = undefined;
        return value;
    }

    protected pushContext(): void {
        if (this._ctx !== undefined) {
            this._contextStack.push(this._ctx);
        }
        this._ctx = {
            currentObject: undefined,
            currentArray: undefined,
            currentKey: undefined,
            currentNumberIsDouble: false
        };
    }

    protected pushObjectContext(): void {
        this.pushContext();
        defined(this._ctx).currentObject = [];
    }

    protected setPropertyKey(key: string): void {
        const ctx = this.context;
        ctx.currentKey = key;
    }

    protected finishObject(): void {
        const obj = this.context.currentObject;
        if (obj === undefined) {
            return panic("Object ended but not started");
        }
        this.popContext();
        this.commitValue(this.internObject(obj));
    }

    protected pushArrayContext(): void {
        this.pushContext();
        defined(this._ctx).currentArray = [];
    }

    protected finishArray(): void {
        const arr = this.context.currentArray;
        if (arr === undefined) {
            return panic("Array ended but not started");
        }
        this.popContext();
        this.commitValue(this.internArray(arr));
    }

    protected popContext(): void {
        assert(this._ctx !== undefined, "Popping context when there isn't one");
        this._ctx = this._contextStack.pop();
    }

    equals(other: any): boolean {
        return this === other;
    }

    hashCode(): number {
        let hashAccumulator = hashCodeInit;
        for (const s of this._strings) {
            hashAccumulator = addHashCode(hashAccumulator, hashString(s));
        }

        for (const s of Object.getOwnPropertyNames(this._stringIndexes).sort()) {
            hashAccumulator = addHashCode(hashAccumulator, hashString(s));
            hashAccumulator = addHashCode(hashAccumulator, this._stringIndexes[s]);
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
    }
}

export class CompressedJSONFromString extends CompressedJSON<string> {
    async parse(input: string): Promise<Value> {
        return this.parseSync(input);
    }

    parseSync(input: string): Value {
        const json = JSON.parse(input);
        this.process(json);
        return this.finish();
    }

    protected process(json: unknown): void {
        if (json === null) {
            this.commitNull();
        } else if (typeof json === "boolean") {
            this.commitBoolean(json);
        } else if (typeof json === "string") {
            this.commitString(json);
        } else if (typeof json === "number") {
            const isDouble =
                json !== Math.floor(json) || json < Number.MIN_SAFE_INTEGER || json > Number.MAX_SAFE_INTEGER;
            this.commitNumber(isDouble);
        } else if (Array.isArray(json)) {
            this.pushArrayContext();
            for (const v of json) {
                this.process(v);
            }
            this.finishArray();
        } else if (typeof json === "object") {
            this.pushObjectContext();
            for (const key of Object.getOwnPropertyNames(json)) {
                this.setPropertyKey(key);
                this.process((json as any)[key]);
            }
            this.finishObject();
        } else {
            return panic("Invalid JSON object");
        }
    }
}

export class CompressedJSON5FromString extends CompressedJSONFromString {
    parseSync(input: string): Value {
        const json = JSON5parse(input);
        this.process(json);
        return this.finish();
    }
}
