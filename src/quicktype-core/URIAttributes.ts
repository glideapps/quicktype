import * as URI from "urijs";
import * as path from "path";

import { TypeAttributeKind, TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { setUnionManyInto } from "collection-utils";
import { JSONSchemaType, JSONSchemaAttributes, Ref } from "./input/JSONSchemaInput";
import { JSONSchema } from "./input/JSONSchemaStore";
import { checkArray } from "./support/Support";
import { isString } from "util";
import { Type } from "./Type";

const protocolsSchemaProperty = "qt-uri-protocols";
const extensionsSchemaProperty = "qt-uri-extensions";

type URIAttributes = {
    protocols: ReadonlySet<string>;
    extensions: ReadonlySet<string>;
};

class URITypeAttributeKind extends TypeAttributeKind<URIAttributes> {
    constructor() {
        super("uriAttributes");
    }

    combine(attrs: URIAttributes[]): URIAttributes {
        const schemaSets = attrs.map(a => a.protocols);
        const extensionSets = attrs.map(a => a.extensions);
        return {
            protocols: setUnionManyInto(new Set(), schemaSets),
            extensions: setUnionManyInto(new Set(), extensionSets)
        };
    }

    makeInferred(_: URIAttributes): undefined {
        return undefined;
    }

    addToSchema(schema: { [name: string]: unknown }, t: Type, attrs: URIAttributes): void {
        if (t.kind !== "string") return;

        if (attrs.protocols.size > 0) {
            schema[protocolsSchemaProperty] = Array.from(attrs.protocols).sort();
        }
        if (attrs.extensions.size > 0) {
            schema[extensionsSchemaProperty] = Array.from(attrs.extensions).sort();
        }
    }
}

export const uriTypeAttributeKind: TypeAttributeKind<URIAttributes> = new URITypeAttributeKind();

export function uriInferenceAttributesProducer(s: string): TypeAttributes {
    try {
        const uri = URI.parse(s);
        const extension = path.extname(uri.path).toLowerCase();
        const extensions = extension === "" ? [] : [extension];
        return uriTypeAttributeKind.makeAttributes({
            protocols: new Set([uri.protocol.toLowerCase()]),
            extensions: new Set(extensions)
        });
    } catch {
        return emptyTypeAttributes;
    }
}

export function uriSchemaAttributesProducer(
    schema: JSONSchema,
    _ref: Ref,
    types: Set<JSONSchemaType>
): JSONSchemaAttributes | undefined {
    if (!(typeof schema === "object")) return undefined;
    if (!types.has("string")) return undefined;

    let protocols: ReadonlySet<string>;
    const maybeProtocols = schema[protocolsSchemaProperty];
    if (maybeProtocols !== undefined) {
        protocols = new Set(checkArray(maybeProtocols, isString));
    } else {
        protocols = new Set();
    }

    let extensions: ReadonlySet<string>;
    const maybeExtensions = schema[extensionsSchemaProperty];
    if (maybeExtensions !== undefined) {
        extensions = new Set(checkArray(maybeExtensions, isString));
    } else {
        extensions = new Set();
    }

    if (protocols.size === 0 && extensions.size === 0) return undefined;

    return { forString: uriTypeAttributeKind.makeAttributes({ protocols, extensions }) };
}
