"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const URI = require("urijs");
const TypeAttributes_1 = require("./TypeAttributes");
const collection_utils_1 = require("collection-utils");
const Support_1 = require("../support/Support");
const protocolsSchemaProperty = "qt-uri-protocols";
const extensionsSchemaProperty = "qt-uri-extensions";
class URITypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("uriAttributes");
    }
    get inIdentity() {
        return true;
    }
    combine(attrs) {
        const protocolSets = attrs.map(a => a[0]);
        const extensionSets = attrs.map(a => a[1]);
        return [collection_utils_1.setUnionManyInto(new Set(), protocolSets), collection_utils_1.setUnionManyInto(new Set(), extensionSets)];
    }
    makeInferred(_) {
        return undefined;
    }
    addToSchema(schema, t, attrs) {
        if (t.kind !== "string" && t.kind !== "uri")
            return;
        const [protocols, extensions] = attrs;
        if (protocols.size > 0) {
            schema[protocolsSchemaProperty] = Array.from(protocols).sort();
        }
        if (extensions.size > 0) {
            schema[extensionsSchemaProperty] = Array.from(extensions).sort();
        }
    }
}
exports.uriTypeAttributeKind = new URITypeAttributeKind();
const extensionRegex = /^.+(\.[^./\\]+)$/;
function pathExtension(path) {
    const matches = path.match(extensionRegex);
    if (matches === null)
        return undefined;
    return matches[1];
}
function uriInferenceAttributesProducer(s) {
    try {
        const uri = URI(s);
        const extension = pathExtension(uri.path());
        const extensions = extension === undefined ? [] : [extension.toLowerCase()];
        return exports.uriTypeAttributeKind.makeAttributes([new Set([uri.protocol().toLowerCase()]), new Set(extensions)]);
    }
    catch (_a) {
        return TypeAttributes_1.emptyTypeAttributes;
    }
}
exports.uriInferenceAttributesProducer = uriInferenceAttributesProducer;
function uriSchemaAttributesProducer(schema, _ref, types) {
    if (!(typeof schema === "object"))
        return undefined;
    if (!types.has("string"))
        return undefined;
    let protocols;
    const maybeProtocols = schema[protocolsSchemaProperty];
    if (maybeProtocols !== undefined) {
        protocols = new Set(Support_1.checkArray(maybeProtocols, Support_1.checkString));
    }
    else {
        protocols = new Set();
    }
    let extensions;
    const maybeExtensions = schema[extensionsSchemaProperty];
    if (maybeExtensions !== undefined) {
        extensions = new Set(Support_1.checkArray(maybeExtensions, Support_1.checkString));
    }
    else {
        extensions = new Set();
    }
    if (protocols.size === 0 && extensions.size === 0)
        return undefined;
    return { forString: exports.uriTypeAttributeKind.makeAttributes([protocols, extensions]) };
}
exports.uriSchemaAttributesProducer = uriSchemaAttributesProducer;
