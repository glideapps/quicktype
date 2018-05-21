import stringHash = require("string-hash");

import { panic, assert } from "./support/Support";
import { Type } from "./Type";
import { BaseGraphRewriteBuilder } from "./GraphRewriting";
import { mapFilterMap, mapFilter, mapTranspose, mapMap } from "./support/Containers";

export class TypeAttributeKind<T> {
    constructor(readonly name: string) {}

    combine(_attrs: T[]): T {
        return panic(`Cannot combine type attribute ${this.name}`);
    }

    intersect(attrs: T[]): T {
        return this.combine(attrs);
    }

    makeInferred(_: T): T | undefined {
        return panic(`Cannot make type attribute ${this.name} inferred`);
    }

    children(_: T): ReadonlySet<Type> {
        return new Set();
    }

    stringify(_: T): string | undefined {
        return undefined;
    }

    get inIdentity(): boolean {
        return false;
    }

    requiresUniqueIdentity(_: T): boolean {
        return false;
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(_builder: TBuilder, a: T): T {
        return a;
    }

    makeAttributes(value: T): TypeAttributes {
        const kvps: [this, T][] = [[this, value]];
        return new Map(kvps);
    }

    tryGetInAttributes(a: TypeAttributes): T | undefined {
        return a.get(this);
    }

    private setInAttributes(a: TypeAttributes, value: T): TypeAttributes {
        // FIXME: This is potentially super slow
        return new Map(a).set(this, value);
    }

    modifyInAttributes(a: TypeAttributes, modify: (value: T | undefined) => T | undefined): TypeAttributes {
        const modified = modify(this.tryGetInAttributes(a));
        if (modified === undefined) {
            // FIXME: This is potentially super slow
            const result = new Map(a);
            result.delete(this);
            return result;
        }
        return this.setInAttributes(a, modified);
    }

    setDefaultInAttributes(a: TypeAttributes, makeDefault: () => T): TypeAttributes {
        if (this.tryGetInAttributes(a) !== undefined) return a;
        return this.modifyInAttributes(a, makeDefault);
    }

    removeInAttributes(a: TypeAttributes): TypeAttributes {
        return mapFilter(a, (_, k) => k !== this);
    }

    equals(other: any): boolean {
        if (!(other instanceof TypeAttributeKind)) {
            return false;
        }
        return this.name === other.name;
    }

    hashCode(): number {
        return stringHash(this.name);
    }
}

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

    function combine(attrs: any[], kind: TypeAttributeKind<any>): any {
        assert(attrs.length > 0, "Cannot combine zero type attributes");
        if (attrs.length === 1) return attrs[0];
        if (union) {
            return kind.combine(attrs);
        } else {
            return kind.intersect(attrs);
        }
    }

    return mapMap(attributesByKind, combine);
}

export function makeTypeAttributesInferred(attr: TypeAttributes): TypeAttributes {
    return mapFilterMap(attr, (value, kind) => kind.makeInferred(value));
}
