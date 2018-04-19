"use strict";

import { Set, OrderedSet, Collection } from "immutable";
import * as pluralize from "pluralize";
import { Chance } from "chance";

import { panic, defined, assert, mapOptional } from "./Support";
import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { splitIntoWords } from "./Strings";

let chance: Chance.Chance;
let usedRandomNames: Set<string>;

export function initTypeNames(): void {
    chance = new Chance(31415);
    usedRandomNames = Set();
}

initTypeNames();

function makeRandomName(): string {
    for (;;) {
        const name = `${chance.city()} ${chance.animal()}`;
        if (usedRandomNames.has(name)) continue;
        usedRandomNames = usedRandomNames.add(name);
        return name;
    }
}

export type NameOrNames = string | TypeNames;

// FIXME: In the case of overlapping prefixes and suffixes we will
// produce a name that includes the overlap twice.  For example, for
// the names "aaa" and "aaaa" we have the common prefix "aaa" and the
// common suffix "aaa", so we will produce the combined name "aaaaaa".
function combineNames(names: Collection<any, string>): string {
    let originalFirst = names.first();
    if (originalFirst === undefined) {
        return panic("Named type has no names");
    }
    if (names.count() === 1) {
        return originalFirst;
    }

    const namesSet = names
        .map(s =>
            splitIntoWords(s)
                .map(w => w.word.toLowerCase())
                .join("_")
        )
        .toSet();
    const first = defined(namesSet.first());
    if (namesSet.size === 1) {
        return first;
    }

    let prefixLength = first.length;
    let suffixLength = first.length;
    namesSet.rest().forEach(n => {
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

export const tooManyNamesThreshold = 20;

export abstract class TypeNames {
    static make(
        names: OrderedSet<string>,
        alternativeNames: OrderedSet<string> | undefined,
        areInferred: boolean
    ): TypeNames {
        if (names.size >= tooManyNamesThreshold) {
            return new TooManyTypeNames(areInferred);
        }

        if (alternativeNames === undefined || alternativeNames.size > tooManyNamesThreshold) {
            alternativeNames = undefined;
        }

        return new RegularTypeNames(names, alternativeNames, areInferred);
    }

    abstract get areInferred(): boolean;
    abstract get names(): OrderedSet<string>;
    abstract get combinedName(): string;
    abstract get proposedNames(): OrderedSet<string>;

    abstract add(names: TypeNames): TypeNames;
    abstract clearInferred(): TypeNames;
    abstract makeInferred(): TypeNames;
    abstract singularize(): TypeNames;
    abstract toString(): string;
}

export class RegularTypeNames extends TypeNames {
    constructor(
        readonly names: OrderedSet<string>,
        private readonly _alternativeNames: OrderedSet<string> | undefined,
        readonly areInferred: boolean
    ) {
        super();
    }

    add(names: TypeNames): TypeNames {
        if (!(names instanceof RegularTypeNames)) {
            assert(names instanceof TooManyTypeNames, "Unknown TypeNames instance");
            if (this.areInferred === names.areInferred || !names.areInferred) {
                return names;
            }
            return this;
        }

        let newNames = this.names;
        let newAreInferred = this.areInferred;
        if (this.areInferred && !names.areInferred) {
            newNames = names.names;
            newAreInferred = false;
        } else if (this.areInferred === names.areInferred) {
            newNames = this.names.union(names.names);
        }
        const newAlternativeNames =
            this._alternativeNames === undefined || names._alternativeNames === undefined
                ? undefined
                : this._alternativeNames.union(names._alternativeNames);
        return TypeNames.make(newNames, newAlternativeNames, newAreInferred);
    }

    clearInferred(): TypeNames {
        const newNames = this.areInferred ? OrderedSet() : this.names;
        return TypeNames.make(newNames, OrderedSet(), this.areInferred);
    }

    get combinedName(): string {
        return combineNames(this.names);
    }

    get proposedNames(): OrderedSet<string> {
        const set = OrderedSet([this.combinedName]);
        if (this._alternativeNames === undefined) {
            return set;
        }
        return set.union(this._alternativeNames);
    }

    makeInferred(): TypeNames {
        if (this.areInferred) return this;
        return TypeNames.make(this.names, this._alternativeNames, true);
    }

    singularize(): TypeNames {
        return TypeNames.make(
            this.names.map(pluralize.singular),
            mapOptional(an => an.map(pluralize.singular), this._alternativeNames),
            true
        );
    }

    toString(): string {
        const inferred = this.areInferred ? "inferred" : "given";
        const names = `${inferred} ${this.names.join(",")}`;
        if (this._alternativeNames === undefined) {
            return names;
        }
        return `${names} (${this._alternativeNames.join(",")})`;
    }
}

export class TooManyTypeNames extends TypeNames {
    readonly names: OrderedSet<string>;

    constructor(readonly areInferred: boolean) {
        super();

        this.names = OrderedSet([makeRandomName()]);
    }

    get combinedName(): string {
        return defined(this.names.first());
    }

    get proposedNames(): OrderedSet<string> {
        return this.names;
    }

    add(_names: TypeNames): TypeNames {
        return this;
    }

    clearInferred(): TypeNames {
        if (!this.areInferred) {
            return this;
        }
        return TypeNames.make(OrderedSet(), OrderedSet(), true);
    }

    makeInferred(): TypeNames {
        return this;
    }

    singularize(): TypeNames {
        return this;
    }

    toString(): string {
        return `too many ${this.combinedName}`;
    }
}

export function typeNamesUnion(c: Collection<any, TypeNames>): TypeNames {
    let names = TypeNames.make(OrderedSet(), OrderedSet(), true);
    c.forEach(n => {
        names = names.add(n);
    });
    return names;
}

export const namesTypeAttributeKind = new TypeAttributeKind<TypeNames>(
    "names",
    false,
    (a, b) => a.add(b),
    a => a.makeInferred(),
    a => a.toString()
);

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

export function makeNamesTypeAttributes(nameOrNames: NameOrNames, areNamesInferred?: boolean): TypeAttributes {
    let typeNames: TypeNames;
    if (typeof nameOrNames === "string") {
        typeNames = TypeNames.make(OrderedSet([nameOrNames]), OrderedSet(), defined(areNamesInferred));
    } else {
        typeNames = nameOrNames as TypeNames;
    }
    return namesTypeAttributeKind.makeAttributes(typeNames);
}
