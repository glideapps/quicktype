import { TypeAttributeKind, type TypeAttributes } from "./TypeAttributes.js";

class UnionMemberDistinctTypeAttributeKind extends TypeAttributeKind<boolean> {
    public constructor() {
        super("unionMemberDistinct");
    }

    public combine(values: boolean[]): boolean {
        return values.some(Boolean);
    }

    public intersect(values: boolean[]): boolean {
        return values.some(Boolean);
    }

    public makeInferred(value: boolean): boolean {
        return value;
    }
}

class UnionIsExclusiveTypeAttributeKind extends TypeAttributeKind<boolean> {
    public constructor() {
        super("unionIsExclusive");
    }

    public combine(values: boolean[]): boolean {
        return values.some(Boolean);
    }

    public intersect(values: boolean[]): boolean {
        return values.some(Boolean);
    }

    public makeInferred(value: boolean): boolean {
        return value;
    }
}

export const unionMemberDistinctTypeAttributeKind =
    new UnionMemberDistinctTypeAttributeKind();
const unionIsExclusiveTypeAttributeKind =
    new UnionIsExclusiveTypeAttributeKind();

export const unionMemberDistinctAttributes: TypeAttributes =
    unionMemberDistinctTypeAttributeKind.makeAttributes(true);
export const unionIsExclusiveAttributes: TypeAttributes =
    unionIsExclusiveTypeAttributeKind.makeAttributes(true);

export function isUnionMemberDistinct(attributes: TypeAttributes): boolean {
    return (
        unionMemberDistinctTypeAttributeKind.tryGetInAttributes(attributes) ===
        true
    );
}

export function isUnionExclusive(attributes: TypeAttributes): boolean {
    return (
        unionIsExclusiveTypeAttributeKind.tryGetInAttributes(attributes) ===
        true
    );
}
