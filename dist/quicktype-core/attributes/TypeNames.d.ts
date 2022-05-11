import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
export declare function initTypeNames(): void;
export declare type NameOrNames = string | TypeNames;
export declare const tooManyNamesThreshold = 1000;
export declare abstract class TypeNames {
    readonly distance: number;
    static makeWithDistance(names: ReadonlySet<string>, alternativeNames: ReadonlySet<string> | undefined, distance: number): TypeNames;
    static make(names: ReadonlySet<string>, alternativeNames: ReadonlySet<string> | undefined, areInferred: boolean): TypeNames;
    constructor(distance: number);
    readonly areInferred: boolean;
    abstract readonly names: ReadonlySet<string>;
    abstract readonly combinedName: string;
    abstract readonly proposedNames: ReadonlySet<string>;
    abstract add(namesArray: TypeNames[], startIndex?: number): TypeNames;
    abstract clearInferred(): TypeNames;
    abstract makeInferred(): TypeNames;
    abstract singularize(): TypeNames;
    abstract toString(): string;
}
export declare class RegularTypeNames extends TypeNames {
    readonly names: ReadonlySet<string>;
    private readonly _alternativeNames;
    constructor(names: ReadonlySet<string>, _alternativeNames: ReadonlySet<string> | undefined, distance: number);
    add(namesArray: TypeNames[], startIndex?: number): TypeNames;
    clearInferred(): TypeNames;
    readonly combinedName: string;
    readonly proposedNames: ReadonlySet<string>;
    makeInferred(): TypeNames;
    singularize(): TypeNames;
    toString(): string;
}
export declare class TooManyTypeNames extends TypeNames {
    readonly names: ReadonlySet<string>;
    constructor(distance: number, name?: string);
    readonly combinedName: string;
    readonly proposedNames: ReadonlySet<string>;
    add(namesArray: TypeNames[], startIndex?: number): TypeNames;
    clearInferred(): TypeNames;
    makeInferred(): TypeNames;
    singularize(): TypeNames;
    toString(): string;
}
export declare const namesTypeAttributeKind: TypeAttributeKind<TypeNames>;
export declare function modifyTypeNames(attributes: TypeAttributes, modifier: (tn: TypeNames | undefined) => TypeNames | undefined): TypeAttributes;
export declare function singularizeTypeNames(attributes: TypeAttributes): TypeAttributes;
export declare function makeNamesTypeAttributes(nameOrNames: NameOrNames, areNamesInferred?: boolean): TypeAttributes;
