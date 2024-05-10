import { definedMap, iterableFirst, iterableSkip, setMap, setUnionInto } from "collection-utils";
import * as pluralize from "pluralize";

import { Chance } from "../support/Chance";
import { splitIntoWords } from "../support/Strings";
import { assert, defined, panic } from "../support/Support";

import { TypeAttributeKind, type TypeAttributes } from "./TypeAttributes";

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

    const prefix = prefixLength > 2 ? first.slice(0, prefixLength) : "";
    const suffix = suffixLength > 2 ? first.slice(first.length - suffixLength) : "";
    const combined = prefix + suffix;
    if (combined.length > 2) {
        return combined;
    }

    return first;
}

export const tooManyNamesThreshold = 1000;

export abstract class TypeNames {
    public static makeWithDistance(
        names: ReadonlySet<string>,
        alternativeNames: ReadonlySet<string> | undefined,
        distance: number
    ): TypeNames {
        if (names.size >= tooManyNamesThreshold) {
            return new TooManyTypeNames(distance);
        }

        if (alternativeNames === undefined || alternativeNames.size > tooManyNamesThreshold) {
            alternativeNames = undefined;
        }

        return new RegularTypeNames(names, alternativeNames, distance);
    }

    public static make(
        names: ReadonlySet<string>,
        alternativeNames: ReadonlySet<string> | undefined,
        areInferred: boolean
    ): TypeNames {
        return TypeNames.makeWithDistance(names, alternativeNames, areInferred ? 1 : 0);
    }

    public constructor(public readonly distance: number) {}

    public get areInferred(): boolean {
        return this.distance > 0;
    }

    public abstract get names(): ReadonlySet<string>;
    public abstract get combinedName(): string;
    public abstract get proposedNames(): ReadonlySet<string>;

    public abstract add(namesArray: TypeNames[], startIndex?: number): TypeNames;
    public abstract clearInferred(): TypeNames;
    public abstract makeInferred(): TypeNames;
    public abstract singularize(): TypeNames;
    public abstract toString(): string;
}

export class RegularTypeNames extends TypeNames {
    public constructor(
        public readonly names: ReadonlySet<string>,
        private readonly _alternativeNames: ReadonlySet<string> | undefined,
        distance: number
    ) {
        super(distance);
    }

    public add(namesArray: TypeNames[], startIndex = 0): TypeNames {
        let newNames = new Set(this.names);
        let newDistance = this.distance;
        let newAlternativeNames = definedMap(this._alternativeNames, s => new Set(s));

        for (let i = startIndex; i < namesArray.length; i++) {
            const other = namesArray[i];

            if (other instanceof RegularTypeNames && other._alternativeNames !== undefined) {
                if (newAlternativeNames === undefined) {
                    newAlternativeNames = new Set();
                }

                setUnionInto(newAlternativeNames, other._alternativeNames);
            }

            if (other.distance > newDistance) continue;

            if (!(other instanceof RegularTypeNames)) {
                assert(other instanceof TooManyTypeNames, "Unknown TypeNames instance");
                // The other one is at most our distance, so let it sort it out
                return other.add(namesArray, i + 1);
            }

            if (other.distance < newDistance) {
                // The other one is closer, so take its names
                newNames = new Set(other.names);
                newDistance = other.distance;
                newAlternativeNames = definedMap(other._alternativeNames, s => new Set(s));
            } else {
                // Same distance, merge them
                assert(other.distance === newDistance, "This should be the only case left");
                setUnionInto(newNames, other.names);
            }
        }

        return TypeNames.makeWithDistance(newNames, newAlternativeNames, newDistance);
    }

    public clearInferred(): TypeNames {
        const newNames = this.areInferred ? new Set<string>() : this.names;
        return TypeNames.makeWithDistance(newNames, new Set(), this.distance);
    }

    public get combinedName(): string {
        return combineNames(this.names);
    }

    public get proposedNames(): ReadonlySet<string> {
        const set = new Set([this.combinedName]);
        if (this._alternativeNames === undefined) {
            return set;
        }

        setUnionInto(set, this._alternativeNames);
        return set;
    }

    public makeInferred(): TypeNames {
        return TypeNames.makeWithDistance(this.names, this._alternativeNames, this.distance + 1);
    }

    public singularize(): TypeNames {
        return TypeNames.makeWithDistance(
            setMap(this.names, pluralize.singular),
            definedMap(this._alternativeNames, an => setMap(an, pluralize.singular)),
            this.distance + 1
        );
    }

    public toString(): string {
        const inferred = this.areInferred ? `distance ${this.distance}` : "given";
        const names = `${inferred} ${Array.from(this.names).join(",")}`;
        if (this._alternativeNames === undefined) {
            return names;
        }

        return `${names} (${Array.from(this._alternativeNames).join(",")})`;
    }
}

export class TooManyTypeNames extends TypeNames {
    public readonly names: ReadonlySet<string>;

    public constructor(distance: number, name?: string) {
        super(distance);

        if (name === undefined) {
            name = makeRandomName();
        }

        this.names = new Set([name]);
    }

    public get combinedName(): string {
        return defined(iterableFirst(this.names));
    }

    public get proposedNames(): ReadonlySet<string> {
        return this.names;
    }

    public add(namesArray: TypeNames[], startIndex = 0): TypeNames {
        if (!this.areInferred) return this;

        for (let i = startIndex; i < namesArray.length; i++) {
            const other = namesArray[i];
            if (other.distance < this.distance) {
                return other.add(namesArray, i + 1);
            }
        }

        return this;
    }

    public clearInferred(): TypeNames {
        if (!this.areInferred) {
            return this;
        }

        return TypeNames.makeWithDistance(new Set(), new Set(), this.distance);
    }

    public makeInferred(): TypeNames {
        return new TooManyTypeNames(this.distance + 1, iterableFirst(this.names));
    }

    public singularize(): TypeNames {
        return this;
    }

    public toString(): string {
        return `too many ${this.combinedName}`;
    }
}

class TypeNamesTypeAttributeKind extends TypeAttributeKind<TypeNames> {
    public constructor() {
        super("names");
    }

    public combine(namesArray: TypeNames[]): TypeNames {
        assert(namesArray.length > 0, "Can't combine zero type names");

        return namesArray[0].add(namesArray, 1);
    }

    public makeInferred(tn: TypeNames): TypeNames {
        return tn.makeInferred();
    }

    public increaseDistance(tn: TypeNames): TypeNames {
        return tn.makeInferred();
    }

    public stringify(tn: TypeNames): string {
        return tn.toString();
    }
}

export const namesTypeAttributeKind: TypeAttributeKind<TypeNames> = new TypeNamesTypeAttributeKind();

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
