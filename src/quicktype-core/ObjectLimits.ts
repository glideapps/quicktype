import { Type } from "./Type";
import { emptyTypeAttributes, TypeAttributes, TypeAttributeKind } from "./TypeAttributes";
import { JSONSchema } from "./input/JSONSchemaStore";
import { Ref, JSONSchemaType, JSONSchemaAttributes } from "./input/JSONSchemaInput";

export type NumericRange = {
    minimum: number | undefined;
    maximum: number | undefined;
};

export const emptyNumericRange: NumericRange = { minimum : undefined, maximum : undefined };

class NumericRangeTypeAttributeKind extends TypeAttributeKind<NumericRange> {
    constructor(kind:string) {
        super(kind);
    }

    combine(arr: NumericRange[]): NumericRange {
        const result = emptyNumericRange;
        for (const m of arr) {
            if (m.minimum !== undefined) {
                if (result.minimum === undefined) {
                    result.minimum = m.minimum;
                } else if (m.minimum < result.minimum) {
                    result.minimum = m.minimum;
                }
            }

            if (m.maximum !== undefined) {
                if (result.maximum === undefined) {
                    result.maximum = m.maximum;
                } else if (m.maximum < result.maximum) {
                    result.maximum = m.maximum;
                }
            }
        }
        return result;
    }

    makeInferred(_: NumericRange) {
        return undefined;
    }
}

export const objectMinMaxValueTypeAttributeKind: TypeAttributeKind<NumericRange> = new NumericRangeTypeAttributeKind("objectMinMaxValue");
export const objectMinMaxLengthTypeAttributeKind: TypeAttributeKind<NumericRange> = new NumericRangeTypeAttributeKind("objectMinMaxLength");

class RegExpPatternTypeAttributeKind extends TypeAttributeKind<string> {
    constructor() {
        super("regExpPattern");
    }

    combine(attrs: string[]): string {
        /** FIXME!!! How to combine strings? */
        let res:string = "";
        for (const m of attrs) {
            if (m !== undefined) { res = m; }
        }
        return res;
    }

    makeInferred(_: string): undefined {
        return undefined;
    }
}

export const objectRegExpPatternTypeAttributeKind: TypeAttributeKind<string> = new RegExpPatternTypeAttributeKind();

export function objectMinMaxValue(t: Type): NumericRange | undefined {
    return objectMinMaxValueTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function objectMinMaxLength(t: Type): NumericRange | undefined {
    return objectMinMaxLengthTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function objectRegExpPattern(t: Type): string | undefined {
    return objectRegExpPatternTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function objectValuesAttributeProducer(
    schema: JSONSchema,
    _canonicalRef: Ref | undefined,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (typeof schema !== "object") return undefined;
    if (!types.has("object")) return undefined;

    let attrs:TypeAttributes = emptyTypeAttributes;

    const maybeMinValue = schema.minimum !== undefined && typeof schema.minimum === "number" ? schema.minimum : undefined;
    const maybeMaxValue = schema.maximum !== undefined && typeof schema.maximum === "number" ? schema.maximum : undefined;
    const minMaxVal: NumericRange = { minimum : maybeMinValue, maximum : maybeMaxValue };
    if (minMaxVal.minimum !== undefined || minMaxVal.maximum !== undefined) {
        const attr = objectMinMaxValueTypeAttributeKind.makeAttributes(minMaxVal);
        attrs = new Map([...attr, ...attrs]);
    }

    const maybeMinLength = schema.minLength !== undefined && typeof schema.minLength === "number" ? schema.minLength : undefined;
    const maybeMaxLength = schema.maxLength !== undefined && typeof schema.maxLength === "number" ? schema.maxLength : undefined;
    const minMaxLen: NumericRange = { minimum : maybeMinLength, maximum : maybeMaxLength };
    if (minMaxLen.minimum !== undefined || minMaxLen.maximum !== undefined) {
        const attr = objectMinMaxLengthTypeAttributeKind.makeAttributes(minMaxLen);
        attrs = new Map([...attr, ...attrs]);
    }

    const pattern = schema.pattern !== undefined && typeof schema.pattern === "string" ? schema.pattern : undefined;
    if ( pattern !== undefined) {
        const attr = objectRegExpPatternTypeAttributeKind.makeAttributes(pattern);
        attrs = new Map([...attr, ...attrs]);
    }

    return attrs.size > 0 ? { forType: attrs } : undefined;
}
