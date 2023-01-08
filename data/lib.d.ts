/*! *****************************************************************************
Copyright (c) Microsoft Corporation. All rights reserved. 
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0  
 
THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE, 
MERCHANTABLITY OR NON-INFRINGEMENT. 
 
See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */

/// <reference no-default-lib="true"/>

/////////////////////////////
/// ECMAScript APIs
/////////////////////////////

declare const NaN: number;
declare const Infinity: number;

declare function eval(x: string): any;

declare function parseInt(s: string, radix?: number): number;

declare function parseFloat(string: string): number;

declare function isNaN(number: number): boolean;

declare function isFinite(number: number): boolean;

declare function decodeURI(encodedURI: string): string;

declare function decodeURIComponent(encodedURIComponent: string): string;

declare function encodeURI(uri: string): string;

declare function encodeURIComponent(uriComponent: string): string;

interface PropertyDescriptor {
    configurable?: boolean;
    enumerable?: boolean;
    value?: any;
    writable?: boolean;
    get?(): any;
    set?(v: any): void;
}

interface PropertyDescriptorMap {
    [s: string]: PropertyDescriptor;
}

interface Object {
    constructor: Function;

    toString(): string;

    toLocaleString(): string;

    valueOf(): Object;

    hasOwnProperty(v: string): boolean;

    isPrototypeOf(v: Object): boolean;

    propertyIsEnumerable(v: string): boolean;
}

interface ObjectConstructor {
    new (value?: any): Object;
    (): any;
    (value: any): any;

    readonly prototype: Object;

    getPrototypeOf(o: any): any;

    getOwnPropertyDescriptor(o: any, p: string): PropertyDescriptor | undefined;

    getOwnPropertyNames(o: any): string[];

    create(o: object | null): any;

    create(o: object | null, properties: PropertyDescriptorMap & ThisType<any>): any;

    defineProperty(o: any, p: string, attributes: PropertyDescriptor & ThisType<any>): any;

    defineProperties(o: any, properties: PropertyDescriptorMap & ThisType<any>): any;

    seal<T>(o: T): T;

    freeze<T>(a: T[]): ReadonlyArray<T>;

    freeze<T extends Function>(f: T): T;

    freeze<T>(o: T): Readonly<T>;

    preventExtensions<T>(o: T): T;

    isSealed(o: any): boolean;

    isFrozen(o: any): boolean;

    isExtensible(o: any): boolean;

    keys(o: {}): string[];
}

declare const Object: ObjectConstructor;

interface Function {
    apply(this: Function, thisArg: any, argArray?: any): any;

    call(this: Function, thisArg: any, ...argArray: any[]): any;

    bind(this: Function, thisArg: any, ...argArray: any[]): any;

    toString(): string;

    prototype: any;
    readonly length: number;

    // Non-standard extensions
    arguments: any;
    caller: Function;
}

interface FunctionConstructor {
    new (...args: string[]): Function;
    (...args: string[]): Function;
    readonly prototype: Function;
}

declare const Function: FunctionConstructor;

interface IArguments {
    [index: number]: any;
    length: number;
    callee: Function;
}

interface String {
    toString(): string;

    charAt(pos: number): string;

    charCodeAt(index: number): number;

    concat(...strings: string[]): string;

    indexOf(searchString: string, position?: number): number;

    lastIndexOf(searchString: string, position?: number): number;

    localeCompare(that: string): number;

    match(regexp: string | RegExp): RegExpMatchArray | null;

    replace(searchValue: string | RegExp, replaceValue: string): string;

    replace(searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string): string;

    search(regexp: string | RegExp): number;

    slice(start?: number, end?: number): string;

    split(separator: string | RegExp, limit?: number): string[];

    substring(start: number, end?: number): string;

    toLowerCase(): string;

    toLocaleLowerCase(): string;

    toUpperCase(): string;

    toLocaleUpperCase(): string;

    trim(): string;

    readonly length: number;

    // IE extensions

    substr(from: number, length?: number): string;

    valueOf(): string;

    readonly [index: number]: string;
}

interface StringConstructor {
    new (value?: any): String;
    (value?: any): string;
    readonly prototype: String;
    fromCharCode(...codes: number[]): string;
}

declare const String: StringConstructor;

interface Boolean {
    valueOf(): boolean;
}

interface BooleanConstructor {
    new (value?: any): Boolean;
    (value?: any): boolean;
    readonly prototype: Boolean;
}

declare const Boolean: BooleanConstructor;

interface Number {
    toString(radix?: number): string;

    toFixed(fractionDigits?: number): string;

    toExponential(fractionDigits?: number): string;

    toPrecision(precision?: number): string;

    valueOf(): number;
}

interface NumberConstructor {
    new (value?: any): Number;
    (value?: any): number;
    readonly prototype: Number;

    readonly MAX_VALUE: number;

    readonly MIN_VALUE: number;

    readonly NaN: number;

    readonly NEGATIVE_INFINITY: number;

    readonly POSITIVE_INFINITY: number;
}

declare const Number: NumberConstructor;

interface TemplateStringsArray extends ReadonlyArray<string> {
    readonly raw: ReadonlyArray<string>;
}

interface Math {
    readonly E: number;

    readonly LN10: number;

    readonly LN2: number;

    readonly LOG2E: number;

    readonly LOG10E: number;

    readonly PI: number;

    readonly SQRT1_2: number;

    readonly SQRT2: number;

    abs(x: number): number;

    acos(x: number): number;

    asin(x: number): number;

    atan(x: number): number;

    atan2(y: number, x: number): number;

    ceil(x: number): number;

    cos(x: number): number;

    exp(x: number): number;

    floor(x: number): number;

    log(x: number): number;

    max(...values: number[]): number;

    min(...values: number[]): number;

    pow(x: number, y: number): number;

    random(): number;

    round(x: number): number;

    sin(x: number): number;

    sqrt(x: number): number;

    tan(x: number): number;
}

declare const Math: Math;

interface Date {
    toString(): string;

    toDateString(): string;

    toTimeString(): string;

    toLocaleString(): string;

    toLocaleDateString(): string;

    toLocaleTimeString(): string;

    valueOf(): number;

    getTime(): number;

    getFullYear(): number;

    getUTCFullYear(): number;

    getMonth(): number;

    getUTCMonth(): number;

    getDate(): number;

    getUTCDate(): number;

    getDay(): number;

    getUTCDay(): number;

    getHours(): number;

    getUTCHours(): number;

    getMinutes(): number;

    getUTCMinutes(): number;

    getSeconds(): number;

    getUTCSeconds(): number;

    getMilliseconds(): number;

    getUTCMilliseconds(): number;

    getTimezoneOffset(): number;

    setTime(time: number): number;

    setMilliseconds(ms: number): number;

    setUTCMilliseconds(ms: number): number;

    setSeconds(sec: number, ms?: number): number;

    setUTCSeconds(sec: number, ms?: number): number;

    setMinutes(min: number, sec?: number, ms?: number): number;

    setUTCMinutes(min: number, sec?: number, ms?: number): number;

    setHours(hours: number, min?: number, sec?: number, ms?: number): number;

    setUTCHours(hours: number, min?: number, sec?: number, ms?: number): number;

    setDate(date: number): number;

    setUTCDate(date: number): number;

    setMonth(month: number, date?: number): number;

    setUTCMonth(month: number, date?: number): number;

    setFullYear(year: number, month?: number, date?: number): number;

    setUTCFullYear(year: number, month?: number, date?: number): number;

    toUTCString(): string;

    toISOString(): string;

    toJSON(key?: any): string;
}

interface DateConstructor {
    new (): Date;
    new (value: number): Date;
    new (value: string): Date;
    new (
        year: number,
        month: number,
        date?: number,
        hours?: number,
        minutes?: number,
        seconds?: number,
        ms?: number
    ): Date;
    (): string;
    readonly prototype: Date;

    parse(s: string): number;

    UTC(
        year: number,
        month: number,
        date?: number,
        hours?: number,
        minutes?: number,
        seconds?: number,
        ms?: number
    ): number;
    now(): number;
}

declare const Date: DateConstructor;

interface RegExpMatchArray extends Array<string> {
    index?: number;
    input?: string;
}

interface RegExpExecArray extends Array<string> {
    index: number;
    input: string;
}

interface RegExp {
    exec(string: string): RegExpExecArray | null;

    test(string: string): boolean;

    readonly source: string;

    readonly global: boolean;

    readonly ignoreCase: boolean;

    readonly multiline: boolean;

    lastIndex: number;

    // Non-standard extensions
    compile(): this;
}

interface RegExpConstructor {
    new (pattern: RegExp | string): RegExp;
    new (pattern: string, flags?: string): RegExp;
    (pattern: RegExp | string): RegExp;
    (pattern: string, flags?: string): RegExp;
    readonly prototype: RegExp;

    // Non-standard extensions
    $1: string;
    $2: string;
    $3: string;
    $4: string;
    $5: string;
    $6: string;
    $7: string;
    $8: string;
    $9: string;
    lastMatch: string;
}

declare const RegExp: RegExpConstructor;

interface Error {
    name: string;
    message: string;
    stack?: string;
}

interface ErrorConstructor {
    new (message?: string): Error;
    (message?: string): Error;
    readonly prototype: Error;
}

declare const Error: ErrorConstructor;

interface EvalError extends Error {}

interface EvalErrorConstructor {
    new (message?: string): EvalError;
    (message?: string): EvalError;
    readonly prototype: EvalError;
}

declare const EvalError: EvalErrorConstructor;

interface RangeError extends Error {}

interface RangeErrorConstructor {
    new (message?: string): RangeError;
    (message?: string): RangeError;
    readonly prototype: RangeError;
}

declare const RangeError: RangeErrorConstructor;

interface ReferenceError extends Error {}

interface ReferenceErrorConstructor {
    new (message?: string): ReferenceError;
    (message?: string): ReferenceError;
    readonly prototype: ReferenceError;
}

declare const ReferenceError: ReferenceErrorConstructor;

interface SyntaxError extends Error {}

interface SyntaxErrorConstructor {
    new (message?: string): SyntaxError;
    (message?: string): SyntaxError;
    readonly prototype: SyntaxError;
}

declare const SyntaxError: SyntaxErrorConstructor;

interface TypeError extends Error {}

interface TypeErrorConstructor {
    new (message?: string): TypeError;
    (message?: string): TypeError;
    readonly prototype: TypeError;
}

declare const TypeError: TypeErrorConstructor;

interface URIError extends Error {}

interface URIErrorConstructor {
    new (message?: string): URIError;
    (message?: string): URIError;
    readonly prototype: URIError;
}

declare const URIError: URIErrorConstructor;

interface JSON {
    parse(text: string, reviver?: (key: any, value: any) => any): any;

    stringify(value: any, replacer?: (key: string, value: any) => any, space?: string | number): string;

    stringify(value: any, replacer?: (number | string)[] | null, space?: string | number): string;
}

declare const JSON: JSON;

/////////////////////////////
/// ECMAScript Array API (specially handled by compiler)
/////////////////////////////

interface ReadonlyArray<T> {
    readonly length: number;

    toString(): string;

    toLocaleString(): string;

    concat(...items: ReadonlyArray<T>[]): T[];

    concat(...items: (T | ReadonlyArray<T>)[]): T[];

    join(separator?: string): string;

    slice(start?: number, end?: number): T[];

    indexOf(searchElement: T, fromIndex?: number): number;

    lastIndexOf(searchElement: T, fromIndex?: number): number;

    every(callbackfn: (value: T, index: number, array: ReadonlyArray<T>) => boolean, thisArg?: any): boolean;

    some(callbackfn: (value: T, index: number, array: ReadonlyArray<T>) => boolean, thisArg?: any): boolean;

    forEach(callbackfn: (value: T, index: number, array: ReadonlyArray<T>) => void, thisArg?: any): void;

    map<U>(callbackfn: (value: T, index: number, array: ReadonlyArray<T>) => U, thisArg?: any): U[];

    filter<S extends T>(
        callbackfn: (value: T, index: number, array: ReadonlyArray<T>) => value is S,
        thisArg?: any
    ): S[];

    filter(callbackfn: (value: T, index: number, array: ReadonlyArray<T>) => any, thisArg?: any): T[];

    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ReadonlyArray<T>) => T): T;
    reduce(
        callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ReadonlyArray<T>) => T,
        initialValue: T
    ): T;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: ReadonlyArray<T>) => U,
        initialValue: U
    ): U;

    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ReadonlyArray<T>) => T): T;
    reduceRight(
        callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ReadonlyArray<T>) => T,
        initialValue: T
    ): T;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: ReadonlyArray<T>) => U,
        initialValue: U
    ): U;

    readonly [n: number]: T;
}

interface Array<T> {
    length: number;

    toString(): string;

    toLocaleString(): string;

    push(...items: T[]): number;

    pop(): T | undefined;

    concat(...items: ReadonlyArray<T>[]): T[];

    concat(...items: (T | ReadonlyArray<T>)[]): T[];

    join(separator?: string): string;

    reverse(): T[];

    shift(): T | undefined;

    slice(start?: number, end?: number): T[];

    sort(compareFn?: (a: T, b: T) => number): this;

    splice(start: number, deleteCount?: number): T[];

    splice(start: number, deleteCount: number, ...items: T[]): T[];

    unshift(...items: T[]): number;

    indexOf(searchElement: T, fromIndex?: number): number;

    lastIndexOf(searchElement: T, fromIndex?: number): number;

    every(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean;

    some(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean;

    forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void;

    map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];

    filter<S extends T>(callbackfn: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[];

    filter(callbackfn: (value: T, index: number, array: T[]) => any, thisArg?: any): T[];

    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U,
        initialValue: U
    ): U;

    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
    reduceRight(
        callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T,
        initialValue: T
    ): T;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U,
        initialValue: U
    ): U;

    [n: number]: T;
}

interface ArrayConstructor {
    new (arrayLength?: number): any[];
    new <T>(arrayLength: number): T[];
    new <T>(...items: T[]): T[];
    (arrayLength?: number): any[];
    <T>(arrayLength: number): T[];
    <T>(...items: T[]): T[];
    isArray(arg: any): arg is Array<any>;
    readonly prototype: Array<any>;
}

declare const Array: ArrayConstructor;

interface TypedPropertyDescriptor<T> {
    enumerable?: boolean;
    configurable?: boolean;
    writable?: boolean;
    value?: T;
    get?: () => T;
    set?: (value: T) => void;
}

declare type ClassDecorator = <TFunction extends Function>(target: TFunction) => TFunction | void;
declare type PropertyDecorator = (target: Object, propertyKey: string | symbol) => void;
declare type MethodDecorator = <T>(
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
) => TypedPropertyDescriptor<T> | void;
declare type ParameterDecorator = (target: Object, propertyKey: string | symbol, parameterIndex: number) => void;

declare type PromiseConstructorLike = new <T>(
    executor: (resolve: (value?: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void
) => PromiseLike<T>;

interface PromiseLike<T> {
    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): PromiseLike<TResult1 | TResult2>;
}

interface Promise<T> {
    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2>;

    catch<TResult = never>(
        onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
    ): Promise<T | TResult>;
}

interface ArrayLike<T> {
    readonly length: number;
    readonly [n: number]: T;
}

type Partial<T> = {
    [P in keyof T]?: T[P];
};

type Readonly<T> = {
    readonly [P in keyof T]: T[P];
};

type Pick<T, K extends keyof T> = {
    [P in K]: T[P];
};

type Record<K extends string, T> = {
    [P in K]: T;
};

interface ThisType<T> {}

interface ArrayBuffer {
    readonly byteLength: number;

    slice(begin: number, end?: number): ArrayBuffer;
}

interface ArrayBufferTypes {
    ArrayBuffer: ArrayBuffer;
}
type ArrayBufferLike = ArrayBufferTypes[keyof ArrayBufferTypes];

interface ArrayBufferConstructor {
    readonly prototype: ArrayBuffer;
    new (byteLength: number): ArrayBuffer;
    isView(arg: any): arg is ArrayBufferView;
}
declare const ArrayBuffer: ArrayBufferConstructor;

interface ArrayBufferView {
    buffer: ArrayBufferLike;

    byteLength: number;

    byteOffset: number;
}

interface DataView {
    readonly buffer: ArrayBuffer;
    readonly byteLength: number;
    readonly byteOffset: number;

    getFloat32(byteOffset: number, littleEndian?: boolean): number;

    getFloat64(byteOffset: number, littleEndian?: boolean): number;

    getInt8(byteOffset: number): number;

    getInt16(byteOffset: number, littleEndian?: boolean): number;

    getInt32(byteOffset: number, littleEndian?: boolean): number;

    getUint8(byteOffset: number): number;

    getUint16(byteOffset: number, littleEndian?: boolean): number;

    getUint32(byteOffset: number, littleEndian?: boolean): number;

    setFloat32(byteOffset: number, value: number, littleEndian?: boolean): void;

    setFloat64(byteOffset: number, value: number, littleEndian?: boolean): void;

    setInt8(byteOffset: number, value: number): void;

    setInt16(byteOffset: number, value: number, littleEndian?: boolean): void;

    setInt32(byteOffset: number, value: number, littleEndian?: boolean): void;

    setUint8(byteOffset: number, value: number): void;

    setUint16(byteOffset: number, value: number, littleEndian?: boolean): void;

    setUint32(byteOffset: number, value: number, littleEndian?: boolean): void;
}

interface DataViewConstructor {
    new (buffer: ArrayBufferLike, byteOffset?: number, byteLength?: number): DataView;
}
declare const DataView: DataViewConstructor;

interface Int8Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Int8Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Int8Array) => any, thisArg?: any): Int8Array;

    find(predicate: (value: number, index: number, obj: Int8Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Int8Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Int8Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Int8Array) => number, thisArg?: any): Int8Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int8Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int8Array) => U,
        initialValue: U
    ): U;

    reverse(): Int8Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Int8Array;

    some(callbackfn: (value: number, index: number, array: Int8Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Int8Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}
interface Int8ArrayConstructor {
    readonly prototype: Int8Array;
    new (length: number): Int8Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Int8Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Int8Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Int8Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Int8Array;
}
declare const Int8Array: Int8ArrayConstructor;

interface Uint8Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Uint8Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Uint8Array) => any, thisArg?: any): Uint8Array;

    find(predicate: (value: number, index: number, obj: Uint8Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Uint8Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Uint8Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Uint8Array) => number, thisArg?: any): Uint8Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8Array) => U,
        initialValue: U
    ): U;

    reverse(): Uint8Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Uint8Array;

    some(callbackfn: (value: number, index: number, array: Uint8Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Uint8Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Uint8ArrayConstructor {
    readonly prototype: Uint8Array;
    new (length: number): Uint8Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Uint8Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Uint8Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Uint8Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Uint8Array;
}
declare const Uint8Array: Uint8ArrayConstructor;

interface Uint8ClampedArray {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Uint8ClampedArray) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(
        callbackfn: (value: number, index: number, array: Uint8ClampedArray) => any,
        thisArg?: any
    ): Uint8ClampedArray;

    find(
        predicate: (value: number, index: number, obj: Uint8ClampedArray) => boolean,
        thisArg?: any
    ): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Uint8ClampedArray) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Uint8ClampedArray) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(
        callbackfn: (value: number, index: number, array: Uint8ClampedArray) => number,
        thisArg?: any
    ): Uint8ClampedArray;

    reduce(
        callbackfn: (
            previousValue: number,
            currentValue: number,
            currentIndex: number,
            array: Uint8ClampedArray
        ) => number
    ): number;
    reduce(
        callbackfn: (
            previousValue: number,
            currentValue: number,
            currentIndex: number,
            array: Uint8ClampedArray
        ) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8ClampedArray) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (
            previousValue: number,
            currentValue: number,
            currentIndex: number,
            array: Uint8ClampedArray
        ) => number
    ): number;
    reduceRight(
        callbackfn: (
            previousValue: number,
            currentValue: number,
            currentIndex: number,
            array: Uint8ClampedArray
        ) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8ClampedArray) => U,
        initialValue: U
    ): U;

    reverse(): Uint8ClampedArray;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Uint8ClampedArray;

    some(callbackfn: (value: number, index: number, array: Uint8ClampedArray) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Uint8ClampedArray;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Uint8ClampedArrayConstructor {
    readonly prototype: Uint8ClampedArray;
    new (length: number): Uint8ClampedArray;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Uint8ClampedArray;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Uint8ClampedArray;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Uint8ClampedArray;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Uint8ClampedArray;
}
declare const Uint8ClampedArray: Uint8ClampedArrayConstructor;

interface Int16Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Int16Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Int16Array) => any, thisArg?: any): Int16Array;

    find(predicate: (value: number, index: number, obj: Int16Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Int16Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Int16Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Int16Array) => number, thisArg?: any): Int16Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int16Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int16Array) => U,
        initialValue: U
    ): U;

    reverse(): Int16Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Int16Array;

    some(callbackfn: (value: number, index: number, array: Int16Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Int16Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Int16ArrayConstructor {
    readonly prototype: Int16Array;
    new (length: number): Int16Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Int16Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Int16Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Int16Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Int16Array;
}
declare const Int16Array: Int16ArrayConstructor;

interface Uint16Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Uint16Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Uint16Array) => any, thisArg?: any): Uint16Array;

    find(predicate: (value: number, index: number, obj: Uint16Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Uint16Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Uint16Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Uint16Array) => number, thisArg?: any): Uint16Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint16Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint16Array) => U,
        initialValue: U
    ): U;

    reverse(): Uint16Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Uint16Array;

    some(callbackfn: (value: number, index: number, array: Uint16Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Uint16Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Uint16ArrayConstructor {
    readonly prototype: Uint16Array;
    new (length: number): Uint16Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Uint16Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Uint16Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Uint16Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Uint16Array;
}
declare const Uint16Array: Uint16ArrayConstructor;

interface Int32Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Int32Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Int32Array) => any, thisArg?: any): Int32Array;

    find(predicate: (value: number, index: number, obj: Int32Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Int32Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Int32Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Int32Array) => number, thisArg?: any): Int32Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int32Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int32Array) => U,
        initialValue: U
    ): U;

    reverse(): Int32Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Int32Array;

    some(callbackfn: (value: number, index: number, array: Int32Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Int32Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Int32ArrayConstructor {
    readonly prototype: Int32Array;
    new (length: number): Int32Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Int32Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Int32Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Int32Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Int32Array;
}
declare const Int32Array: Int32ArrayConstructor;

interface Uint32Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Uint32Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Uint32Array) => any, thisArg?: any): Uint32Array;

    find(predicate: (value: number, index: number, obj: Uint32Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Uint32Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Uint32Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Uint32Array) => number, thisArg?: any): Uint32Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint32Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint32Array) => U,
        initialValue: U
    ): U;

    reverse(): Uint32Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Uint32Array;

    some(callbackfn: (value: number, index: number, array: Uint32Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Uint32Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Uint32ArrayConstructor {
    readonly prototype: Uint32Array;
    new (length: number): Uint32Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Uint32Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Uint32Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Uint32Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Uint32Array;
}
declare const Uint32Array: Uint32ArrayConstructor;

interface Float32Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Float32Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Float32Array) => any, thisArg?: any): Float32Array;

    find(predicate: (value: number, index: number, obj: Float32Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Float32Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Float32Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Float32Array) => number, thisArg?: any): Float32Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float32Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float32Array) => U,
        initialValue: U
    ): U;

    reverse(): Float32Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Float32Array;

    some(callbackfn: (value: number, index: number, array: Float32Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Float32Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Float32ArrayConstructor {
    readonly prototype: Float32Array;
    new (length: number): Float32Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Float32Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Float32Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Float32Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Float32Array;
}
declare const Float32Array: Float32ArrayConstructor;

interface Float64Array {
    readonly BYTES_PER_ELEMENT: number;

    readonly buffer: ArrayBufferLike;

    readonly byteLength: number;

    readonly byteOffset: number;

    copyWithin(target: number, start: number, end?: number): this;

    every(callbackfn: (value: number, index: number, array: Float64Array) => boolean, thisArg?: any): boolean;

    fill(value: number, start?: number, end?: number): this;

    filter(callbackfn: (value: number, index: number, array: Float64Array) => any, thisArg?: any): Float64Array;

    find(predicate: (value: number, index: number, obj: Float64Array) => boolean, thisArg?: any): number | undefined;

    findIndex(predicate: (value: number, index: number, obj: Float64Array) => boolean, thisArg?: any): number;

    forEach(callbackfn: (value: number, index: number, array: Float64Array) => void, thisArg?: any): void;

    indexOf(searchElement: number, fromIndex?: number): number;

    join(separator?: string): string;

    lastIndexOf(searchElement: number, fromIndex?: number): number;

    readonly length: number;

    map(callbackfn: (value: number, index: number, array: Float64Array) => number, thisArg?: any): Float64Array;

    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array) => number
    ): number;
    reduce(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array) => number,
        initialValue: number
    ): number;

    reduce<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float64Array) => U,
        initialValue: U
    ): U;

    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array) => number
    ): number;
    reduceRight(
        callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array) => number,
        initialValue: number
    ): number;

    reduceRight<U>(
        callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float64Array) => U,
        initialValue: U
    ): U;

    reverse(): Float64Array;

    set(array: ArrayLike<number>, offset?: number): void;

    slice(start?: number, end?: number): Float64Array;

    some(callbackfn: (value: number, index: number, array: Float64Array) => boolean, thisArg?: any): boolean;

    sort(compareFn?: (a: number, b: number) => number): this;

    subarray(begin: number, end?: number): Float64Array;

    toLocaleString(): string;

    toString(): string;

    [index: number]: number;
}

interface Float64ArrayConstructor {
    readonly prototype: Float64Array;
    new (length: number): Float64Array;
    new (arrayOrArrayBuffer: ArrayLike<number> | ArrayBufferLike): Float64Array;
    new (buffer: ArrayBufferLike, byteOffset: number, length?: number): Float64Array;

    readonly BYTES_PER_ELEMENT: number;

    of(...items: number[]): Float64Array;

    from(arrayLike: ArrayLike<number>, mapfn?: (v: number, k: number) => number, thisArg?: any): Float64Array;
}
declare const Float64Array: Float64ArrayConstructor;
