import * as pluralize from "pluralize";

import { panic, defined, assert, mapOptional } from "./support/Support";
import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { splitIntoWords } from "./support/Strings";
import { Chance } from "./support/Chance";
import { setUnion, setMap, iterableFirst, iterableSkip, setUnionInto } from "./support/Containers";

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

    abstract add(names: TypeNames): TypeNames;
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
            newNames = setUnion(this.names, names.names);
        }
        const newAlternativeNames =
            this._alternativeNames === undefined || names._alternativeNames === undefined
                ? undefined
                : setUnion(this._alternativeNames, names._alternativeNames);
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
            mapOptional(an => setMap(an, pluralize.singular), this._alternativeNames),
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

    add(names: TypeNames): TypeNames {
        if (names instanceof TooManyTypeNames) {
        return this;
    }
        return names.add(this);
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

    combine(a: TypeNames, b: TypeNames): TypeNames {
        return a.add(b);
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
