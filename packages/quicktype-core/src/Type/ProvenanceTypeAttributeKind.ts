import { setUnionManyInto } from "collection-utils";

import { TypeAttributeKind } from "../attributes/TypeAttributes";

import { type TypeKind } from "./TransformedStringType";

// FIXME: Don't infer provenance.  All original types should be present in
// non-inferred form in the final graph.
class ProvenanceTypeAttributeKind extends TypeAttributeKind<Set<number>> {
    public constructor() {
        super("provenance");
    }

    public appliesToTypeKind(_kind: TypeKind): boolean {
        return true;
    }

    public combine(arr: Array<Set<number>>): Set<number> {
        return setUnionManyInto(new Set(), arr);
    }

    public makeInferred(p: Set<number>): Set<number> {
        return p;
    }

    public stringify(p: Set<number>): string {
        return Array.from(p)
            .sort()
            .map((i) => i.toString())
            .join(",");
    }
}

export const provenanceTypeAttributeKind: TypeAttributeKind<Set<number>> =
    new ProvenanceTypeAttributeKind();
