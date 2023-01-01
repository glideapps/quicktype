import * as URI from "urijs";

import { TypeAttributeKind, TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { setUnionManyInto } from "collection-utils";
import { JSONSchemaType, JSONSchemaAttributes, Ref } from "../input/JSONSchemaInput";
import { JSONSchema } from "../input/JSONSchemaStore";
import { checkArray, checkString } from "../support/Support";
import { Type } from "../Type";

const protocolsSchemaProperty = "qt-uri-protocols";
const extensionsSchemaProperty = "qt-uri-extensions";

// protocols, extensions
type URIAttributes = [ReadonlySet<string>, ReadonlySet<string>];

class URITypeAttributeKind extends TypeAttributeKind<URIAttributes> {
    constructor() {
        super("uriAttributes");
    }

    get inIdentity(): boolean {
        return true;
    }

    combine(attrs: URIAttributes[]): URIAttributes {
        const protocolSets = attrs.map(a => a[0]);
        const extensionSets = attrs.map(a => a[1]);
        return [setUnionManyInto(new Set(), protocolSets), setUnionManyInto(new Set(), extensionSets)];
    }

    makeInferred(_: URIAttributes): undefined {
        return undefined;
    }

    addToSchema(schema: { [name: string]: unknown }, t: Type, attrs: URIAttributes): void {
        if (t.kind !== "string" && t.kind !== "uri") return;

        const [protocols, extensions] = attrs;
        if (protocols.size > 0) {
            schema[protocolsSchemaProperty] = Array.from(protocols).sort();
        }
        if (extensions.size > 0) {
            schema[extensionsSchemaProperty] = Array.from(extensions).sort();
        }
    }
}

export const uriTypeAttributeKind: TypeAttributeKind<URIAttributes> = new URITypeAttributeKind();

const extensionRegex = /^.+(\.[^./\\]+)$/;

function pathExtension(path: string): string | undefined {
    const matches = path.match(extensionRegex);
    if (matches === null) return undefined;
    return matches[1];
}

export function uriInferenceAttributesProducer(s: string): TypeAttributes {
    try {
        const uri = URI(s);
        const extension = pathExtension(uri.path());
        const extensions = extension === undefined ? [] : [extension.toLowerCase()];
        return uriTypeAttributeKind.makeAttributes([new Set([uri.protocol().toLowerCase()]), new Set(extensions)]);
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
        protocols = new Set(checkArray(maybeProtocols, checkString));
    } else {
        protocols = new Set();
    }

    let extensions: ReadonlySet<string>;
    const maybeExtensions = schema[extensionsSchemaProperty];
    if (maybeExtensions !== undefined) {
        extensions = new Set(checkArray(maybeExtensions, checkString));
    } else {
        extensions = new Set();
    }

    if (protocols.size === 0 && extensions.size === 0) return undefined;

    return { forString: uriTypeAttributeKind.makeAttributes([protocols, extensions]) };
}
