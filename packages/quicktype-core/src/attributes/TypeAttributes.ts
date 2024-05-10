import { hashString, mapFilter, mapFilterMap, mapTranspose } from "collection-utils";

import { type BaseGraphRewriteBuilder } from "../GraphRewriting";
import { assert, panic } from "../support/Support";
import { type Type, type TypeKind } from "../Type";

export class TypeAttributeKind<T> {
    public constructor(public readonly name: string) {}

    public appliesToTypeKind(kind: TypeKind): boolean {
        return kind !== "any";
    }

    public combine(_attrs: T[]): T | undefined {
        return panic(`Cannot combine type attribute ${this.name}`);
    }

    public intersect(attrs: T[]): T | undefined {
        return this.combine(attrs);
    }

    public makeInferred(_: T): T | undefined {
        return panic(`Cannot make type attribute ${this.name} inferred`);
    }

    public increaseDistance(attrs: T): T | undefined {
        return attrs;
    }

    public addToSchema(_schema: { [name: string]: unknown }, _t: Type, _attrs: T): void {
        return;
    }

    public children(_: T): ReadonlySet<Type> {
        return new Set();
    }

    public stringify(_: T): string | undefined {
        return undefined;
    }

    public get inIdentity(): boolean {
        return false;
    }

    public requiresUniqueIdentity(_: T): boolean {
        return false;
    }

    public reconstitute<TBuilder extends BaseGraphRewriteBuilder>(_builder: TBuilder, a: T): T {
        return a;
    }

    public makeAttributes(value: T): TypeAttributes {
        const kvps: Array<[this, T]> = [[this, value]];
        return new Map(kvps);
    }

    public tryGetInAttributes(a: TypeAttributes): T | undefined {
        return a.get(this);
    }

    private setInAttributes(a: TypeAttributes, value: T): TypeAttributes {
        // FIXME: This is potentially super slow
        return new Map(a).set(this, value);
    }

    public modifyInAttributes(a: TypeAttributes, modify: (value: T | undefined) => T | undefined): TypeAttributes {
        const modified = modify(this.tryGetInAttributes(a));
        if (modified === undefined) {
            // FIXME: This is potentially super slow
            const result = new Map(a);
            result.delete(this);
            return result;
        }

        return this.setInAttributes(a, modified);
    }

    public setDefaultInAttributes(a: TypeAttributes, makeDefault: () => T): TypeAttributes {
        if (this.tryGetInAttributes(a) !== undefined) return a;
        return this.modifyInAttributes(a, makeDefault);
    }

    public removeInAttributes(a: TypeAttributes): TypeAttributes {
        return mapFilter(a, (_, k) => k !== this);
    }

    public equals(other: TypeAttributeKind<unknown>): boolean {
        if (!(other instanceof TypeAttributeKind)) {
            return false;
        }

        return this.name === other.name;
    }

    public hashCode(): number {
        return hashString(this.name);
    }
}

// FIXME: strongly type this
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TypeAttributes = ReadonlyMap<TypeAttributeKind<any>, any>;

export const emptyTypeAttributes: TypeAttributes = new Map();

export type CombinationKind = "union" | "intersect";

export function combineTypeAttributes(kind: CombinationKind, attributeArray: TypeAttributes[]): TypeAttributes;
export function combineTypeAttributes(kind: CombinationKind, a: TypeAttributes, b: TypeAttributes): TypeAttributes;
export function combineTypeAttributes(
    combinationKind: CombinationKind,
    firstOrArray: TypeAttributes[] | TypeAttributes,
    second?: TypeAttributes
): TypeAttributes {
    const union = combinationKind === "union";
    let attributeArray: TypeAttributes[];
    if (Array.isArray(firstOrArray)) {
        attributeArray = firstOrArray;
    } else {
        if (second === undefined) {
            return panic("Must have on array or two attributes");
        }

        attributeArray = [firstOrArray, second];
    }

    const attributesByKind = mapTranspose(attributeArray);

    // FIXME: strongly type this
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function combine(attrs: any[], kind: TypeAttributeKind<any>): any {
        assert(attrs.length > 0, "Cannot combine zero type attributes");
        if (attrs.length === 1) return attrs[0];
        if (union) {
            return kind.combine(attrs);
        } else {
            return kind.intersect(attrs);
        }
    }

    return mapFilterMap(attributesByKind, combine);
}

export function makeTypeAttributesInferred(attr: TypeAttributes): TypeAttributes {
    return mapFilterMap(attr, (value, kind) => kind.makeInferred(value));
}

export function increaseTypeAttributesDistance(attr: TypeAttributes): TypeAttributes {
    return mapFilterMap(attr, (value, kind) => kind.increaseDistance(value));
}
