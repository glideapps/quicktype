import { is, hash, OrderedMap } from "immutable";

import { TypeAttributeKind } from "./TypeAttributes";
import { addHashCode, defined, assert } from "./Support";
import { StringTypeMapping } from "./TypeBuilder";
import { PrimitiveStringTypeKind } from "./Type";

export class StringTypes {
    static readonly unrestricted: StringTypes = new StringTypes(undefined, false, false, false);
    static readonly date: StringTypes = new StringTypes(OrderedMap(), true, false, false);
    static readonly time: StringTypes = new StringTypes(OrderedMap(), false, true, false);
    static readonly dateTime: StringTypes = new StringTypes(OrderedMap(), false, false, true);

    static fromCase(s: string, count: number): StringTypes {
        const caseMap: { [name: string]: number } = {};
        caseMap[s] = count;
        return new StringTypes(OrderedMap([[s, count] as [string, number]]), false, false, false);
    }

    static fromCases(cases: string[]): StringTypes {
        const caseMap: { [name: string]: number } = {};
        for (const s of cases) {
            caseMap[s] = 1;
        }
        return new StringTypes(OrderedMap(cases.map(s => [s, 1] as [string, number])), false, false, false);
    }

    // undefined means no restrictions
    constructor(
        readonly cases: OrderedMap<string, number> | undefined,
        readonly allowDate: boolean,
        readonly allowTime: boolean,
        readonly allowDateTime: boolean
    ) {
        if (cases === undefined) {
            assert(
                !this.allowDate && !this.allowTime && !this.allowDateTime,
                "We can't have an unrestricted string that also allows date/times"
            );
        }
    }

    get isRestricted(): boolean {
        return this.cases !== undefined;
    }

    union(other: StringTypes): StringTypes {
        const cases =
            this.cases === undefined || other.cases === undefined
                ? undefined
                : this.cases.mergeWith((x, y) => x + y, other.cases);
        const allowDate = cases !== undefined && (this.allowDate || other.allowDate);
        const allowTime = cases !== undefined && (this.allowTime || other.allowTime);
        const allowDateTime = cases !== undefined && (this.allowDateTime || other.allowDateTime);
        return new StringTypes(cases, allowDate, allowTime, allowDateTime);
    }

    intersect(other: StringTypes): StringTypes {
        const thisCases = this.cases;
        const otherCases = other.cases;
        let cases: OrderedMap<string, number> | undefined;
        if (thisCases === undefined) {
            cases = otherCases;
        } else if (otherCases === undefined) {
            cases = thisCases;
        } else {
            cases = thisCases
                .keySeq()
                .toOrderedSet()
                .intersect(otherCases.keySeq().toOrderedSet())
                .toOrderedMap()
                .map(k => Math.min(defined(thisCases.get(k)), defined(otherCases.get(k))));
        }
        const allowDate = this.allowDate && other.allowDate;
        const allowTime = this.allowTime && other.allowTime;
        const allowDateTime = this.allowDateTime && other.allowDateTime;
        return new StringTypes(cases, allowDate, allowTime, allowDateTime);
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
        return new StringTypes(this.cases, allowDate, allowTime, allowDateTime);
    }

    equals(other: any): boolean {
        if (!(other instanceof StringTypes)) return false;
        return (
            is(this.cases, other.cases) &&
            this.allowDate === other.allowDate &&
            this.allowTime === other.allowTime &&
            this.allowDateTime === other.allowDateTime
        );
    }

    hashCode(): number {
        let h = hash(this.cases);
        h = addHashCode(h, hash(this.allowDate));
        h = addHashCode(h, hash(this.allowTime));
        h = addHashCode(h, hash(this.allowDateTime));
        return h;
    }

    toString(): string {
        const parts: string[] = [];

        const enumCases = this.cases;
        if (enumCases === undefined) {
            parts.push("unrestricted");
        } else {
            const firstKey = enumCases.keySeq().first();
            if (firstKey === undefined) {
                parts.push("enum with no cases");
            } else {
                parts.push(`${enumCases.size.toString()} enums: ${firstKey} (${enumCases.get(firstKey)}), ...`);
            }
        }

        if (this.allowDate) parts.push("d");
        if (this.allowTime) parts.push("t");
        if (this.allowDateTime) parts.push("dt");

        return parts.join(",");
    }
}

export const stringTypesTypeAttributeKind = new TypeAttributeKind<StringTypes>(
    "stringTypes",
    true,
    st => st.cases !== undefined && !st.cases.isEmpty(),
    (a, b) => a.union(b),
    (a, b) => a.intersect(b),
    _ => undefined,
    st => st.toString()
);
