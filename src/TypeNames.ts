"use strict";

import { OrderedSet, Collection } from "immutable";
import * as pluralize from "pluralize";

import { panic } from "./Support";

export type NameOrNames = string | TypeNames;

export function makeTypeNames(nameOrNames: NameOrNames, areNamesInferred: boolean): TypeNames {
    if (typeof nameOrNames === "string") {
        return new TypeNames(OrderedSet([nameOrNames]), OrderedSet(), areNamesInferred);
    } else {
        return nameOrNames as TypeNames;
    }
}

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
        private _names: OrderedSet<string>,
        private _alternativeNames: OrderedSet<string>,
        private _areInferred: boolean
    ) {}

    copy = (): TypeNames => {
        return new TypeNames(this._names, this._alternativeNames, this._areInferred);
    };

    get names(): OrderedSet<string> {
        return this._names;
    }

    get areInferred(): boolean {
        return this._areInferred;
    }

    add(names: TypeNames): void {
        if (this._areInferred && !names._areInferred) {
            this._names = names._names;
            this._areInferred = false;
        } else if (this._areInferred === names._areInferred) {
            this._names = this._names.union(names._names);
        }
        this._alternativeNames = this._alternativeNames.union(names._alternativeNames);
    }

    union(names: TypeNames): TypeNames {
        const copy = this.copy();
        copy.add(names);
        return copy;
    }

    clearInferred = (): void => {
        if (this._areInferred) {
            this._names = OrderedSet();
        }
        this._alternativeNames = OrderedSet();
    };

    get combinedName(): string {
        return combineNames(this._names);
    }

    get proposedNames(): OrderedSet<string> {
        return OrderedSet([this.combinedName]).union(this._alternativeNames);
    }

    makeInferred = (): TypeNames => {
        if (this._areInferred) return this;
        return new TypeNames(this._names, this._alternativeNames, true);
    };

    singularize = (): TypeNames => {
        return new TypeNames(this._names.map(pluralize.singular), this._alternativeNames.map(pluralize.singular), true);
    };
}

export function typeNamesUnion(c: Collection<any, TypeNames>): TypeNames {
    const names = new TypeNames(OrderedSet(), OrderedSet(), true);
    c.forEach(n => names.add(n));
    return names;
}
