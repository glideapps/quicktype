import type {
    JSONSchemaAttributes,
    JSONSchemaType,
    Ref,
} from "../input/JSONSchemaInput.js";
import type { JSONSchema } from "../input/JSONSchemaStore.js";
import type { Type } from "../Type/Type.js";

import { TypeAttributeKind } from "./TypeAttributes.js";

export type DefaultValue = boolean | number | string | null;

class DefaultValueTypeAttributeKind extends TypeAttributeKind<DefaultValue> {
    public constructor() {
        super("defaultValue");
    }

    public get inIdentity(): boolean {
        return true;
    }

    public combine(values: DefaultValue[]): DefaultValue | undefined {
        const first = values[0];
        return values.every((value) => value === first) ? first : undefined;
    }

    public makeInferred(_: DefaultValue): undefined {
        return undefined;
    }

    public addToSchema(
        schema: { [name: string]: unknown },
        _t: Type,
        defaultValue: DefaultValue,
    ): void {
        schema.default = defaultValue;
    }

    public stringify(defaultValue: DefaultValue): string {
        return JSON.stringify(defaultValue);
    }
}

export const defaultValueTypeAttributeKind: TypeAttributeKind<DefaultValue> =
    new DefaultValueTypeAttributeKind();

export function defaultValueAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>,
): JSONSchemaAttributes | undefined {
    if (typeof schema !== "object") return undefined;

    const defaultValue = schema.default;
    if (
        defaultValue !== null &&
        typeof defaultValue !== "boolean" &&
        typeof defaultValue !== "number" &&
        typeof defaultValue !== "string"
    ) {
        return undefined;
    }

    const attributes =
        defaultValueTypeAttributeKind.makeAttributes(defaultValue);
    if (typeof defaultValue === "number") {
        if (!types.has("number") && !types.has("integer")) return undefined;
        return { forNumber: attributes };
    }

    if (typeof defaultValue === "string") {
        if (!types.has("string")) return undefined;
        return { forString: attributes };
    }

    if (typeof defaultValue === "boolean") {
        if (!types.has("boolean")) return undefined;
        return { forBoolean: attributes };
    }

    if (!types.has("null")) return undefined;
    return { forNull: attributes };
}

export function defaultValueForType(t: Type): DefaultValue | undefined {
    return defaultValueTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
