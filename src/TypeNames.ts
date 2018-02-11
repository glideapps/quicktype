"use strict";

import { OrderedSet, Collection } from "immutable";
import * as pluralize from "pluralize";

import { panic, defined } from "./Support";
import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";

export type NameOrNames = string | TypeNames;

// FIXME: In the case of overlapping prefixes and suffixes we will
// produce a name that includes the overlap twice.  For example, for
// the names "aaa" and "aaaa" we have the common prefix "aaa" and the
// common suffix "aaa", so we will produce the combined name "aaaaaa".
function combineNames(names: Collection<any, string>): string {
    const first = names.first();
    if (first === undefined) {
        return panic("Named type has no names");
    }
    if (names.count() === 1) {
        return first;
    }
    let prefixLength = first.length;
    let suffixLength = first.length;
    names.rest().forEach(n => {
        prefixLength = Math.min(prefixLength, n.length);
        for (let i = 0; i < prefixLength; i++) {
            if (first[i] !== n[i]) {
                prefixLength = i;
                break;
            }
        }

        suffixLength = Math.min(suffixLength, n.length);
        for (let i = 0; i < suffixLength; i++) {
            if (first[first.length - i - 1] !== n[n.length - i - 1]) {
                suffixLength = i;
                break;
            }
        }
    });
    const prefix = prefixLength > 2 ? first.substr(0, prefixLength) : "";
    const suffix = suffixLength > 2 ? first.substr(first.length - suffixLength) : "";
    const combined = prefix + suffix;
    if (combined.length > 2) {
        return combined;
    }
    return first;
}

export class TypeNames {
    constructor(
        private readonly names: OrderedSet<string>,
        private readonly _alternativeNames: OrderedSet<string>,
        readonly areInferred: boolean
    ) {}

    add(names: TypeNames): TypeNames {
        let newNames = this.names;
        let newAreInferred = this.areInferred;
        if (this.areInferred && !names.areInferred) {
            newNames = names.names;
            newAreInferred = false;
        } else if (this.areInferred === names.areInferred) {
            newNames = this.names.union(names.names);
        }
        const newAlternativeNames = this._alternativeNames.union(names._alternativeNames);
        return new TypeNames(newNames, newAlternativeNames, newAreInferred);
    }

    clearInferred(): TypeNames {
        const newNames = this.areInferred ? OrderedSet() : this.names;
        return new TypeNames(newNames, OrderedSet(), this.areInferred);
    }

    get combinedName(): string {
        return combineNames(this.names);
    }

    get proposedNames(): OrderedSet<string> {
        return OrderedSet([this.combinedName]).union(this._alternativeNames);
    }

    makeInferred(): TypeNames {
        if (this.areInferred) return this;
        return new TypeNames(this.names, this._alternativeNames, true);
    }

    singularize(): TypeNames {
        return new TypeNames(this.names.map(pluralize.singular), this._alternativeNames.map(pluralize.singular), true);
    }
}

export function typeNamesUnion(c: Collection<any, TypeNames>): TypeNames {
    let names = new TypeNames(OrderedSet(), OrderedSet(), true);
    c.forEach(n => {
        names = names.add(n);
    });
    return names;
}

export const namesTypeAttributeKind = new TypeAttributeKind<TypeNames>("names", (a, b) => a.add(b));

export function modifyTypeNames(
    attributes: TypeAttributes,
    modifier: (tn: TypeNames | undefined) => TypeNames | undefined
): TypeAttributes {
    return namesTypeAttributeKind.modifyInAttributes(attributes, modifier);
}

export function singularizeTypeNames(attributes: TypeAttributes): TypeAttributes {
    return modifyTypeNames(attributes, maybeNames => {
        if (maybeNames === undefined) return undefined;
        return maybeNames.singularize();
    });
}

export function makeTypeNames(nameOrNames: NameOrNames, areNamesInferred?: boolean): TypeAttributes {
    let typeNames: TypeNames;
    if (typeof nameOrNames === "string") {
        typeNames = new TypeNames(OrderedSet([nameOrNames]), OrderedSet(), defined(areNamesInferred));
    } else {
        typeNames = nameOrNames as TypeNames;
    }
    return namesTypeAttributeKind.makeAttributes(typeNames);
}
