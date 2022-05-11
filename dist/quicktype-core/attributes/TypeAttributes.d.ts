import { Type, TypeKind } from "../Type";
import { BaseGraphRewriteBuilder } from "../GraphRewriting";
export declare class TypeAttributeKind<T> {
    readonly name: string;
    constructor(name: string);
    appliesToTypeKind(kind: TypeKind): boolean;
    combine(_attrs: T[]): T | undefined;
    intersect(attrs: T[]): T | undefined;
    makeInferred(_: T): T | undefined;
    increaseDistance(attrs: T): T | undefined;
    addToSchema(_schema: {
        [name: string]: unknown;
    }, _t: Type, _attrs: T): void;
    children(_: T): ReadonlySet<Type>;
    stringify(_: T): string | undefined;
    readonly inIdentity: boolean;
    requiresUniqueIdentity(_: T): boolean;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(_builder: TBuilder, a: T): T;
    makeAttributes(value: T): TypeAttributes;
    tryGetInAttributes(a: TypeAttributes): T | undefined;
    private setInAttributes;
    modifyInAttributes(a: TypeAttributes, modify: (value: T | undefined) => T | undefined): TypeAttributes;
    setDefaultInAttributes(a: TypeAttributes, makeDefault: () => T): TypeAttributes;
    removeInAttributes(a: TypeAttributes): TypeAttributes;
    equals(other: any): boolean;
    hashCode(): number;
}
export declare type TypeAttributes = ReadonlyMap<TypeAttributeKind<any>, any>;
export declare const emptyTypeAttributes: TypeAttributes;
export declare type CombinationKind = "union" | "intersect";
export declare function combineTypeAttributes(kind: CombinationKind, attributeArray: TypeAttributes[]): TypeAttributes;
export declare function combineTypeAttributes(kind: CombinationKind, a: TypeAttributes, b: TypeAttributes): TypeAttributes;
export declare function makeTypeAttributesInferred(attr: TypeAttributes): TypeAttributes;
export declare function increaseTypeAttributesDistance(attr: TypeAttributes): TypeAttributes;
