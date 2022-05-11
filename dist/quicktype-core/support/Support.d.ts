export declare type StringMap = {
    [name: string]: any;
};
export declare function isStringMap(x: any): x is StringMap;
export declare function isStringMap<T>(x: any, checkValue: (v: any) => v is T): x is {
    [name: string]: T;
};
export declare function checkString(x: any): x is string;
export declare function checkStringMap(x: any): StringMap;
export declare function checkStringMap<T>(x: any, checkValue: (v: any) => v is T): {
    [name: string]: T;
};
export declare function checkArray(x: any): any[];
export declare function checkArray<T>(x: any, checkItem: (v: any) => v is T): T[];
export declare function defined<T>(x: T | undefined): T;
export declare function nonNull<T>(x: T | null): T;
export declare function assertNever(x: never): never;
export declare function assert(condition: boolean, message?: string): void;
export declare function panic(message: string): never;
export declare function mustNotHappen(): never;
export declare function repeated<T>(n: number, value: T): T[];
export declare function repeatedCall<T>(n: number, producer: () => T): T[];
export declare function errorMessage(e: any): string;
export declare function inflateBase64(encoded: string): string;
export declare function parseJSON(text: string, description: string, address?: string): any;
export declare function indentationString(level: number): string;
export declare function numberEnumValues(e: {
    [key: string]: any;
}): number[];
