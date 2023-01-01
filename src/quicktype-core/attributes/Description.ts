import {
    mapFilterMap,
    mapFromObject,
    setUnion,
    iterableFirst,
    setUnionManyInto,
    mapMergeWithInto,
    setSubtract
} from "collection-utils";

import { TypeAttributeKind, emptyTypeAttributes } from "./TypeAttributes";
import { JSONSchemaType, Ref, JSONSchemaAttributes, PathElementKind, PathElement } from "../input/JSONSchemaInput";
import { JSONSchema } from "../input/JSONSchemaStore";
import { Type } from "../Type";

export function addDescriptionToSchema(
    schema: { [name: string]: unknown },
    description: Iterable<string> | undefined
): void {
    if (description === undefined) return;
    schema.description = Array.from(description).join("\n");
}

class DescriptionTypeAttributeKind extends TypeAttributeKind<ReadonlySet<string>> {
    constructor() {
        super("description");
    }

    combine(attrs: ReadonlySet<string>[]): ReadonlySet<string> {
        return setUnionManyInto(new Set(), attrs);
    }

    makeInferred(_: ReadonlySet<string>): undefined {
        return undefined;
    }

    addToSchema(schema: { [name: string]: unknown }, _t: Type, attrs: ReadonlySet<string>): void {
        addDescriptionToSchema(schema, attrs);
    }

    stringify(descriptions: ReadonlySet<string>): string | undefined {
        let result = iterableFirst(descriptions);
        if (result === undefined) return undefined;
        if (result.length > 5 + 3) {
            result = `${result.slice(0, 5)}...`;
        }
        if (descriptions.size > 1) {
            result = `${result}, ...`;
        }
        return result;
    }
}

export const descriptionTypeAttributeKind: TypeAttributeKind<ReadonlySet<string>> = new DescriptionTypeAttributeKind();

class PropertyDescriptionsTypeAttributeKind extends TypeAttributeKind<Map<string, ReadonlySet<string>>> {
    constructor() {
        super("propertyDescriptions");
    }

    combine(attrs: Map<string, ReadonlySet<string>>[]): Map<string, ReadonlySet<string>> {
        // FIXME: Implement this with mutable sets
        const result = new Map<string, ReadonlySet<string>>();
        for (const attr of attrs) {
            mapMergeWithInto(result, (sa, sb) => setUnion(sa, sb), attr);
        }
        return result;
    }

    makeInferred(_: Map<string, ReadonlySet<string>>): undefined {
        return undefined;
    }

    stringify(propertyDescriptions: Map<string, ReadonlySet<string>>): string | undefined {
        if (propertyDescriptions.size === 0) return undefined;
        return `prop descs: ${propertyDescriptions.size}`;
    }
}

export const propertyDescriptionsTypeAttributeKind: TypeAttributeKind<
    Map<string, ReadonlySet<string>>
> = new PropertyDescriptionsTypeAttributeKind();

function isPropertiesKey(el: PathElement): boolean {
    return el.kind === PathElementKind.KeyOrIndex && el.key === "properties";
}

export function descriptionAttributeProducer(
    schema: JSONSchema,
    ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!(typeof schema === "object")) return undefined;

    let description = emptyTypeAttributes;
    let propertyDescription = emptyTypeAttributes;

    const pathLength = ref.path.length;
    if (
        types.has("object") ||
        setSubtract(types, ["null"]).size > 1 ||
        schema.enum !== undefined ||
        pathLength < 2 ||
        !isPropertiesKey(ref.path[pathLength - 2])
    ) {
        const maybeDescription = schema.description;
        if (typeof maybeDescription === "string") {
            description = descriptionTypeAttributeKind.makeAttributes(new Set([maybeDescription]));
        }
    }

    if (types.has("object") && typeof schema.properties === "object") {
        const propertyDescriptions = mapFilterMap(mapFromObject<any>(schema.properties), propSchema => {
            if (typeof propSchema === "object") {
                const desc = propSchema.description;
                if (typeof desc === "string") {
                    return new Set([desc]);
                }
            }
            return undefined;
        });
        if (propertyDescriptions.size > 0) {
            propertyDescription = propertyDescriptionsTypeAttributeKind.makeAttributes(propertyDescriptions);
        }
    }

    return { forType: description, forObject: propertyDescription };
}
