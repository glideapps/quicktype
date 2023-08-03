import { Type, TypeKind } from "../Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { assert } from "../support/Support";
import { messageError } from "../Messages";
import { JSONSchemaType, JSONSchemaAttributes, Ref } from "../input/JSONSchemaInput";
import { JSONSchema } from "../input/JSONSchemaStore";

// This can't be an object type, unfortunately, because it's in the
// type's identity and as such must be comparable and hashable with
// `areEqual`, `hashCodeOf`.
export type MinMaxConstraint = [number | undefined, number | undefined];

function checkMinMaxConstraint(minmax: MinMaxConstraint): MinMaxConstraint | undefined {
    const [min, max] = minmax;
    if (typeof min === "number" && typeof max === "number" && min > max) {
        return messageError("MiscInvalidMinMaxConstraint", { min, max });
    }
    if (min === undefined && max === undefined) {
        return undefined;
    }
    return minmax;
}

export class MinMaxConstraintTypeAttributeKind extends TypeAttributeKind<MinMaxConstraint> {
    constructor(
        name: string,
        private _typeKinds: Set<TypeKind>,
        private _minSchemaProperty: string,
        private _maxSchemaProperty: string
    ) {
        super(name);
    }

    get inIdentity(): boolean {
        return true;
    }

    combine(arr: MinMaxConstraint[]): MinMaxConstraint | undefined {
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

    intersect(arr: MinMaxConstraint[]): MinMaxConstraint | undefined {
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

    addToSchema(schema: { [name: string]: unknown }, t: Type, attr: MinMaxConstraint): void {
        if (this._typeKinds.has(t.kind)) return;

        const [min, max] = attr;
        if (min !== undefined) {
            schema[this._minSchemaProperty] = min;
        }
        if (max !== undefined) {
            schema[this._maxSchemaProperty] = max;
        }
    }

    stringify([min, max]: MinMaxConstraint): string {
        return `${min}-${max}`;
    }
}

export const minMaxTypeAttributeKind: TypeAttributeKind<MinMaxConstraint> = new MinMaxConstraintTypeAttributeKind(
    "minMax",
    new Set<TypeKind>(["integer", "double"]),
    "minimum",
    "maximum"
);

export const minMaxLengthTypeAttributeKind: TypeAttributeKind<MinMaxConstraint> = new MinMaxConstraintTypeAttributeKind(
    "minMaxLength",
    new Set<TypeKind>(["string"]),
    "minLength",
    "maxLength"
);

export const minMaxItemsTypeAttributeKind: TypeAttributeKind<MinMaxConstraint> = new MinMaxConstraintTypeAttributeKind(
    "minMaxItems",
    new Set<TypeKind>(["array"]),
    "minItems",
    "maxItems"
);


export const minMaxContainsTypeAttributeKind: TypeAttributeKind<MinMaxConstraint> = new MinMaxConstraintTypeAttributeKind(
    "minMaxItems",
    new Set<TypeKind>(["array"]),
    "minContains",
    "maxContains"
);

function producer(schema: JSONSchema, minProperty: string, maxProperty: string): MinMaxConstraint | undefined {
    if (!(typeof schema === "object")) return undefined;

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
    if (!types.has("number") && !types.has("integer")) return undefined;

    const maybeMinMax = producer(schema, "minimum", "maximum");
    if (maybeMinMax === undefined) return undefined;
    return { forNumber: minMaxTypeAttributeKind.makeAttributes(maybeMinMax) };
}

export function minMaxLengthAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!types.has("string")) return undefined;

    const maybeMinMaxLength = producer(schema, "minLength", "maxLength");
    if (maybeMinMaxLength === undefined) return undefined;
    return { forString: minMaxLengthTypeAttributeKind.makeAttributes(maybeMinMaxLength) };
}

export function minMaxItemsAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!types.has("array")) return undefined;

    const maybeMinMaxLength = producer(schema, "minItems", "maxItems");
    if (maybeMinMaxLength === undefined) return undefined;
    return { forArray: minMaxItemsTypeAttributeKind.makeAttributes(maybeMinMaxLength) };
}

export function minMaxContainsAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!types.has("array")) return undefined;

    const maybeMinMaxLength = producer(schema, "minContains", "maxContains");
    if (maybeMinMaxLength === undefined) return undefined;
    return { forArray: minMaxContainsTypeAttributeKind.makeAttributes(maybeMinMaxLength) };
}

export function minMaxValueForType(t: Type): MinMaxConstraint | undefined {
    return minMaxTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function minMaxLengthForType(t: Type): MinMaxConstraint | undefined {
    return minMaxLengthTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function minMaxItemsForType(t: Type): MinMaxConstraint | undefined {
    return minMaxItemsTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function minMaxContainsForType(t: Type): MinMaxConstraint | undefined {
    return minMaxContainsTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export class PatternTypeAttributeKind extends TypeAttributeKind<string> {
    constructor() {
        super("pattern");
    }

    get inIdentity(): boolean {
        return true;
    }

    combine(arr: string[]): string {
        assert(arr.length > 0);
        return arr.map(p => `(${p})`).join("|");
    }

    intersect(_arr: string[]): string | undefined {
        /** FIXME!!! what is the intersection of regexps? */
        return undefined;
    }

    makeInferred(_: string): undefined {
        return undefined;
    }

    addToSchema(schema: { [name: string]: unknown }, t: Type, attr: string): void {
        if (t.kind !== "string") return;
        schema.pattern = attr;
    }
}

export const patternTypeAttributeKind: TypeAttributeKind<string> = new PatternTypeAttributeKind();

export function patternAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!(typeof schema === "object")) return undefined;
    if (!types.has("string")) return undefined;

    const patt = schema.pattern;
    if (typeof patt !== "string") return undefined;
    return { forString: patternTypeAttributeKind.makeAttributes(patt) };
}

export function patternForType(t: Type): string | undefined {
    return patternTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
