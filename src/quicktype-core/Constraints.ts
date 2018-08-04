import { Type } from "./Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { assert } from "./support/Support";
import { messageError } from "./Messages";
import { JSONSchemaType, JSONSchemaAttributes, Ref } from "./input/JSONSchemaInput";
import { JSONSchema } from "./input/JSONSchemaStore";

// This can't be an object type, unfortunately, because it's in the
// type's identity and as such must be comparable and hashable with
// `areEqual`, `hashCodeOf`.
export type MinMaxConstraint = [number | undefined, number | undefined];

function checkMinMaxConstraint(minmax: MinMaxConstraint): MinMaxConstraint {
    const [min, max] = minmax;
    if (typeof min === "number" && typeof max === "number" && min > max) {
        return messageError("MiscInvalidMinMaxConstraint", { min, max });
    }
    return minmax;
}

export class MinMaxConstraintTypeAttributeKind extends TypeAttributeKind<MinMaxConstraint> {
    get inIdentity(): boolean {
        return true;
    }

    combine(arr: MinMaxConstraint[]): MinMaxConstraint {
        assert(arr.length > 0);

        let [min, max] = arr[0];
        for (let i = 1; i < arr.length; i++) {
            const [otherMin, otherMax] = arr[i];
            if (typeof min === "number" && typeof otherMin === "number") {
                min = Math.min(min, otherMin);
            } else {
                min = undefined;
            }
            if (typeof max === "number" && typeof otherMax === "number") {
                max = Math.max(max, otherMax);
            } else {
                max = undefined;
            }
        }
        return checkMinMaxConstraint([min, max]);
    }

    intersect(arr: MinMaxConstraint[]): MinMaxConstraint {
        assert(arr.length > 0);

        let [min, max] = arr[0];
        for (let i = 1; i < arr.length; i++) {
            const [otherMin, otherMax] = arr[i];
            if (typeof min === "number" && typeof otherMin === "number") {
                min = Math.max(min, otherMin);
            } else if (min === undefined) {
                min = otherMin;
            }
            if (typeof max === "number" && typeof otherMax === "number") {
                max = Math.min(max, otherMax);
            } else if (max === undefined) {
                max = otherMax;
            }
        }
        return checkMinMaxConstraint([min, max]);
    }

    makeInferred(_: MinMaxConstraint): undefined {
        return undefined;
    }

    stringify([min, max]: MinMaxConstraint): string {
        return `${min}-${max}`;
    }
}

export const minMaxTypeAttributeKind: TypeAttributeKind<MinMaxConstraint> = new MinMaxConstraintTypeAttributeKind(
    "minMax"
);

export const minMaxLengthTypeAttributeKind: TypeAttributeKind<MinMaxConstraint> = new MinMaxConstraintTypeAttributeKind(
    "minMaxLength"
);

function producer(
    schema: JSONSchema,
    types: Set<JSONSchemaType>,
    minProperty: string,
    maxProperty: string
): MinMaxConstraint | undefined {
    if (!(typeof schema === "object")) return undefined;
    if (!types.has("number") && !types.has("integer") && !types.has("string")) return undefined;

    let min: number | undefined = undefined;
    let max: number | undefined = undefined;

    if (typeof schema[minProperty] === "number") {
        min = schema[minProperty];
    }
    if (typeof schema[maxProperty] === "number") {
        max = schema[maxProperty];
    }

    if (min === undefined && max === undefined) return undefined;
    return [min, max];
}

export function minMaxAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    const maybeMinMax = producer(schema, types, "minimum", "maximum");
    if (maybeMinMax === undefined) return undefined;
    return { forNumber: minMaxTypeAttributeKind.makeAttributes(maybeMinMax) };
}

export function minMaxLengthAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    const maybeMinMaxLength = producer(schema, types, "minLength", "maxLength");
    if (maybeMinMaxLength === undefined) return undefined;
    return { forNumber: minMaxLengthTypeAttributeKind.makeAttributes(maybeMinMaxLength) };
}

export function minMaxValue(t: Type): MinMaxConstraint | undefined {
    return minMaxTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function minMaxLength(t: Type): MinMaxConstraint | undefined {
    return minMaxLengthTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export class StringTypeAttributeKind extends TypeAttributeKind<string> {
    get inIdentity(): boolean {
        return true;
    }

    combine(_arr: string[]): string {
        return messageError("MiscMustntCombineStringAttribute", {});
    }

    intersect(_arr: string[]): string {
        return messageError("MiscMustntIntersectStringAttribute", {});
    }

    makeInferred(_: string): undefined {
        return undefined;
    }
}

export const patternTypeAttributeKind: TypeAttributeKind<string> = new StringTypeAttributeKind(
    "pattern"
);

export function patternAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!(typeof schema === "object")) return undefined;
    if (!types.has("string")) return undefined;

    let patt: string | undefined = undefined;

    if (typeof schema["pattern"] === "string") {
        patt = schema["pattern"];
    }

    if (patt === undefined) return undefined;
    return { forString: patternTypeAttributeKind.makeAttributes(patt) };
}

export function pattern(t: Type): string | undefined {
    return patternTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
