import { mapFromObject } from "collection-utils";

import type {
    JSONSchemaAttributes,
    JSONSchemaType,
    Ref,
} from "../input/JSONSchemaInput.js";
import type { JSONSchema } from "../input/JSONSchemaStore.js";

import { TypeAttributeKind, emptyTypeAttributes } from "./TypeAttributes.js";

export type PropertyDefaultValues = ReadonlyMap<string, unknown>;

class PropertyDefaultValuesTypeAttributeKind extends TypeAttributeKind<PropertyDefaultValues> {
    public constructor() {
        super("propertyDefaultValues");
    }

    public get inIdentity(): boolean {
        return true;
    }

    public requiresUniqueIdentity(_: PropertyDefaultValues): boolean {
        return true;
    }

    public combine(
        attrs: PropertyDefaultValues[],
    ): PropertyDefaultValues | undefined {
        const result = new Map<string, unknown>();
        for (const attr of attrs) {
            for (const [name, value] of attr) {
                if (!result.has(name)) result.set(name, value);
            }
        }

        return result.size === 0 ? undefined : result;
    }

    public makeInferred(_: PropertyDefaultValues): undefined {
        return undefined;
    }
}

export const propertyDefaultValuesTypeAttributeKind: TypeAttributeKind<PropertyDefaultValues> =
    new PropertyDefaultValuesTypeAttributeKind();

export function defaultValuesAttributeProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>,
): JSONSchemaAttributes | undefined {
    if (
        typeof schema !== "object" ||
        !types.has("object") ||
        typeof schema.properties !== "object" ||
        schema.properties === null ||
        Array.isArray(schema.properties)
    ) {
        return undefined;
    }

    const defaults = new Map<string, unknown>();
    for (const [name, propertySchema] of mapFromObject(schema.properties)) {
        if (
            typeof propertySchema === "object" &&
            propertySchema !== null &&
            !Array.isArray(propertySchema) &&
            Object.hasOwn(propertySchema, "default")
        ) {
            defaults.set(
                name,
                (propertySchema as { default: unknown }).default,
            );
        }
    }

    if (defaults.size === 0) return undefined;
    return {
        forType: emptyTypeAttributes,
        forObject:
            propertyDefaultValuesTypeAttributeKind.makeAttributes(defaults),
    };
}
