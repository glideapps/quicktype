import { OrderedSet, hash } from "immutable";

import { panic } from "./support/Support";
import { Type } from "./Type";
import { BaseGraphRewriteBuilder } from "./GraphRewriting";
import { mapFilterMap, mapFilter, mapMergeWithInto } from "./support/Containers";

export class TypeAttributeKind<T> {
    constructor(readonly name: string) {}

    combine(_a: T, _b: T): T {
        return panic(`Cannot combine type attribute ${this.name}`);
    }

    intersect(a: T, b: T): T {
        return this.combine(a, b);
    }

    makeInferred(_: T): T | undefined {
        return panic(`Cannot make type attribute ${this.name} inferred`);
    }

    children(_: T): OrderedSet<Type> {
        return OrderedSet();
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

    combineInAttributes(a: TypeAttributes, value: T): TypeAttributes {
        return this.modifyInAttributes(a, v => (v === undefined ? value : this.combine(v, value)));
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
        return hash(this.name);
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
    let first: Map<TypeAttributeKind<any>, any>;
    let rest: TypeAttributes[];
    if (Array.isArray(firstOrArray)) {
        attributeArray = firstOrArray;
        if (attributeArray.length === 0) return emptyTypeAttributes;
        first = new Map(attributeArray[0]);
        rest = attributeArray.slice(1);
    } else {
        if (second === undefined) {
            return panic("Must have on array or two attributes");
        }
        first = new Map(firstOrArray);
        rest = [second];
    }

    for (const r of rest) {
        mapMergeWithInto(first, (aa, ab, kind) => (union ? kind.combine(aa, ab) : kind.intersect(aa, ab)), r);
    }
    return first;
}

export function makeTypeAttributesInferred(attr: TypeAttributes): TypeAttributes {
    return mapFilterMap(attr, (value, kind) => kind.makeInferred(value));
}
