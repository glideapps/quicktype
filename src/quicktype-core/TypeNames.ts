import * as pluralize from "pluralize";
import { setMap, iterableFirst, iterableSkip, setUnionInto, definedMap } from "collection-utils";

import { panic, defined, assert } from "./support/Support";
import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { splitIntoWords } from "./support/Strings";
import { Chance } from "./support/Chance";

let chance: Chance;
let usedRandomNames: Set<string>;

export function initTypeNames(): void {
    chance = new Chance(31415);
    usedRandomNames = new Set();
}

initTypeNames();

function makeRandomName(): string {
    for (;;) {
        const name = `${chance.city()} ${chance.animal()}`;
        if (usedRandomNames.has(name)) continue;
        usedRandomNames.add(name);
        return name;
    }
}

export type NameOrNames = string | TypeNames;

// FIXME: In the case of overlapping prefixes and suffixes we will
// produce a name that includes the overlap twice.  For example, for
// the names "aaa" and "aaaa" we have the common prefix "aaa" and the
// common suffix "aaa", so we will produce the combined name "aaaaaa".
function combineNames(names: ReadonlySet<string>): string {
    let originalFirst = iterableFirst(names);
    if (originalFirst === undefined) {
        return panic("Named type has no names");
    }
    if (names.size === 1) {
        return originalFirst;
    }

    const namesSet = setMap(names, s =>
        splitIntoWords(s)
            .map(w => w.word.toLowerCase())
            .join("_")
    );
    const first = defined(iterableFirst(namesSet));
    if (namesSet.size === 1) {
        return first;
    }

    let prefixLength = first.length;
    let suffixLength = first.length;
    for (const n of iterableSkip(namesSet, 1)) {
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
    }
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
        names: ReadonlySet<string>,
        alternativeNames: ReadonlySet<string> | undefined,
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
    abstract get names(): ReadonlySet<string>;
    abstract get combinedName(): string;
    abstract get proposedNames(): ReadonlySet<string>;

    abstract add(namesArray: TypeNames[], startIndex?: number): TypeNames;
    abstract clearInferred(): TypeNames;
    abstract makeInferred(): TypeNames;
    abstract singularize(): TypeNames;
    abstract toString(): string;
}

export class RegularTypeNames extends TypeNames {
    constructor(
        readonly names: ReadonlySet<string>,
        private readonly _alternativeNames: ReadonlySet<string> | undefined,
        readonly areInferred: boolean
    ) {
        super();
    }

    add(namesArray: TypeNames[], startIndex: number = 0): TypeNames {
        let newNames = new Set(this.names);
        let newAreInferred = this.areInferred;
        let newAlternativeNames = definedMap(this._alternativeNames, s => new Set(s));

        for (let i = startIndex; i < namesArray.length; i++) {
            const other = namesArray[i];
            if (!(other instanceof RegularTypeNames)) {
                assert(other instanceof TooManyTypeNames, "Unknown TypeNames instance");
                if (!other.areInferred) {
                    // The other one is given, so it's the final word
                    return other;
                }
                if (newAreInferred === other.areInferred) {
                    // Both are inferred, so we let the TooMany sort it out
                    return other.add(namesArray, i + 1);
                }
                // Ours is given, the other inferred, so ignore it
                continue;
            }

            if (newAreInferred && !other.areInferred) {
                // Ours is inferred, the other one given, so take the
                // other's names
                newNames = new Set(other.names);
                newAreInferred = false;
            } else if (this.areInferred === other.areInferred) {
                setUnionInto(newNames, other.names);
            }

            if (other._alternativeNames !== undefined) {
                if (newAlternativeNames === undefined) {
                    newAlternativeNames = new Set();
                }
                setUnionInto(newAlternativeNames, other._alternativeNames);
            }
        }
        return TypeNames.make(newNames, newAlternativeNames, newAreInferred);
    }

    clearInferred(): TypeNames {
        const newNames = this.areInferred ? new Set() : this.names;
        return TypeNames.make(newNames, new Set(), this.areInferred);
    }

    get combinedName(): string {
        return combineNames(this.names);
    }

    get proposedNames(): ReadonlySet<string> {
        const set = new Set([this.combinedName]);
        if (this._alternativeNames === undefined) {
            return set;
        }
        setUnionInto(set, this._alternativeNames);
        return set;
    }

    makeInferred(): TypeNames {
        if (this.areInferred) return this;
        return TypeNames.make(this.names, this._alternativeNames, true);
    }

    singularize(): TypeNames {
        return TypeNames.make(
            setMap(this.names, pluralize.singular),
            definedMap(this._alternativeNames, an => setMap(an, pluralize.singular)),
            true
        );
    }

    toString(): string {
        const inferred = this.areInferred ? "inferred" : "given";
        const names = `${inferred} ${Array.from(this.names).join(",")}`;
        if (this._alternativeNames === undefined) {
            return names;
        }
        return `${names} (${Array.from(this._alternativeNames).join(",")})`;
    }
}

export class TooManyTypeNames extends TypeNames {
    readonly names: ReadonlySet<string>;

    constructor(readonly areInferred: boolean) {
        super();

        this.names = new Set([makeRandomName()]);
    }

    get combinedName(): string {
        return defined(iterableFirst(this.names));
    }

    get proposedNames(): ReadonlySet<string> {
        return this.names;
    }

    add(namesArray: TypeNames[], startIndex: number = 0): TypeNames {
        if (!this.areInferred) return this;

        for (let i = startIndex; i < namesArray.length; i++) {
            const other = namesArray[i];
            if (!other.areInferred) {
                return other.add(namesArray, i + 1);
            }
        }

        return this;
    }

    clearInferred(): TypeNames {
        if (!this.areInferred) {
            return this;
        }
        return TypeNames.make(new Set(), new Set(), true);
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

class DescriptionTypeAttributeKind extends TypeAttributeKind<TypeNames> {
    constructor() {
        super("names");
    }

    combine(namesArray: TypeNames[]): TypeNames {
        assert(namesArray.length > 0, "Can't combine zero type names");

        return namesArray[0].add(namesArray, 1);
    }

    makeInferred(tn: TypeNames): TypeNames {
        return tn.makeInferred();
    }

    stringify(tn: TypeNames): string {
        return tn.toString();
    }
}

export const namesTypeAttributeKind: TypeAttributeKind<TypeNames> = new DescriptionTypeAttributeKind();

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
        typeNames = TypeNames.make(new Set([nameOrNames]), new Set(), defined(areNamesInferred));
    } else {
        typeNames = nameOrNames as TypeNames;
    }
    return namesTypeAttributeKind.makeAttributes(typeNames);
}
