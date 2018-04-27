import { is, hash, OrderedMap, OrderedSet } from "immutable";

import { TypeAttributeKind } from "./TypeAttributes";

let unrestrictedStringTypes: StringTypes | undefined = undefined;

export class StringTypes {
    static get unrestricted(): StringTypes {
        if (unrestrictedStringTypes === undefined) {
            unrestrictedStringTypes = new StringTypes(undefined);
        }
        return unrestrictedStringTypes;
    }

    static fromCase(s: string, count: number): StringTypes {
        const caseMap: { [name: string]: number } = {};
        caseMap[s] = count;
        return new StringTypes(OrderedMap([[s, count] as [string, number]]));
    }

    static fromCases(cases: string[]): StringTypes {
        const caseMap: { [name: string]: number } = {};
        for (const s of cases) {
            caseMap[s] = 1;
        }
        return new StringTypes(OrderedMap(cases.map(s => [s, 1] as [string, number])));
    }

    // undefined means no restrictions
    constructor(readonly cases: OrderedMap<string, number> | undefined) {}

    get isRestricted(): boolean {
        return this.cases !== undefined;
    }

    union(other: StringTypes): StringTypes {
        if (this.cases === undefined || other.cases === undefined) {
            return new StringTypes(undefined);
        }
        return new StringTypes(this.cases.mergeWith((x, y) => x + y, other.cases));
    }

    equals(other: any): boolean {
        if (!(other instanceof StringTypes)) return false;
        return is(this.cases, other.cases);
    }

    hashCode(): number {
        return hash(this.cases);
    }

    toString(): string {
        const enumCases = this.cases;
        if (enumCases === undefined) {
            return "no enum";
        }
        const firstKey = enumCases.keySeq().first();
        if (firstKey === undefined) {
            return "enum with no cases";
        }

        return `${enumCases.size.toString()} enums: ${firstKey} (${enumCases.get(firstKey)}), ...`;
    }
}

// FIXME: Why do we have this, just for intersections?  Either use it for unions, too,
// or get rid of it.
export class MutableStringTypes {
    static get unrestricted(): MutableStringTypes {
        return new MutableStringTypes({}, undefined);
    }

    static get none(): MutableStringTypes {
        return new MutableStringTypes({}, []);
    }

    // _enumCases === undefined means no restrictions
    protected constructor(private _enumCaseMap: { [name: string]: number }, private _enumCases: string[] | undefined) {}

    get isRestrictedAndAllowed(): boolean {
        return this._enumCases !== undefined && this._enumCases.length > 0;
    }

    makeUnrestricted(): void {
        this._enumCaseMap = {};
        this._enumCases = undefined;
    }

    addCase(s: string, count: number): void {
        if (!Object.prototype.hasOwnProperty.call(this._enumCaseMap, s)) {
            this._enumCaseMap[s] = 0;
            if (this._enumCases === undefined) {
                this._enumCases = [];
            }
            this._enumCases.push(s);
        }
        this._enumCaseMap[s] += count;
    }

    addCases(cases: string[]): void {
        for (const s of cases) {
            this.addCase(s, 1);
        }
    }

    intersectCasesWithSet(newCases: OrderedSet<string>): void {
        let newEnumCases: string[];
        if (this._enumCases === undefined) {
            newEnumCases = newCases.toArray();
            for (const s of newEnumCases) {
                this._enumCaseMap[s] = 1;
            }
        } else {
            newEnumCases = [];
            for (const s of this._enumCases) {
                if (newCases.has(s)) {
                    newEnumCases.push(s);
                } else {
                    this._enumCaseMap[s] = 0;
                }
            }
        }
        this._enumCases = newEnumCases;
    }

    get enumCases(): OrderedSet<string> | undefined {
        if (this._enumCases === undefined) return undefined;
        return OrderedSet(this._enumCases);
    }

    toImmutable(): StringTypes {
        if (this._enumCases === undefined) {
            return new StringTypes(undefined);
        }
        return new StringTypes(OrderedMap(this._enumCases.map(s => [s, this._enumCaseMap[s]] as [string, number])));
    }
}

export const stringTypesTypeAttributeKind = new TypeAttributeKind<StringTypes>(
    "stringTypes",
    true,
    st => st.isRestricted,
    (a, b) => a.union(b),
    _ => undefined,
    st => st.toString()
);
