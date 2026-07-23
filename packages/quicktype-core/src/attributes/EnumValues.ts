import { mapMap } from "collection-utils";

import type {
    JSONSchemaAttributes,
    JSONSchemaType,
    Ref,
} from "../input/JSONSchemaInput.js";
import type { JSONSchema } from "../input/JSONSchemaStore.js";
import type { EnumType } from "../Type/Type.js";

import {
    type AccessorNames,
    lookupKey,
    makeAccessorNames,
} from "./AccessorNames.js";
import { TypeAttributeKind } from "./TypeAttributes.js";

class EnumValuesTypeAttributeKind extends TypeAttributeKind<AccessorNames> {
    public constructor() {
        super("enumValues");
    }

    public makeInferred(_: AccessorNames): undefined {
        return undefined;
    }
}

export const enumValuesTypeAttributeKind: TypeAttributeKind<AccessorNames> =
    new EnumValuesTypeAttributeKind();

export function enumCaseValues(
    e: EnumType,
    language: string,
): Map<string, [string, boolean] | undefined> {
    const enumValues = enumValuesTypeAttributeKind.tryGetInAttributes(
        e.getAttributes(),
    );
    if (enumValues === undefined)
        return mapMap(e.cases.entries(), (_) => undefined);
    return mapMap(e.cases.entries(), (c) => lookupKey(enumValues, c, language));
}

export function enumValuesAttributeProducer(
    schema: JSONSchema,
    _canonicalRef: Ref | undefined,
    _types: Set<JSONSchemaType>,
): JSONSchemaAttributes | undefined {
    if (typeof schema !== "object") return undefined;

    const maybeEnumValues = schema["qt-enum-values"];

    if (maybeEnumValues === undefined) return undefined;

    return {
        forType: enumValuesTypeAttributeKind.makeAttributes(
            makeAccessorNames(maybeEnumValues),
        ),
    };
}
