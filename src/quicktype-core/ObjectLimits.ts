import { mapMergeInto, mapFilterMap, mapFromObject } from "collection-utils";
import { ClassType } from "./Type";
import { emptyTypeAttributes, TypeAttributes, TypeAttributeKind } from "./TypeAttributes";
import { JSONSchema } from "./input/JSONSchemaStore";
import { Ref, JSONSchemaType, JSONSchemaAttributes } from "./input/JSONSchemaInput";

export type ObjectValueMap = Map<string, string>;

class ObjectValuesTypeAttributeKind extends TypeAttributeKind<ObjectValueMap> {
    constructor(kind:string) {
        super(kind);
    }

    combine(arr: ObjectValueMap[]): ObjectValueMap {
        const result = new Map<string, string>();
        for (const m of arr) {
            mapMergeInto(result, m);
        }
        return result;
    }

    makeInferred(_: ObjectValueMap) {
        return undefined;
    }
}

export const objectMinValueTypeAttributeKind: TypeAttributeKind<ObjectValueMap> = new ObjectValuesTypeAttributeKind("objectMinValue");
export const objectMaxValueTypeAttributeKind: TypeAttributeKind<ObjectValueMap> = new ObjectValuesTypeAttributeKind("objectMaxValue");
export const objectMinLengthTypeAttributeKind: TypeAttributeKind<ObjectValueMap> = new ObjectValuesTypeAttributeKind("objectMinLength");
export const objectMaxLengthTypeAttributeKind: TypeAttributeKind<ObjectValueMap> = new ObjectValuesTypeAttributeKind("objectMaxLength");
export const objectPatternTypeAttributeKind: TypeAttributeKind<ObjectValueMap> = new ObjectValuesTypeAttributeKind("objectPattern");

function objectNumValue(objectValues: ObjectValueMap | undefined, typeName: string): number | undefined {
    if (objectValues === undefined) return undefined;
    const value = objectValues.get(typeName);
    if (value === undefined) return undefined;
    return +value;
}

function objectStringValue(objectValues: ObjectValueMap | undefined, typeName: string): string | undefined {
    if (objectValues === undefined) return undefined;
    return objectValues.get(typeName);
}

export function objectMinimumValue(typeName: string, t: ClassType): number | undefined {
    return objectNumValue(objectMinValueTypeAttributeKind.tryGetInAttributes(t.getAttributes()), typeName);
}

export function objectMaximumValue(typeName: string, t: ClassType): number | undefined {
    return objectNumValue(objectMaxValueTypeAttributeKind.tryGetInAttributes(t.getAttributes()), typeName);
}

export function objectMinimumLength(typeName: string, t: ClassType): number | undefined {
    return objectNumValue(objectMinLengthTypeAttributeKind.tryGetInAttributes(t.getAttributes()), typeName);
}

export function objectMaximumLength(typeName: string, t: ClassType): number | undefined {
    return objectNumValue(objectMaxLengthTypeAttributeKind.tryGetInAttributes(t.getAttributes()), typeName);
}

export function objectPattern(typeName: string, t: ClassType): string | undefined {
    return objectStringValue(objectPatternTypeAttributeKind.tryGetInAttributes(t.getAttributes()), typeName);
}

export function objectValuesAttributeProducer(
    schema: JSONSchema,
    _canonicalRef: Ref | undefined,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (typeof schema !== "object") return undefined;

    let attrs:TypeAttributes = emptyTypeAttributes;

    if (types.has("object") && typeof schema.properties === "object") {
        const propertyMins = mapFilterMap(mapFromObject<any>(schema.properties), propSchema => {
            if (typeof propSchema === "object") {
                const maybeMinValue = propSchema.minimum;
                if (maybeMinValue !== undefined) {
                    return String(maybeMinValue);
                }
            }

            return undefined;
        });

        if (propertyMins.size > 0) {
            const minAttr = objectMinValueTypeAttributeKind.makeAttributes(propertyMins);
            attrs = new Map([...minAttr, ...attrs]);
        }

        const propertyMaxs = mapFilterMap(mapFromObject<any>(schema.properties), propSchema => {
            if (typeof propSchema === "object") {
                const maybeMaxValue = propSchema.maximum;
                if (maybeMaxValue !== undefined) {
                    return String(maybeMaxValue);
                }
            }

            return undefined;
        });

        if (propertyMaxs.size > 0) {
            const maxAttr = objectMaxValueTypeAttributeKind.makeAttributes(propertyMaxs);
            attrs = new Map([...maxAttr, ...attrs]);
        }

        const propertyMinLens = mapFilterMap(mapFromObject<any>(schema.properties), propSchema => {
            if (typeof propSchema === "object") {
                const maybeMinLengthValue = propSchema.minLength;
                if (maybeMinLengthValue !== undefined) {
                    return String(maybeMinLengthValue);
                }
            }

            return undefined;
        });

        if (propertyMinLens.size > 0) {
            const minLenAttr = objectMinLengthTypeAttributeKind.makeAttributes(propertyMinLens);
            attrs = new Map([...minLenAttr, ...attrs]);
        }

        const propertyMaxLens = mapFilterMap(mapFromObject<any>(schema.properties), propSchema => {
            if (typeof propSchema === "object") {
                const maybeMaxLengthValue = propSchema.maxLength;
                if (maybeMaxLengthValue !== undefined) {
                    return String(maybeMaxLengthValue);
                }
            }

            return undefined;
        });

        if (propertyMaxLens.size > 0) {
            const maxLenAttr = objectMaxLengthTypeAttributeKind.makeAttributes(propertyMaxLens);
            attrs = new Map([...maxLenAttr, ...attrs]);
        }

        const propertyPatterns = mapFilterMap(mapFromObject<any>(schema.properties), propSchema => {
            if (typeof propSchema === "object") {
                const maybePattern = propSchema.pattern;
                if (maybePattern !== undefined) {
                    return maybePattern;
                }
            }

            return undefined;
        });

        if (propertyPatterns.size > 0) {
            const patts = objectPatternTypeAttributeKind.makeAttributes(propertyPatterns);
            attrs = new Map([...patts, ...attrs]);
        }
    }

    return attrs.size > 0 ? { forObject: attrs } : undefined;
}
