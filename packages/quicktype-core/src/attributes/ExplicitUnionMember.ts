import { TypeAttributeKind } from "./TypeAttributes.js";

class ExplicitUnionMemberTypeAttributeKind extends TypeAttributeKind<true> {
    public constructor() {
        super("explicit-union-member");
    }

    public combine(_values: true[]): true {
        return true;
    }

    public makeInferred(_value: true): true {
        return true;
    }

    public stringify(_value: true): string {
        return "explicit union member";
    }
}

export const explicitUnionMemberTypeAttributeKind: TypeAttributeKind<true> =
    new ExplicitUnionMemberTypeAttributeKind();

export const explicitUnionMemberAttributes =
    explicitUnionMemberTypeAttributeKind.makeAttributes(true);
