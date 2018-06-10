import {
    mapMap,
    iterableFirst,
    setIntersect,
    hashCodeOf,
    areEqual,
    mapMergeWithInto,
    definedMap,
    addHashCode
} from "collection-utils";

import { TypeAttributeKind } from "./TypeAttributes";
import { defined, assert } from "./support/Support";
import { StringTypeMapping } from "./TypeBuilder";
import { PrimitiveStringTypeKind } from "./Type";

export class StringTypes {
    static readonly unrestricted: StringTypes = new StringTypes(undefined, false, false, false, false);
    static readonly date: StringTypes = new StringTypes(new Map(), true, false, false, false);
    static readonly time: StringTypes = new StringTypes(new Map(), false, true, false, false);
    static readonly dateTime: StringTypes = new StringTypes(new Map(), false, false, true, false);
    static readonly integer: StringTypes = new StringTypes(new Map(), false, false, false, true);

    static fromCase(s: string, count: number): StringTypes {
        const caseMap: { [name: string]: number } = {};
        caseMap[s] = count;
        return new StringTypes(new Map([[s, count] as [string, number]]), false, false, false, false);
    }

    static fromCases(cases: string[]): StringTypes {
        const caseMap: { [name: string]: number } = {};
        for (const s of cases) {
            caseMap[s] = 1;
        }
        return new StringTypes(new Map(cases.map(s => [s, 1] as [string, number])), false, false, false, false);
    }

    // undefined means no restrictions
    constructor(
        readonly cases: ReadonlyMap<string, number> | undefined,
        readonly allowDate: boolean,
        readonly allowTime: boolean,
        readonly allowDateTime: boolean,
        readonly allowInteger: boolean
    ) {
        if (cases === undefined) {
            assert(
                !this.allowDate && !this.allowTime && !this.allowDateTime && !this.allowInteger,
                "We can't have an unrestricted string that also allows date/times or integers"
            );
        }
    }

    get isRestricted(): boolean {
        return this.cases !== undefined;
    }

    union(othersArray: StringTypes[], startIndex: number): StringTypes {
        if (this.cases === undefined) return this;

        let cases = new Map(this.cases);
        let allowDate = this.allowDate;
        let allowTime = this.allowTime;
        let allowDateTime = this.allowDateTime;
        let allowInteger = this.allowInteger;

        for (let i = startIndex; i < othersArray.length; i++) {
            const other = othersArray[i];

            if (other.cases === undefined) return other;
            mapMergeWithInto(cases, (x, y) => x + y, other.cases);

            allowDate = allowDate || other.allowDate;
            allowTime = allowTime || other.allowTime;
            allowDateTime = allowDateTime || other.allowDateTime;
            allowInteger = allowInteger || other.allowInteger;
        }

        return new StringTypes(cases, allowDate, allowTime, allowDateTime, allowInteger);
    }

    intersect(othersArray: StringTypes[], startIndex: number): StringTypes {
        let cases = this.cases;
        let allowDate = this.allowDate;
        let allowTime = this.allowTime;
        let allowDateTime = this.allowDateTime;
        let allowInteger = this.allowInteger;

        for (let i = startIndex; i < othersArray.length; i++) {
            const other = othersArray[i];

            if (cases === undefined) {
                cases = definedMap(other.cases, m => new Map(m));
            } else if (other.cases !== undefined) {
                const thisCases = cases;
                const otherCases = other.cases;
                cases = mapMap(setIntersect(thisCases.keys(), new Set(otherCases.keys())).entries(), k =>
                    Math.min(defined(thisCases.get(k)), defined(otherCases.get(k)))
                );
            }

            allowDate = allowDate && other.allowDate;
            allowTime = allowTime && other.allowTime;
            allowDateTime = allowDateTime && other.allowDateTime;
            allowInteger = allowInteger && other.allowInteger;
        }
        return new StringTypes(cases, allowDate, allowTime, allowDateTime, allowInteger);
    }

    applyStringTypeMapping(mapping: StringTypeMapping): StringTypes {
        if (!this.isRestricted) return this;

        const kinds: PrimitiveStringTypeKind[] = [];
        if (this.allowDate) {
            kinds.push(mapping.date);
        }
        if (this.allowTime) {
            kinds.push(mapping.time);
        }
        if (this.allowDateTime) {
            kinds.push(mapping.dateTime);
        }
        if (kinds.indexOf("string") >= 0) {
            return StringTypes.unrestricted;
        }
        const allowDate = kinds.indexOf("date") >= 0;
        const allowTime = kinds.indexOf("time") >= 0;
        const allowDateTime = kinds.indexOf("date-time") >= 0;
        return new StringTypes(this.cases, allowDate, allowTime, allowDateTime, this.allowInteger);
    }

    equals(other: any): boolean {
        if (!(other instanceof StringTypes)) return false;
        return (
            areEqual(this.cases, other.cases) &&
            this.allowDate === other.allowDate &&
            this.allowTime === other.allowTime &&
            this.allowDateTime === other.allowDateTime &&
            this.allowInteger === other.allowInteger
        );
    }

    hashCode(): number {
        let h = hashCodeOf(this.cases);
        h = addHashCode(h, hashCodeOf(this.allowDate));
        h = addHashCode(h, hashCodeOf(this.allowTime));
        h = addHashCode(h, hashCodeOf(this.allowDateTime));
        h = addHashCode(h, hashCodeOf(this.allowInteger));
        return h;
    }

    toString(): string {
        const parts: string[] = [];

        const enumCases = this.cases;
        if (enumCases === undefined) {
            parts.push("unrestricted");
        } else {
            const firstKey = iterableFirst(enumCases.keys());
            if (firstKey === undefined) {
                parts.push("enum with no cases");
            } else {
                parts.push(`${enumCases.size.toString()} enums: ${firstKey} (${enumCases.get(firstKey)}), ...`);
            }
        }

        if (this.allowDate) parts.push("d");
        if (this.allowTime) parts.push("t");
        if (this.allowDateTime) parts.push("dt");
        if (this.allowInteger) parts.push("i");

        return parts.join(",");
    }
}

class StringTypesTypeAttributeKind extends TypeAttributeKind<StringTypes> {
    constructor() {
        super("stringTypes");
    }

    get inIdentity(): boolean {
        return true;
    }

    requiresUniqueIdentity(st: StringTypes): boolean {
        return st.cases !== undefined && st.cases.size > 0;
    }

    combine(arr: StringTypes[]): StringTypes {
        assert(arr.length > 0);
        return arr[0].union(arr, 1);
    }

    intersect(arr: StringTypes[]): StringTypes {
        assert(arr.length > 0);
        return arr[0].intersect(arr, 1);
    }

    makeInferred(_: StringTypes): undefined {
        return undefined;
    }

    stringify(st: StringTypes): string {
        return st.toString();
    }
}

export const stringTypesTypeAttributeKind: TypeAttributeKind<StringTypes> = new StringTypesTypeAttributeKind();
