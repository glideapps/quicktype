"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TargetLanguage_1 = require("../TargetLanguage");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Naming_1 = require("../Naming");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const TypeBuilder_1 = require("../TypeBuilder");
const Description_1 = require("../attributes/Description");
class JSONSchemaTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("JSON Schema", ["schema", "json-schema"], "schema");
    }
    getOptions() {
        return [];
    }
    get stringTypeMapping() {
        return TypeBuilder_1.getNoStringTypeMapping();
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    get supportsFullObjectType() {
        return true;
    }
    makeRenderer(renderContext, _untypedOptionValues) {
        return new JSONSchemaRenderer(this, renderContext);
    }
}
exports.JSONSchemaTargetLanguage = JSONSchemaTargetLanguage;
const namingFunction = Naming_1.funPrefixNamer("namer", jsonNameStyle);
const legalizeName = Strings_1.legalizeCharacters(cp => cp >= 32 && cp < 128 && cp !== 0x2f /* slash */);
function jsonNameStyle(original) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, Strings_1.firstUpperWordStyle, Strings_1.firstUpperWordStyle, Strings_1.allUpperWordStyle, Strings_1.allUpperWordStyle, "", _ => true);
}
class JSONSchemaRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    makeNamedTypeNamer() {
        return namingFunction;
    }
    namerForObjectProperty() {
        return null;
    }
    makeUnionMemberNamer() {
        return null;
    }
    makeEnumCaseNamer() {
        return null;
    }
    nameForType(t) {
        return Support_1.defined(this.names.get(this.nameForNamedType(t)));
    }
    makeOneOf(types) {
        const first = collection_utils_1.iterableFirst(types);
        if (first === undefined) {
            return Support_1.panic("Must have at least one type for oneOf");
        }
        if (types.size === 1) {
            return this.schemaForType(first);
        }
        return { anyOf: Array.from(types).map((t) => this.schemaForType(t)) };
    }
    makeRef(t) {
        return { $ref: `#/definitions/${this.nameForType(t)}` };
    }
    addAttributesToSchema(t, schema) {
        const attributes = this.typeGraph.attributeStore.attributesForType(t);
        for (const [kind, attr] of attributes) {
            kind.addToSchema(schema, t, attr);
        }
    }
    schemaForType(t) {
        const schema = TypeUtils_1.matchTypeExhaustive(t, _noneType => {
            return Support_1.panic("none type should have been replaced");
        }, _anyType => ({}), _nullType => ({ type: "null" }), _boolType => ({ type: "boolean" }), _integerType => ({ type: "integer" }), _doubleType => ({ type: "number" }), _stringType => ({ type: "string" }), arrayType => ({ type: "array", items: this.schemaForType(arrayType.items) }), classType => this.makeRef(classType), mapType => this.definitionForObject(mapType, undefined), objectType => this.makeRef(objectType), enumType => this.makeRef(enumType), unionType => {
            if (this.unionNeedsName(unionType)) {
                return this.makeRef(unionType);
            }
            else {
                return this.definitionForUnion(unionType);
            }
        }, transformedStringType => {
            const target = Type_1.transformedStringTypeTargetTypeKindsMap.get(transformedStringType.kind);
            if (target === undefined) {
                return Support_1.panic(`Unknown transformed string type ${transformedStringType.kind}`);
            }
            return { type: "string", format: target.jsonSchema };
        });
        if (schema.$ref === undefined) {
            this.addAttributesToSchema(t, schema);
        }
        return schema;
    }
    definitionForObject(o, title) {
        let properties;
        let required;
        if (o.getProperties().size === 0) {
            properties = undefined;
            required = undefined;
        }
        else {
            const props = {};
            const req = [];
            for (const [name, p] of o.getProperties()) {
                const prop = this.schemaForType(p.type);
                if (prop.description === undefined) {
                    Description_1.addDescriptionToSchema(prop, this.descriptionForClassProperty(o, name));
                }
                props[name] = prop;
                if (!p.isOptional) {
                    req.push(name);
                }
            }
            properties = props;
            required = req.sort();
        }
        const additional = o.getAdditionalProperties();
        const additionalProperties = additional !== undefined ? this.schemaForType(additional) : false;
        const schema = {
            type: "object",
            additionalProperties,
            properties,
            required,
            title
        };
        this.addAttributesToSchema(o, schema);
        return schema;
    }
    definitionForUnion(u, title) {
        const oneOf = this.makeOneOf(u.sortedMembers);
        if (title !== undefined) {
            oneOf.title = title;
        }
        this.addAttributesToSchema(u, oneOf);
        return oneOf;
    }
    definitionForEnum(e, title) {
        const schema = { type: "string", enum: Array.from(e.cases), title };
        this.addAttributesToSchema(e, schema);
        return schema;
    }
    emitSourceStructure() {
        // FIXME: Find a good way to do multiple top-levels.  Maybe multiple files?
        const topLevelType = this.topLevels.size === 1 ? this.schemaForType(Support_1.defined(collection_utils_1.mapFirst(this.topLevels))) : {};
        const schema = Object.assign({ $schema: "http://json-schema.org/draft-06/schema#" }, topLevelType);
        const definitions = {};
        this.forEachObject("none", (o, name) => {
            const title = Support_1.defined(this.names.get(name));
            definitions[title] = this.definitionForObject(o, title);
        });
        this.forEachUnion("none", (u, name) => {
            if (!this.unionNeedsName(u))
                return;
            const title = Support_1.defined(this.names.get(name));
            definitions[title] = this.definitionForUnion(u, title);
        });
        this.forEachEnum("none", (e, name) => {
            const title = Support_1.defined(this.names.get(name));
            definitions[title] = this.definitionForEnum(e, title);
        });
        schema.definitions = definitions;
        this.emitMultiline(JSON.stringify(schema, undefined, "    "));
    }
}
exports.JSONSchemaRenderer = JSONSchemaRenderer;
