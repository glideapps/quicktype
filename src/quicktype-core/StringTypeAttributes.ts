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

export class StringTypeAttributeKind extends TypeAttributeKind<string> {
    get inIdentity(): boolean {
        return true;
    }

    combine(arr: string[]): string {
        assert(arr.length > 0);

        for (const s in arr) {
            if (s !== undefined) return s;
        }
        return "";
    }

    intersect(arr: string[]): string {
        assert(arr.length > 0);

        for (const s in arr) {
            if (s !== undefined) return s;
        }
        return "";
    }

    makeInferred(_: string): undefined {
        return undefined;
    }
}

export const stringTypeAttributeKind: TypeAttributeKind<string> = new StringTypeAttributeKind(
    "pattern"
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
    if (!types.has("number") && !types.has("integer")) return undefined;

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
    return { forString: minMaxLengthTypeAttributeKind.makeAttributes(maybeMinMaxLength) };
}
