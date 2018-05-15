import { OrderedSet, OrderedMap, Map, Set } from "immutable";

import { TypeAttributeKind, TypeAttributes, combineTypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { setUnion } from "./support/Support";
import { JSONSchemaType, Ref } from "./input/JSONSchemaInput";
import { JSONSchema } from "./input/JSONSchemaStore";

class DescriptionTypeAttributeKind extends TypeAttributeKind<OrderedSet<string>> {
    constructor() {
        super("description");
    }

    combine(a: OrderedSet<string>, b: OrderedSet<string>): OrderedSet<string> {
        return a.union(b);
    }

    makeInferred(_: OrderedSet<string>): OrderedSet<string> {
        return OrderedSet();
    }

    stringify(descriptions: OrderedSet<string>): string | undefined {
        let result = descriptions.first();
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

export const descriptionTypeAttributeKind: TypeAttributeKind<OrderedSet<string>> = new DescriptionTypeAttributeKind();

class PropertyDescriptionsTypeAttributeKind extends TypeAttributeKind<Map<string, OrderedSet<string>>> {
    constructor() {
        super("propertyDescriptions");
    }

    combine(a: Map<string, OrderedSet<string>>, b: Map<string, OrderedSet<string>>): Map<string, OrderedSet<string>> {
        return a.mergeWith(setUnion, b);
    }

    makeInferred(_: Map<string, OrderedSet<string>>): Map<string, OrderedSet<string>> {
        return Map();
    }
}

export const propertyDescriptionsTypeAttributeKind: TypeAttributeKind<
    Map<string, OrderedSet<string>>
> = new PropertyDescriptionsTypeAttributeKind();

export function descriptionAttributeProducer(
    schema: JSONSchema,
    _canonicalRef: Ref,
    types: Set<JSONSchemaType>
): TypeAttributes | undefined {
    if (!(typeof schema === "object")) return undefined;

    let description = emptyTypeAttributes;
    let propertyDescription = emptyTypeAttributes;

    const maybeDescription = schema.description;
    if (typeof maybeDescription === "string") {
        description = descriptionTypeAttributeKind.makeAttributes(OrderedSet([maybeDescription]));
    }

    if (types.has("object") && typeof schema.properties === "object") {
        const propertyDescriptions = OrderedMap<string, any>(schema.properties)
            .map(propSchema => {
                if (typeof propSchema === "object") {
                    const desc = propSchema.description;
                    if (typeof desc === "string") {
                        return OrderedSet([desc]);
                    }
                }
                return undefined;
            })
            .filter(v => v !== undefined) as OrderedMap<string, OrderedSet<string>>;
        if (!propertyDescriptions.isEmpty()) {
            propertyDescription = propertyDescriptionsTypeAttributeKind.makeAttributes(propertyDescriptions);
        }
    }

    return combineTypeAttributes("union", description, propertyDescription);
}
