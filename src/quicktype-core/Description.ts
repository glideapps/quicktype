import { TypeAttributeKind, combineTypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { JSONSchemaType, Ref, JSONSchemaAttributes } from "./input/JSONSchemaInput";
import { JSONSchema } from "./input/JSONSchemaStore";
import { mapMergeWith, mapFilterMap, mapFromObject, setUnion, iterableFirst } from "./support/Containers";

class DescriptionTypeAttributeKind extends TypeAttributeKind<ReadonlySet<string>> {
    constructor() {
        super("description");
    }

    combine(a: ReadonlySet<string>, b: ReadonlySet<string>): ReadonlySet<string> {
        return setUnion(a, b);
    }

    makeInferred(_: ReadonlySet<string>): undefined {
        return undefined;
    }

    stringify(descriptions: ReadonlySet<string>): string | undefined {
        let result = iterableFirst(descriptions);
        if (result === undefined) return undefined;
        if (result.length > 5 + 3) {
            result = `${result.substr(0, 5)}...`;
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

    combine(
        a: Map<string, ReadonlySet<string>>,
        b: Map<string, ReadonlySet<string>>
    ): Map<string, ReadonlySet<string>> {
        return mapMergeWith(a, (sa, sb) => setUnion(sa, sb), b);
    }

    makeInferred(_: Map<string, ReadonlySet<string>>): undefined {
        return undefined;
    }
}

export const propertyDescriptionsTypeAttributeKind: TypeAttributeKind<
    Map<string, ReadonlySet<string>>
> = new PropertyDescriptionsTypeAttributeKind();

export function descriptionAttributeProducer(
    schema: JSONSchema,
    _canonicalRef: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!(typeof schema === "object")) return undefined;

    let description = emptyTypeAttributes;
    let propertyDescription = emptyTypeAttributes;

    const maybeDescription = schema.description;
    if (typeof maybeDescription === "string") {
        description = descriptionTypeAttributeKind.makeAttributes(new Set([maybeDescription]));
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

    return { forType: combineTypeAttributes("union", description, propertyDescription) };
}
