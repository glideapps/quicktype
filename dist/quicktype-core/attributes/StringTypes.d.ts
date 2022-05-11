import { TypeAttributeKind } from "./TypeAttributes";
import { StringTypeMapping } from "../TypeBuilder";
import { TransformedStringTypeKind } from "../Type";
import { DateTimeRecognizer } from "../DateTime";
export declare class StringTypes {
    readonly cases: ReadonlyMap<string, number> | undefined;
    readonly transformations: ReadonlySet<TransformedStringTypeKind>;
    static readonly unrestricted: StringTypes;
    static fromCase(s: string, count: number): StringTypes;
    static fromCases(cases: string[]): StringTypes;
    constructor(cases: ReadonlyMap<string, number> | undefined, transformations: ReadonlySet<TransformedStringTypeKind>);
    readonly isRestricted: boolean;
    union(othersArray: StringTypes[], startIndex: number): StringTypes;
    intersect(othersArray: StringTypes[], startIndex: number): StringTypes;
    applyStringTypeMapping(mapping: StringTypeMapping): StringTypes;
    equals(other: any): boolean;
    hashCode(): number;
    toString(): string;
}
export declare const stringTypesTypeAttributeKind: TypeAttributeKind<StringTypes>;
/**
 * JSON inference calls this function to figure out whether a given string is to be
 * transformed into a higher level type.  Must return undefined if not, otherwise the
 * type kind of the transformed string type.
 *
 * @param s The string for which to determine the transformed string type kind.
 */
export declare function inferTransformedStringTypeKindForString(s: string, recognizer: DateTimeRecognizer): TransformedStringTypeKind | undefined;
