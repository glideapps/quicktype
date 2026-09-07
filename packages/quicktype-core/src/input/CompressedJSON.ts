import { addHashCode, hashCodeInit, hashString } from "collection-utils";
import { type Many, getManyValues, isMany, none } from "stream-chain/core";
import * as StreamJSONParser from "stream-json/core/parser.js";

import { inferTransformedStringTypeKindForString } from "../attributes/StringTypes.js";
import type { DateTimeRecognizer } from "../DateTime.js";
import {
    INT64_RANGE,
    type IntegerRange,
    integerStringInRange,
} from "../support/IntegerRange.js";
import { assert, defined, panic } from "../support/Support.js";
import {
    type TransformedStringTypeKind,
    isPrimitiveStringTypeKind,
    transformedStringTypeTargetTypeKindsMap,
} from "../Type/index.js";

export enum Tag {
    Null = 1,
    False = 2,
    True = 3,
    Integer = 4,
    Double = 5,
    InternedString = 6,
    UninternedString = 7,
    Object = 8,
    Array = 9,
    StringFormat = 10,
    TransformedString = 11,
}

export type Value = number;

const TAG_BITS = 4;
const TAG_MASK = (1 << TAG_BITS) - 1;

export function makeValue(t: Tag, index: number): Value {
    return t | (index << TAG_BITS);
}

function getIndex(v: Value, tag: Tag): number {
    assert(
        valueTag(v) === tag,
        "Trying to get index for value with invalid tag",
    );
    return v >> TAG_BITS;
}

export function valueTag(v: Value): Tag {
    return v & TAG_MASK;
}

interface Context {
    currentArray: Value[] | undefined;
    currentKey: string | undefined;
    currentNumberIsDouble: boolean;
    currentObject: Value[] | undefined;
}

type JSONToken =
    | { name: "startObject" }
    | { name: "endObject" }
    | { name: "startArray" }
    | { name: "endArray" }
    | { name: "startKey" }
    | { name: "endKey" }
    | { name: "startString" }
    | { name: "endString" }
    | { name: "startNumber" }
    | { name: "endNumber" }
    | { name: "keyValue"; value: string }
    | { name: "stringChunk"; value: string }
    | { name: "stringValue"; value: string }
    | { name: "numberChunk"; value: string }
    | { name: "numberValue"; value: string }
    | { name: "nullValue"; value: null }
    | { name: "trueValue"; value: true }
    | { name: "falseValue"; value: false }
    | { name: "whitespace"; value: string };

export abstract class CompressedJSON<T> {
    private _rootValue: Value | undefined;

    private _ctx: Context | undefined;

    private readonly _contextStack: Context[] = [];

    private readonly _strings: string[] = [];

    private readonly _stringIndexes: { [str: string]: number } = {};

    private readonly _objects: Value[][] = [];

    private readonly _arrays: Value[][] = [];

    // Numbers cannot nest, so a single literal accumulator suffices.
    private _currentIntegerString = "";

    /**
     * `supportedIntegerRange` is the range of whole numbers in the input
     * that get inferred as `integer`; whole numbers outside it are inferred
     * as `double`, because the target language's integer type could not
     * round-trip them.  `null` means the target's integers are
     * arbitrary-precision.  See `TargetLanguage.getSupportedIntegerRange`.
     */
    public constructor(
        public readonly dateTimeRecognizer: DateTimeRecognizer,
        public readonly handleRefs: boolean,
        public readonly supportedIntegerRange: IntegerRange | null = INT64_RANGE,
    ) {}

    public abstract parse(input: T): Promise<Value>;

    /**
     * Whether a whole number in the input, given as the decimal string of
     * its JSON literal, fits `supportedIntegerRange`.  Works on the digit
     * string because such literals can exceed what a JavaScript number can
     * represent exactly.
     */
    protected integerStringFits(integerString: string): boolean {
        const range = this.supportedIntegerRange;
        if (range === null) return true;
        return integerStringInRange(integerString, range);
    }

    public parseSync(_input: T): Value {
        return panic("parseSync not implemented in CompressedJSON");
    }

    public getStringForValue(v: Value): string {
        const tag = valueTag(v);
        assert(tag === Tag.InternedString || tag === Tag.TransformedString);
        return this._strings[getIndex(v, tag)];
    }

    public getObjectForValue = (v: Value): Value[] => {
        return this._objects[getIndex(v, Tag.Object)];
    };

    public getArrayForValue = (v: Value): Value[] => {
        return this._arrays[getIndex(v, Tag.Array)];
    };

    public getStringFormatTypeKind(v: Value): TransformedStringTypeKind {
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
        // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is not in quicktype-core's es6 lib
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
        assert(
            typeof value === "number",
            `Interned string value is not a number: ${value}`,
        );
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
        assert(
            typeof value === "number",
            `CompressedJSON value is not a number: ${value}`,
        );
        if (this._ctx === undefined) {
            assert(
                this._rootValue === undefined,
                "Committing value but nowhere to commit to - root value still there.",
            );
            this._rootValue = value;
        } else if (this._ctx.currentObject !== undefined) {
            if (this._ctx.currentKey === undefined) {
                return panic(
                    "Must have key and can't have string when committing",
                );
            }

            this._ctx.currentObject.push(
                this.makeString(this._ctx.currentKey),
                value,
            );
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

    protected processToken(token: JSONToken): void {
        switch (token.name) {
            case "startObject":
                this.pushObjectContext();
                break;
            case "endObject":
                this.finishObject();
                break;
            case "startArray":
                this.pushArrayContext();
                break;
            case "endArray":
                this.finishArray();
                break;
            case "startNumber":
                this.pushContext();
                this.context.currentNumberIsDouble = false;
                this._currentIntegerString = "";
                break;
            case "numberChunk":
                if (/[.e]/i.test(token.value)) {
                    this.context.currentNumberIsDouble = true;
                } else if (!this.context.currentNumberIsDouble) {
                    this._currentIntegerString += token.value;
                }
                break;
            case "endNumber": {
                const isDouble =
                    this.context.currentNumberIsDouble ||
                    !this.integerStringFits(this._currentIntegerString);
                this.popContext();
                this.commitNumber(isDouble);
                break;
            }
            case "keyValue":
                this.setPropertyKey(token.value);
                break;
            case "stringValue":
                this.commitString(token.value);
                break;
            case "nullValue":
                this.commitNull();
                break;
            case "trueValue":
                this.commitBoolean(true);
                break;
            case "falseValue":
                this.commitBoolean(false);
                break;
        }
    }

    protected commitString(s: string): void {
        let value: Value | undefined;
        if (this.handleRefs && this.isExpectingRef) {
            value = this.makeString(s);
        } else {
            const format = inferTransformedStringTypeKindForString(
                s,
                this.dateTimeRecognizer,
            );
            if (format !== undefined) {
                if (
                    defined(transformedStringTypeTargetTypeKindsMap.get(format))
                        .attributesProducer !== undefined
                ) {
                    value = makeValue(
                        Tag.TransformedString,
                        this.internString(s),
                    );
                } else {
                    value = makeValue(
                        Tag.StringFormat,
                        this.internString(format),
                    );
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

        assert(
            this._ctx === undefined && this._contextStack.length === 0,
            "Finished with contexts present",
        );
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
            currentNumberIsDouble: false,
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

    public equals(other: CompressedJSON<unknown>): boolean {
        return this === other;
    }

    public hashCode(): number {
        let hashAccumulator = hashCodeInit;
        for (const s of this._strings) {
            hashAccumulator = addHashCode(hashAccumulator, hashString(s));
        }

        for (const s of Object.getOwnPropertyNames(
            this._stringIndexes,
        ).sort()) {
            hashAccumulator = addHashCode(hashAccumulator, hashString(s));
            hashAccumulator = addHashCode(
                hashAccumulator,
                this._stringIndexes[s],
            );
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

// stream-json exposes its synchronous tokenizer at runtime, but its type
// declarations currently only describe the asynchronous parser wrapper.
const jsonParser = (
    StreamJSONParser as unknown as {
        jsonParser: (options: {
            packKeys: boolean;
            packStrings: boolean;
        }) => unknown;
    }
).jsonParser;

export class CompressedJSONFromString extends CompressedJSON<string> {
    public async parse(input: string): Promise<Value> {
        return this.parseSync(input);
    }

    public parseSync(input: string): Value {
        type ParserResult = Many<JSONToken> | typeof none;
        const parseChunk = jsonParser({
            packKeys: true,
            packStrings: true,
        }) as (chunk: string | typeof none) => ParserResult;
        const processTokens = (result: ParserResult): void => {
            if (!isMany(result)) return;
            for (const token of getManyValues(result)) {
                this.processToken(token);
            }
        };

        processTokens(parseChunk(input));
        processTokens(parseChunk(none));
        return this.finish();
    }
}
