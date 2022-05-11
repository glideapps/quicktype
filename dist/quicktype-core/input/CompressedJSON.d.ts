import { TransformedStringTypeKind } from "../Type";
import { DateTimeRecognizer } from "../DateTime";
export declare enum Tag {
    Null = 0,
    False = 1,
    True = 2,
    Integer = 3,
    Double = 4,
    InternedString = 5,
    UninternedString = 6,
    Object = 7,
    Array = 8,
    StringFormat = 9,
    TransformedString = 10
}
export declare type Value = number;
export declare function makeValue(t: Tag, index: number): Value;
export declare function valueTag(v: Value): Tag;
declare type Context = {
    currentObject: Value[] | undefined;
    currentArray: Value[] | undefined;
    currentKey: string | undefined;
    currentNumberIsDouble: boolean;
};
export declare abstract class CompressedJSON<T> {
    readonly dateTimeRecognizer: DateTimeRecognizer;
    readonly handleRefs: boolean;
    private _rootValue;
    private _ctx;
    private _contextStack;
    private _strings;
    private _stringIndexes;
    private _objects;
    private _arrays;
    constructor(dateTimeRecognizer: DateTimeRecognizer, handleRefs: boolean);
    abstract parse(input: T): Promise<Value>;
    parseSync(_input: T): Value;
    getStringForValue(v: Value): string;
    getObjectForValue: (v: number) => number[];
    getArrayForValue: (v: number) => number[];
    getStringFormatTypeKind(v: Value): TransformedStringTypeKind;
    protected readonly context: Context;
    protected internString(s: string): number;
    protected makeString(s: string): Value;
    protected internObject(obj: Value[]): Value;
    protected internArray: (arr: number[]) => number;
    protected readonly isExpectingRef: boolean;
    protected commitValue(value: Value): void;
    protected commitNull(): void;
    protected commitBoolean(v: boolean): void;
    protected commitNumber(isDouble: boolean): void;
    protected commitString(s: string): void;
    protected finish(): Value;
    protected pushContext(): void;
    protected pushObjectContext(): void;
    protected setPropertyKey(key: string): void;
    protected finishObject(): void;
    protected pushArrayContext(): void;
    protected finishArray(): void;
    protected popContext(): void;
    equals(other: any): boolean;
    hashCode(): number;
}
export declare class CompressedJSONFromString extends CompressedJSON<string> {
    parse(input: string): Promise<Value>;
    parseSync(input: string): Value;
    private process;
}
export {};
