import { Map, OrderedSet, hash } from "immutable";

import { panic, setUnion } from "./support/Support";
import { Type } from "./Type";
import { BaseGraphRewriteBuilder } from "./GraphRewriting";

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
        return Map(kvps);
    }

    tryGetInAttributes(a: TypeAttributes): T | undefined {
        return a.get(this);
    }

    private setInAttributes(a: TypeAttributes, value: T): TypeAttributes {
        return a.set(this, value);
    }

    modifyInAttributes(a: TypeAttributes, modify: (value: T | undefined) => T | undefined): TypeAttributes {
        const modified = modify(this.tryGetInAttributes(a));
        if (modified === undefined) {
            return a.remove(this);
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
        return a.filterNot((_, k) => k === this);
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

export type TypeAttributes = Map<TypeAttributeKind<any>, any>;

export const emptyTypeAttributes: TypeAttributes = Map();

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
    let first: TypeAttributes;
    let rest: TypeAttributes[];
    if (Array.isArray(firstOrArray)) {
        attributeArray = firstOrArray;
        if (attributeArray.length === 0) return Map();
        first = attributeArray[0];
        rest = attributeArray.slice(1);
    } else {
        if (second === undefined) {
            return panic("Must have on array or two attributes");
        }
        first = firstOrArray;
        rest = [second];
    }

    for (const r of rest) {
        first = first.mergeWith((aa, ab, kind) => (union ? kind.combine(aa, ab) : kind.intersect(aa, ab)), r);
    }
    return first;
}

export function makeTypeAttributesInferred(attr: TypeAttributes): TypeAttributes {
    return attr.map((value, kind) => kind.makeInferred(value)).filter(v => v !== undefined);
}

class DescriptionTypeAttributeKind extends TypeAttributeKind<OrderedSet<string>> {
    constructor() {
        super("description");
    }

    combine(a: OrderedSet<string>, b: OrderedSet<string>): OrderedSet<string> {
        return a.union(b);
    }

    makeInferred(_: OrderedSet<string>): OrderedSet<string> {
        return OrderedSet();
    }

    stringify(descriptions: OrderedSet<string>): string | undefined {
        let result = descriptions.first();
        if (result === undefined) return undefined;
        if (result.length > 5 + 3) {
            result = `${result.substr(0, 5)}...`;
        }
        if (descriptions.size > 1) {
            result = `${result}, ...`;
        }
        return result;
    }
}

export const descriptionTypeAttributeKind: TypeAttributeKind<OrderedSet<string>> = new DescriptionTypeAttributeKind();

class PropertyDescriptionsTypeAttributeKind extends TypeAttributeKind<Map<string, OrderedSet<string>>> {
    constructor() {
        super("propertyDescriptions");
    }

    combine(a: Map<string, OrderedSet<string>>, b: Map<string, OrderedSet<string>>): Map<string, OrderedSet<string>> {
        return a.mergeWith(setUnion, b);
    }

    makeInferred(_: Map<string, OrderedSet<string>>): Map<string, OrderedSet<string>> {
        return Map();
    }
}

export const propertyDescriptionsTypeAttributeKind: TypeAttributeKind<
    Map<string, OrderedSet<string>>
> = new PropertyDescriptionsTypeAttributeKind();
