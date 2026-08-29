import { setIntersect, setUnion } from "collection-utils";

import type { Type, TypeKind } from "../Type/index.js";

import { TypeAttributeKind } from "./TypeAttributes.js";

/**
 * The keys a JSON Schema `propertyNames` constraint allows, when it restricts
 * them to a finite set of strings. Kept as plain data rather than a graph type
 * so unrelated renderers never see a key enum they can't use.
 */
class PropertyNamesTypeAttributeKind extends TypeAttributeKind<
    ReadonlySet<string>
> {
    public constructor() {
        super("propertyNames");
    }

    public appliesToTypeKind(kind: TypeKind): boolean {
        return kind === "object" || kind === "class" || kind === "map";
    }

    // A union of objects allows the union of their keys.
    public combine(attrs: Array<ReadonlySet<string>>): ReadonlySet<string> {
        return setUnion(...attrs);
    }

    // Only keys every side allows survive; empty means a contradiction we
    // don't try to express.
    public intersect(
        attrs: Array<ReadonlySet<string>>,
    ): ReadonlySet<string> | undefined {
        const cases = attrs.reduce(setIntersect);
        return cases.size === 0 ? undefined : cases;
    }

    // A schema-stated fact, not a weakening guess, so it stays as-is.
    public makeInferred(cases: ReadonlySet<string>): ReadonlySet<string> {
        return cases;
    }

    public stringify(cases: ReadonlySet<string>): string {
        return `propertyNames: ${Array.from(cases).join(", ")}`;
    }
}

export const propertyNamesTypeAttributeKind: TypeAttributeKind<
    ReadonlySet<string>
> = new PropertyNamesTypeAttributeKind();

/** The keys `t` restricts its properties to, if it restricts them. */
export function propertyNamesForType(t: Type): ReadonlySet<string> | undefined {
    return propertyNamesTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
