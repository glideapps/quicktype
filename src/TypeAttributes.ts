"use strict";

import { Map, OrderedSet, hash } from "immutable";

import { panic, setUnion } from "./Support";

export class TypeAttributeKind<T> {
    public readonly combine: (a: T, b: T) => T;
    public readonly makeInferred: (a: T) => T | undefined;
    public readonly stringify: (a: T) => string | undefined;

    constructor(
        readonly name: string,
        readonly inIdentity: boolean,
        combine: ((a: T, b: T) => T) | undefined,
        makeInferred: ((a: T) => T | undefined) | undefined,
        stringify: ((a: T) => string | undefined) | undefined
    ) {
        if (combine === undefined) {
            combine = () => {
                return panic(`Cannot combine type attribute ${name}`);
            };
        }
        this.combine = combine;

        if (makeInferred === undefined) {
            makeInferred = () => {
                return panic(`Cannot make type attribute ${name} inferred`);
            };
        }
        this.makeInferred = makeInferred;

        if (stringify === undefined) {
            stringify = () => undefined;
        }
        this.stringify = stringify;
    }

    makeAttributes(value: T): TypeAttributes {
        const kvps: [this, T][] = [[this, value]];
        return Map(kvps);
    }

    tryGetInAttributes(a: TypeAttributes): T | undefined {
        return a.get(this);
    }

    setInAttributes(a: TypeAttributes, value: T): TypeAttributes {
        return a.set(this, value);
    }

    modifyInAttributes(a: TypeAttributes, modify: (value: T | undefined) => T | undefined): TypeAttributes {
        const modified = modify(this.tryGetInAttributes(a));
        if (modified === undefined) {
            return a.remove(this);
        }
        return this.setInAttributes(a, modified);
    }

    setDefaultInAttributes(a: TypeAttributes, makeDefault: () => T): TypeAttributes {
        if (this.tryGetInAttributes(a) !== undefined) return a;
        return this.modifyInAttributes(a, makeDefault);
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

export function combineTypeAttributes(attributeArray: TypeAttributes[]): TypeAttributes;
export function combineTypeAttributes(a: TypeAttributes, b: TypeAttributes): TypeAttributes;
export function combineTypeAttributes(
    firstOrArray: TypeAttributes[] | TypeAttributes,
    second?: TypeAttributes
): TypeAttributes {
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
    return first.mergeWith((aa, ab, kind) => kind.combine(aa, ab), ...rest);
}

export function makeTypeAttributesInferred(attr: TypeAttributes): TypeAttributes {
    return attr.map((value, kind) => kind.makeInferred(value)).filter(v => v !== undefined);
}

export const descriptionTypeAttributeKind = new TypeAttributeKind<OrderedSet<string>>(
    "description",
    false,
    setUnion,
    _ => OrderedSet(),
    descriptions => {
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
);
export const propertyDescriptionsTypeAttributeKind = new TypeAttributeKind<Map<string, OrderedSet<string>>>(
    "propertyDescriptions",
    false,
    (a, b) => a.mergeWith(setUnion, b),
    _ => Map(),
    undefined
);
