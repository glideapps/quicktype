import {
    mapMap,
} from "collection-utils";

import { lookupKey, AccessorNames, makeAccessorNames } from "./AccessorNames";
import { EnumType } from "./Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { JSONSchema } from "./input/JSONSchemaStore";
import { Ref, JSONSchemaType, JSONSchemaAttributes } from "./input/JSONSchemaInput";

class EnumValuesTypeAttributeKind extends TypeAttributeKind<AccessorNames> {
    constructor() {
        super("enumValues");
    }
    makeInferred(_: AccessorNames) {
        return undefined;
    }
}

export const enumValuesTypeAttributeKind: TypeAttributeKind<AccessorNames> = new EnumValuesTypeAttributeKind();

export function enumCaseValues(e: EnumType, language: string): Map<string, [string, boolean] | undefined> {
    const enumValues = enumValuesTypeAttributeKind.tryGetInAttributes(e.getAttributes());
    if (enumValues === undefined) return mapMap(e.cases.entries(), _ => undefined);
    return mapMap(e.cases.entries(), c => lookupKey(enumValues, c, language));
}

export function enumValuesAttributeProducer(
    schema: JSONSchema,
    _canonicalRef: Ref | undefined,
    _types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {

    if (typeof schema !== "object") return undefined;

    const maybeEnumValues = schema["qt-enum-values"];

    if (maybeEnumValues === undefined) return undefined;

    return { forType: enumValuesTypeAttributeKind.makeAttributes(makeAccessorNames(maybeEnumValues)) };
}
