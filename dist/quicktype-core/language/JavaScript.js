"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TypeUtils_1 = require("../TypeUtils");
const Acronyms_1 = require("../support/Acronyms");
const Converters_1 = require("../support/Converters");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const Source_1 = require("../Source");
const Naming_1 = require("../Naming");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const TargetLanguage_1 = require("../TargetLanguage");
const RendererOptions_1 = require("../RendererOptions");
const JavaScriptUnicodeMaps_1 = require("./JavaScriptUnicodeMaps");
exports.javaScriptOptions = {
    acronymStyle: Acronyms_1.acronymOption(Acronyms_1.AcronymStyleOptions.Pascal),
    runtimeTypecheck: new RendererOptions_1.BooleanOption("runtime-typecheck", "Verify JSON.parse results at runtime", true),
    runtimeTypecheckIgnoreUnknownProperties: new RendererOptions_1.BooleanOption("runtime-typecheck-ignore-unknown-properties", "Ignore unknown properties when verifying at runtime", false, "secondary"),
    converters: Converters_1.convertersOption(),
    rawType: new RendererOptions_1.EnumOption("raw-type", "Type of raw input (json by default)", [
        ["json", "json"],
        ["any", "any"]
    ], "json", "secondary")
};
class JavaScriptTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor(displayName = "JavaScript", names = ["javascript", "js", "jsx"], extension = "js") {
        super(displayName, names, extension);
    }
    getOptions() {
        return [
            exports.javaScriptOptions.runtimeTypecheck,
            exports.javaScriptOptions.runtimeTypecheckIgnoreUnknownProperties,
            exports.javaScriptOptions.acronymStyle,
            exports.javaScriptOptions.converters,
            exports.javaScriptOptions.rawType
        ];
    }
    get stringTypeMapping() {
        const mapping = new Map();
        const dateTimeType = "date-time";
        mapping.set("date", dateTimeType);
        mapping.set("date-time", dateTimeType);
        return mapping;
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    get supportsFullObjectType() {
        return true;
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new JavaScriptRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.javaScriptOptions, untypedOptionValues));
    }
}
exports.JavaScriptTargetLanguage = JavaScriptTargetLanguage;
exports.legalizeName = Strings_1.utf16LegalizeCharacters(JavaScriptUnicodeMaps_1.isES3IdentifierPart);
const identityNamingFunction = Naming_1.funPrefixNamer("properties", s => s);
class JavaScriptRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _jsOptions) {
        super(targetLanguage, renderContext);
        this._jsOptions = _jsOptions;
    }
    nameStyle(original, upper) {
        const acronyms = Acronyms_1.acronymStyle(this._jsOptions.acronymStyle);
        const words = Strings_1.splitIntoWords(original);
        return Strings_1.combineWords(words, exports.legalizeName, upper ? Strings_1.firstUpperWordStyle : Strings_1.allLowerWordStyle, Strings_1.firstUpperWordStyle, upper ? s => Strings_1.capitalize(acronyms(s)) : Strings_1.allLowerWordStyle, acronyms, "", JavaScriptUnicodeMaps_1.isES3IdentifierStart);
    }
    makeNamedTypeNamer() {
        return Naming_1.funPrefixNamer("types", s => this.nameStyle(s, true));
    }
    namerForObjectProperty() {
        return identityNamingFunction;
    }
    makeUnionMemberNamer() {
        return null;
    }
    makeEnumCaseNamer() {
        return Naming_1.funPrefixNamer("enum-cases", s => this.nameStyle(s, true));
    }
    namedTypeToNameForTopLevel(type) {
        return TypeUtils_1.directlyReachableSingleNamedType(type);
    }
    makeNameForProperty(c, className, p, jsonName, _assignedName) {
        // Ignore the assigned name
        return super.makeNameForProperty(c, className, p, jsonName, undefined);
    }
    emitDescriptionBlock(lines) {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }
    typeMapTypeFor(t) {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return ['r("', this.nameForNamedType(t), '")'];
        }
        return TypeUtils_1.matchType(t, _anyType => '"any"', _nullType => `null`, _boolType => `true`, _integerType => `0`, _doubleType => `3.14`, _stringType => `""`, arrayType => ["a(", this.typeMapTypeFor(arrayType.items), ")"], _classType => Support_1.panic("We handled this above"), mapType => ["m(", this.typeMapTypeFor(mapType.values), ")"], _enumType => Support_1.panic("We handled this above"), unionType => {
            const children = Array.from(unionType.getChildren()).map((type) => this.typeMapTypeFor(type));
            return ["u(", ...collection_utils_1.arrayIntercalate(", ", children), ")"];
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                return "Date";
            }
            return `""`;
        });
    }
    typeMapTypeForProperty(p) {
        const typeMap = this.typeMapTypeFor(p.type);
        if (!p.isOptional) {
            return typeMap;
        }
        return ["u(undefined, ", typeMap, ")"];
    }
    emitBlock(source, end, emit) {
        this.emitLine(source, "{");
        this.indent(emit);
        this.emitLine("}", end);
    }
    emitTypeMap() {
        const { any: anyAnnotation } = this.typeAnnotations;
        this.emitBlock(`const typeMap${anyAnnotation} = `, ";", () => {
            this.forEachObject("none", (t, name) => {
                const additionalProperties = t.getAdditionalProperties();
                const additional = additionalProperties !== undefined ? this.typeMapTypeFor(additionalProperties) : "false";
                this.emitLine('"', name, '": o([');
                this.indent(() => {
                    this.forEachClassProperty(t, "none", (propName, jsonName, property) => {
                        this.emitLine('{ json: "', Strings_1.utf16StringEscape(jsonName), '", js: "', Source_1.modifySource(Strings_1.utf16StringEscape, propName), '", typ: ', this.typeMapTypeForProperty(property), " },");
                    });
                });
                this.emitLine("], ", additional, "),");
            });
            this.forEachEnum("none", (e, name) => {
                this.emitLine('"', name, '": [');
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (_caseName, jsonName) => {
                        this.emitLine(`"${Strings_1.utf16StringEscape(jsonName)}",`);
                    });
                });
                this.emitLine("],");
            });
        });
    }
    deserializerFunctionName(name) {
        return ["to", name];
    }
    deserializerFunctionLine(_t, name) {
        return ["function ", this.deserializerFunctionName(name), "(json)"];
    }
    serializerFunctionName(name) {
        const camelCaseName = Source_1.modifySource(Strings_1.camelCase, name);
        return [camelCaseName, "ToJson"];
    }
    serializerFunctionLine(_t, name) {
        return ["function ", this.serializerFunctionName(name), "(value)"];
    }
    get moduleLine() {
        return undefined;
    }
    get castFunctionLines() {
        return ["function cast(val, typ)", "function uncast(val, typ)"];
    }
    get typeAnnotations() {
        return {
            any: "",
            anyArray: "",
            anyMap: "",
            string: "",
            stringArray: "",
            boolean: "",
            never: ""
        };
    }
    emitConvertModuleBody() {
        const converter = (t, name) => {
            const typeMap = this.typeMapTypeFor(t);
            this.emitBlock([this.deserializerFunctionLine(t, name), " "], "", () => {
                const parsedJson = this._jsOptions.rawType === "json" ? "JSON.parse(json)" : "json";
                if (!this._jsOptions.runtimeTypecheck) {
                    this.emitLine("return ", parsedJson, ";");
                }
                else {
                    this.emitLine("return cast(", parsedJson, ", ", typeMap, ");");
                }
            });
            this.ensureBlankLine();
            this.emitBlock([this.serializerFunctionLine(t, name), " "], "", () => {
                if (this._jsOptions.rawType === "json") {
                    if (!this._jsOptions.runtimeTypecheck) {
                        this.emitLine("return JSON.stringify(value);");
                    }
                    else {
                        this.emitLine("return JSON.stringify(uncast(value, ", typeMap, "), null, 2);");
                    }
                }
                else {
                    if (!this._jsOptions.runtimeTypecheck) {
                        this.emitLine("return value;");
                    }
                    else {
                        this.emitLine("return uncast(value, ", typeMap, ");");
                    }
                }
            });
        };
        switch (this._jsOptions.converters) {
            case Converters_1.ConvertersOptions.AllObjects:
                this.forEachObject("interposing", converter);
                break;
            default:
                this.forEachTopLevel("interposing", converter);
                break;
        }
    }
    emitConvertModuleHelpers() {
        if (this._jsOptions.runtimeTypecheck) {
            const { any: anyAnnotation, anyArray: anyArrayAnnotation, anyMap: anyMapAnnotation, string: stringAnnotation, stringArray: stringArrayAnnotation, never: neverAnnotation } = this.typeAnnotations;
            this.ensureBlankLine();
            this
                .emitMultiline(`function invalidValue(typ${anyAnnotation}, val${anyAnnotation}, key${anyAnnotation} = '')${neverAnnotation} {
    if (key) {
        throw Error(\`Invalid value for key \"\${key}\". Expected type \${JSON.stringify(typ)} but got \${JSON.stringify(val)}\`);
    }
    throw Error(\`Invalid value \${JSON.stringify(val)} for type \${JSON.stringify(typ)}\`, );
}

function jsonToJSProps(typ${anyAnnotation})${anyAnnotation} {
    if (typ.jsonToJS === undefined) {
        const map${anyAnnotation} = {};
        typ.props.forEach((p${anyAnnotation}) => map[p.json] = { key: p.js, typ: p.typ });
        typ.jsonToJS = map;
    }
    return typ.jsonToJS;
}

function jsToJSONProps(typ${anyAnnotation})${anyAnnotation} {
    if (typ.jsToJSON === undefined) {
        const map${anyAnnotation} = {};
        typ.props.forEach((p${anyAnnotation}) => map[p.js] = { key: p.json, typ: p.typ });
        typ.jsToJSON = map;
    }
    return typ.jsToJSON;
}

function transform(val${anyAnnotation}, typ${anyAnnotation}, getProps${anyAnnotation}, key${anyAnnotation} = '')${anyAnnotation} {
    function transformPrimitive(typ${stringAnnotation}, val${anyAnnotation})${anyAnnotation} {
        if (typeof typ === typeof val) return val;
        return invalidValue(typ, val, key);
    }

    function transformUnion(typs${anyArrayAnnotation}, val${anyAnnotation})${anyAnnotation} {
        // val must validate against one typ in typs
        const l = typs.length;
        for (let i = 0; i < l; i++) {
            const typ = typs[i];
            try {
                return transform(val, typ, getProps);
            } catch (_) {}
        }
        return invalidValue(typs, val);
    }

    function transformEnum(cases${stringArrayAnnotation}, val${anyAnnotation})${anyAnnotation} {
        if (cases.indexOf(val) !== -1) return val;
        return invalidValue(cases, val);
    }

    function transformArray(typ${anyAnnotation}, val${anyAnnotation})${anyAnnotation} {
        // val must be an array with no invalid elements
        if (!Array.isArray(val)) return invalidValue("array", val);
        return val.map(el => transform(el, typ, getProps));
    }

    function transformDate(val${anyAnnotation})${anyAnnotation} {
        if (val === null) {
            return null;
        }
        const d = new Date(val);
        if (isNaN(d.valueOf())) {
            return invalidValue("Date", val);
        }
        return d;
    }

    function transformObject(props${anyMapAnnotation}, additional${anyAnnotation}, val${anyAnnotation})${anyAnnotation} {
        if (val === null || typeof val !== "object" || Array.isArray(val)) {
            return invalidValue("object", val);
        }
        const result${anyAnnotation} = {};
        Object.getOwnPropertyNames(props).forEach(key => {
            const prop = props[key];
            const v = Object.prototype.hasOwnProperty.call(val, key) ? val[key] : undefined;
            result[prop.key] = transform(v, prop.typ, getProps, prop.key);
        });
        Object.getOwnPropertyNames(val).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(props, key)) {
                result[key] = ${this._jsOptions.runtimeTypecheckIgnoreUnknownProperties
                ? `val[key]`
                : `transform(val[key], additional, getProps, key)`};
            }
        });
        return result;
    }

    if (typ === "any") return val;
    if (typ === null) {
        if (val === null) return val;
        return invalidValue(typ, val);
    }
    if (typ === false) return invalidValue(typ, val);
    while (typeof typ === "object" && typ.ref !== undefined) {
        typ = typeMap[typ.ref];
    }
    if (Array.isArray(typ)) return transformEnum(typ, val);
    if (typeof typ === "object") {
        return typ.hasOwnProperty("unionMembers") ? transformUnion(typ.unionMembers, val)
            : typ.hasOwnProperty("arrayItems")    ? transformArray(typ.arrayItems, val)
            : typ.hasOwnProperty("props")         ? transformObject(getProps(typ), typ.additional, val)
            : invalidValue(typ, val);
    }
    // Numbers can be parsed by Date but shouldn't be.
    if (typ === Date && typeof val !== "number") return transformDate(val);
    return transformPrimitive(typ, val);
}

${this.castFunctionLines[0]} {
    return transform(val, typ, jsonToJSProps);
}

${this.castFunctionLines[1]} {
    return transform(val, typ, jsToJSONProps);
}

function a(typ${anyAnnotation}) {
    return { arrayItems: typ };
}

function u(...typs${anyArrayAnnotation}) {
    return { unionMembers: typs };
}

function o(props${anyArrayAnnotation}, additional${anyAnnotation}) {
    return { props, additional };
}

function m(additional${anyAnnotation}) {
    return { props: [], additional };
}

function r(name${stringAnnotation}) {
    return { ref: name };
}
`);
            this.emitTypeMap();
        }
    }
    emitConvertModule() {
        this.ensureBlankLine();
        this.emitMultiline(`// Converts JSON ${this._jsOptions.rawType === "json" ? "strings" : "types"} to/from your types`);
        if (this._jsOptions.runtimeTypecheck) {
            this.emitMultiline(`// and asserts the results${this._jsOptions.rawType === "json" ? " of JSON.parse" : ""} at runtime`);
        }
        const moduleLine = this.moduleLine;
        if (moduleLine === undefined) {
            this.emitConvertModuleBody();
        }
        else {
            this.emitBlock([moduleLine, " "], "", () => this.emitConvertModuleBody());
        }
    }
    emitTypes() {
        return;
    }
    emitUsageImportComment() {
        this.emitLine('//   const Convert = require("./file");');
    }
    emitUsageComments() {
        this.emitMultiline(`// To parse this data:
//`);
        this.emitUsageImportComment();
        this.emitLine("//");
        this.forEachTopLevel("none", (_t, name) => {
            const camelCaseName = Source_1.modifySource(Strings_1.camelCase, name);
            this.emitLine("//   const ", camelCaseName, " = Convert.to", name, "(json);");
        });
        if (this._jsOptions.runtimeTypecheck) {
            this.emitLine("//");
            this.emitLine("// These functions will throw an error if the JSON doesn't");
            this.emitLine("// match the expected interface, even if the JSON is valid.");
        }
    }
    emitModuleExports() {
        this.ensureBlankLine();
        this.emitBlock("module.exports = ", ";", () => {
            this.forEachTopLevel("none", (_, name) => {
                const serializer = this.serializerFunctionName(name);
                const deserializer = this.deserializerFunctionName(name);
                this.emitLine('"', serializer, '": ', serializer, ",");
                this.emitLine('"', deserializer, '": ', deserializer, ",");
            });
        });
    }
    emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }
        else {
            this.emitUsageComments();
        }
        this.emitTypes();
        this.emitConvertModule();
        this.emitConvertModuleHelpers();
        this.emitModuleExports();
    }
}
exports.JavaScriptRenderer = JavaScriptRenderer;
