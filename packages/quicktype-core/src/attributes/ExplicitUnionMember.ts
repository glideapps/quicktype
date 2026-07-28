import { type TypeAttributes, TypeAttributeKind } from "./TypeAttributes.js";

export type ExplicitUnionMemberGroups = ReadonlyMap<
    symbol,
    ReadonlySet<symbol>
>;

class ExplicitUnionMemberTypeAttributeKind extends TypeAttributeKind<ExplicitUnionMemberGroups> {
    public constructor() {
        super("explicit-union-member");
    }

    public combine(
        values: ExplicitUnionMemberGroups[],
    ): ExplicitUnionMemberGroups {
        const combined = new Map<symbol, Set<symbol>>();
        for (const groups of values) {
            for (const [group, members] of groups) {
                const combinedMembers = combined.get(group) ?? new Set();
                for (const member of members) combinedMembers.add(member);
                combined.set(group, combinedMembers);
            }
        }
        return combined;
    }

    public makeInferred(
        value: ExplicitUnionMemberGroups,
    ): ExplicitUnionMemberGroups {
        return value;
    }

    public stringify(_value: ExplicitUnionMemberGroups): string {
        return "explicit union member";
    }
}

export const explicitUnionMemberTypeAttributeKind: TypeAttributeKind<ExplicitUnionMemberGroups> =
    new ExplicitUnionMemberTypeAttributeKind();

export function makeExplicitUnionMemberAttributes(
    group: symbol,
): TypeAttributes {
    return explicitUnionMemberTypeAttributeKind.makeAttributes(
        new Map([[group, new Set([Symbol()])]]),
    );
}
