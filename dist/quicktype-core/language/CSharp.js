"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Source_1 = require("../Source");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const Naming_1 = require("../Naming");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const TargetLanguage_1 = require("../TargetLanguage");
const RendererOptions_1 = require("../RendererOptions");
const Annotation_1 = require("../Annotation");
const Transformers_1 = require("../Transformers");
const Constraints_1 = require("../attributes/Constraints");
const unicode = require("@mark.probst/unicode-properties");
var AccessModifier;
(function (AccessModifier) {
    AccessModifier[AccessModifier["None"] = 0] = "None";
    AccessModifier[AccessModifier["Public"] = 1] = "Public";
    AccessModifier[AccessModifier["Internal"] = 2] = "Internal";
})(AccessModifier = exports.AccessModifier || (exports.AccessModifier = {}));
function noFollow(t) {
    return t;
}
function needTransformerForType(t) {
    if (t instanceof Type_1.UnionType) {
        const maybeNullable = TypeUtils_1.nullableFromUnion(t);
        if (maybeNullable === null)
            return "automatic";
        if (needTransformerForType(maybeNullable) === "manual")
            return "nullable";
        return "none";
    }
    if (t instanceof Type_1.ArrayType) {
        const itemsNeed = needTransformerForType(t.items);
        if (itemsNeed === "manual" || itemsNeed === "nullable")
            return "automatic";
        return "none";
    }
    if (t instanceof Type_1.EnumType)
        return "automatic";
    if (t.kind === "double")
        return Constraints_1.minMaxValueForType(t) !== undefined ? "manual" : "none";
    if (t.kind === "integer-string" || t.kind === "bool-string")
        return "manual";
    if (t.kind === "string") {
        return Constraints_1.minMaxLengthForType(t) !== undefined ? "manual" : "none";
    }
    return "none";
}
function alwaysApplyTransformation(xf) {
    const t = xf.targetType;
    if (t instanceof Type_1.EnumType)
        return true;
    if (t instanceof Type_1.UnionType)
        return TypeUtils_1.nullableFromUnion(t) === null;
    return false;
}
/**
 * The C# type for a given transformed string type.
 */
function csTypeForTransformedStringType(t) {
    switch (t.kind) {
        case "date-time":
            return "DateTimeOffset";
        case "uuid":
            return "Guid";
        case "uri":
            return "Uri";
        default:
            return Support_1.panic(`Transformed string type ${t.kind} not supported`);
    }
}
exports.cSharpOptions = {
    useList: new RendererOptions_1.EnumOption("array-type", "Use T[] or List<T>", [
        ["array", false],
        ["list", true],
    ]),
    dense: new RendererOptions_1.EnumOption("density", "Property density", [
        ["normal", false],
        ["dense", true],
    ], "normal", "secondary"),
    // FIXME: Do this via a configurable named eventually.
    namespace: new RendererOptions_1.StringOption("namespace", "Generated namespace", "NAME", "QuickType"),
    version: new RendererOptions_1.EnumOption("csharp-version", "C# version", [
        ["5", 5],
        ["6", 6],
    ], "6", "secondary"),
    virtual: new RendererOptions_1.BooleanOption("virtual", "Generate virtual properties", false),
    typeForAny: new RendererOptions_1.EnumOption("any-type", 'Type to use for "any"', [
        ["object", "object"],
        ["dynamic", "dynamic"],
    ], "object", "secondary"),
    useDecimal: new RendererOptions_1.EnumOption("number-type", "Type to use for numbers", [
        ["double", false],
        ["decimal", true],
    ], "double", "secondary"),
};
class CSharpTargetLanguage extends TargetLanguage_1.TargetLanguage {
    getOptions() {
        return [
            exports.cSharpOptions.namespace,
            exports.cSharpOptions.version,
            exports.cSharpOptions.dense,
            exports.cSharpOptions.useList,
            exports.cSharpOptions.useDecimal,
            exports.cSharpOptions.typeForAny,
            exports.cSharpOptions.virtual,
        ];
    }
    get stringTypeMapping() {
        const mapping = new Map();
        mapping.set("date", "date-time");
        mapping.set("time", "date-time");
        mapping.set("date-time", "date-time");
        mapping.set("uuid", "uuid");
        mapping.set("uri", "uri");
        mapping.set("integer-string", "integer-string");
        mapping.set("bool-string", "bool-string");
        return mapping;
    }
    get supportsUnionsWithBothNumberTypes() {
        return true;
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    needsTransformerForType(t) {
        const need = needTransformerForType(t);
        return need !== "none" && need !== "nullable";
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new CSharpRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.cSharpOptions, untypedOptionValues));
    }
}
exports.CSharpTargetLanguage = CSharpTargetLanguage;
const namingFunction = Naming_1.funPrefixNamer("namer", csNameStyle);
// FIXME: Make a Named?
const denseJsonPropertyName = "J";
const denseRequiredEnumName = "R";
const denseNullValueHandlingEnumName = "N";
function isStartCharacter(utf16Unit) {
    if (unicode.isAlphabetic(utf16Unit)) {
        return true;
    }
    return utf16Unit === 0x5f; // underscore
}
function isPartCharacter(utf16Unit) {
    const category = unicode.getCategory(utf16Unit);
    if (["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0) {
        return true;
    }
    return isStartCharacter(utf16Unit);
}
const legalizeName = Strings_1.utf16LegalizeCharacters(isPartCharacter);
function csNameStyle(original) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, Strings_1.firstUpperWordStyle, Strings_1.firstUpperWordStyle, Strings_1.firstUpperWordStyle, Strings_1.firstUpperWordStyle, "", isStartCharacter);
}
function isValueType(t) {
    if (t instanceof Type_1.UnionType) {
        return TypeUtils_1.nullableFromUnion(t) === null;
    }
    return ["integer", "double", "bool", "enum", "date-time", "uuid"].indexOf(t.kind) >= 0;
}
class CSharpRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _csOptions) {
        super(targetLanguage, renderContext);
        this._csOptions = _csOptions;
    }
    forbiddenNamesForGlobalNamespace() {
        return ["QuickType", "Type", "System", "Console", "Exception", "DateTimeOffset", "Guid", "Uri"];
    }
    forbiddenForObjectProperties(_, classNamed) {
        return {
            names: [
                classNamed,
                "ToString",
                "GetHashCode",
                "Finalize",
                "Equals",
                "GetType",
                "MemberwiseClone",
                "ReferenceEquals",
            ],
            includeGlobalForbidden: false,
        };
    }
    forbiddenForUnionMembers(_, unionNamed) {
        return { names: [unionNamed], includeGlobalForbidden: true };
    }
    makeNamedTypeNamer() {
        return namingFunction;
    }
    namerForObjectProperty() {
        return namingFunction;
    }
    makeUnionMemberNamer() {
        return namingFunction;
    }
    makeEnumCaseNamer() {
        return namingFunction;
    }
    unionNeedsName(u) {
        return TypeUtils_1.nullableFromUnion(u) === null;
    }
    namedTypeToNameForTopLevel(type) {
        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.
        return TypeUtils_1.directlyReachableSingleNamedType(type);
    }
    emitBlock(f, semicolon = false) {
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}", semicolon ? ";" : "");
    }
    get doubleType() {
        return this._csOptions.useDecimal ? "decimal" : "double";
    }
    csType(t, follow = Transformers_1.followTargetType, withIssues = false) {
        const actualType = follow(t);
        return TypeUtils_1.matchType(actualType, (_anyType) => Source_1.maybeAnnotated(withIssues, Annotation_1.anyTypeIssueAnnotation, this._csOptions.typeForAny), (_nullType) => Source_1.maybeAnnotated(withIssues, Annotation_1.nullTypeIssueAnnotation, this._csOptions.typeForAny), (_boolType) => "bool", (_integerType) => "long", (_doubleType) => this.doubleType, (_stringType) => "string", (arrayType) => {
            const itemsType = this.csType(arrayType.items, follow, withIssues);
            if (this._csOptions.useList) {
                return ["System.Collections.Generic.List<", itemsType, ">"];
            }
            else {
                return [itemsType, "[]"];
            }
        }, (classType) => this.nameForNamedType(classType), (mapType) => ["System.Collections.Generic.Dictionary<string, ", this.csType(mapType.values, follow, withIssues), ">"], (enumType) => this.nameForNamedType(enumType), (unionType) => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null)
                return this.nullableCSType(nullable, noFollow);
            return this.nameForNamedType(unionType);
        }, (transformedStringType) => csTypeForTransformedStringType(transformedStringType));
    }
    nullableCSType(t, follow = Transformers_1.followTargetType, withIssues = false) {
        t = Transformers_1.followTargetType(t);
        const csType = this.csType(t, follow, withIssues);
        if (isValueType(t)) {
            return [csType, "?"];
        }
        else {
            return csType;
        }
    }
    baseclassForType(_t) {
        return undefined;
    }
    emitType(description, accessModifier, declaration, name, baseclass, emitter) {
        switch (accessModifier) {
            case AccessModifier.Public:
                declaration = ["public ", declaration];
                break;
            case AccessModifier.Internal:
                declaration = ["internal ", declaration];
                break;
            default:
                break;
        }
        this.emitDescription(description);
        if (baseclass === undefined) {
            this.emitLine(declaration, " ", name);
        }
        else {
            this.emitLine(declaration, " ", name, " : ", baseclass);
        }
        this.emitBlock(emitter);
    }
    attributesForProperty(_property, _name, _c, _jsonName) {
        return undefined;
    }
    propertyDefinition(property, name, _c, _jsonName) {
        const t = property.type;
        const csType = property.isOptional
            ? this.nullableCSType(t, Transformers_1.followTargetType, true)
            : this.csType(t, Transformers_1.followTargetType, true);
        const propertyArray = ["public "];
        if (this._csOptions.virtual)
            propertyArray.push("virtual ");
        return [...propertyArray, csType, " ", name, " { get; set; }"];
    }
    emitDescriptionBlock(lines) {
        const start = "/// <summary>";
        if (this._csOptions.dense) {
            this.emitLine(start, lines.join("; "), "</summary>");
        }
        else {
            this.emitCommentLines(lines, "/// ", start, "/// </summary>");
        }
    }
    blankLinesBetweenAttributes() {
        return false;
    }
    emitClassDefinition(c, className) {
        this.emitType(this.descriptionForType(c), AccessModifier.Public, "partial class", className, this.baseclassForType(c), () => {
            if (c.getProperties().size === 0)
                return;
            const blankLines = this.blankLinesBetweenAttributes() ? "interposing" : "none";
            let columns = [];
            let isFirstProperty = true;
            let previousDescription = undefined;
            this.forEachClassProperty(c, blankLines, (name, jsonName, p) => {
                const attributes = this.attributesForProperty(p, name, c, jsonName);
                const description = this.descriptionForClassProperty(c, jsonName);
                const property = this.propertyDefinition(p, name, c, jsonName);
                if (attributes === undefined) {
                    if (
                    // Descriptions should be preceded by an empty line
                    (!isFirstProperty && description !== undefined) ||
                        // If the previous property has a description, leave an empty line
                        previousDescription !== undefined) {
                        this.ensureBlankLine();
                    }
                    this.emitDescription(description);
                    this.emitLine(property);
                }
                else if (this._csOptions.dense && attributes.length > 0) {
                    const comment = description === undefined ? "" : ` // ${description.join("; ")}`;
                    columns.push([attributes, " ", property, comment]);
                }
                else {
                    this.emitDescription(description);
                    for (const attribute of attributes) {
                        this.emitLine(attribute);
                    }
                    this.emitLine(property);
                }
                isFirstProperty = false;
                previousDescription = description;
            });
            if (columns.length > 0) {
                this.emitTable(columns);
            }
        });
    }
    emitUnionDefinition(u, unionName) {
        const nonNulls = TypeUtils_1.removeNullFromUnion(u, true)[1];
        this.emitType(this.descriptionForType(u), AccessModifier.Public, "partial struct", unionName, this.baseclassForType(u), () => {
            this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                const csType = this.nullableCSType(t);
                this.emitLine("public ", csType, " ", fieldName, ";");
            });
            this.ensureBlankLine();
            const nullTests = Array.from(nonNulls).map((t) => [
                this.nameForUnionMember(u, t),
                " == null",
            ]);
            this.ensureBlankLine();
            this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                const csType = this.csType(t);
                this.emitExpressionMember(["public static implicit operator ", unionName, "(", csType, " ", fieldName, ")"], ["new ", unionName, " { ", fieldName, " = ", fieldName, " }"]);
            });
            if (u.findMember("null") === undefined)
                return;
            this.emitExpressionMember("public bool IsNull", collection_utils_1.arrayIntercalate(" && ", nullTests), true);
        });
    }
    emitEnumDefinition(e, enumName) {
        const caseNames = [];
        this.forEachEnumCase(e, "none", (name) => {
            if (caseNames.length > 0)
                caseNames.push(", ");
            caseNames.push(name);
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("public enum ", enumName, " { ", caseNames, " };");
    }
    emitExpressionMember(declare, define, isProperty = false) {
        if (this._csOptions.version === 5) {
            this.emitLine(declare);
            this.emitBlock(() => {
                const stmt = ["return ", define, ";"];
                if (isProperty) {
                    this.emitLine("get");
                    this.emitBlock(() => this.emitLine(stmt));
                }
                else {
                    this.emitLine(stmt);
                }
            });
        }
        else {
            this.emitLine(declare, " => ", define, ";");
        }
    }
    emitTypeSwitch(types, condition, withBlock, withReturn, f) {
        Support_1.assert(!withReturn || withBlock, "Can only have return with block");
        for (const t of types) {
            this.emitLine("if (", condition(t), ")");
            if (withBlock) {
                this.emitBlock(() => {
                    f(t);
                    if (withReturn) {
                        this.emitLine("return;");
                    }
                });
            }
            else {
                this.indent(() => f(t));
            }
        }
    }
    emitUsing(ns) {
        this.emitLine("using ", ns, ";");
    }
    emitUsings() {
        for (const ns of ["System", "System.Collections.Generic"]) {
            this.emitUsing(ns);
        }
    }
    emitRequiredHelpers() {
        return;
    }
    emitTypesAndSupport() {
        this.forEachObject("leading-and-interposing", (c, name) => this.emitClassDefinition(c, name));
        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnionDefinition(u, name));
        this.emitRequiredHelpers();
    }
    emitDefaultLeadingComments() {
        return;
    }
    needNamespace() {
        return true;
    }
    emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }
        else {
            this.emitDefaultLeadingComments();
        }
        this.ensureBlankLine();
        if (this.needNamespace()) {
            this.emitLine("namespace ", this._csOptions.namespace);
            this.emitBlock(() => {
                this.emitUsings();
                this.emitTypesAndSupport();
            });
        }
        else {
            this.emitUsings();
            this.emitTypesAndSupport();
        }
    }
}
exports.CSharpRenderer = CSharpRenderer;
exports.newtonsoftCSharpOptions = Object.assign({}, exports.cSharpOptions, {
    features: new RendererOptions_1.EnumOption("features", "Output features", [
        ["complete", { namespaces: true, helpers: true, attributes: true }],
        ["attributes-only", { namespaces: true, helpers: false, attributes: true }],
        ["just-types-and-namespace", { namespaces: true, helpers: false, attributes: false }],
        ["just-types", { namespaces: true, helpers: false, attributes: false }],
    ]),
    baseclass: new RendererOptions_1.EnumOption("base-class", "Base class", [
        ["EntityData", "EntityData"],
        ["Object", undefined],
    ], "Object", "secondary"),
    checkRequired: new RendererOptions_1.BooleanOption("check-required", "Fail if required properties are missing", false),
});
class NewtonsoftCSharpTargetLanguage extends CSharpTargetLanguage {
    constructor() {
        super("C#", ["cs", "csharp"], "cs");
    }
    getOptions() {
        return [
            exports.newtonsoftCSharpOptions.namespace,
            exports.newtonsoftCSharpOptions.version,
            exports.newtonsoftCSharpOptions.dense,
            exports.newtonsoftCSharpOptions.useList,
            exports.newtonsoftCSharpOptions.useDecimal,
            exports.newtonsoftCSharpOptions.features,
            exports.newtonsoftCSharpOptions.checkRequired,
            exports.newtonsoftCSharpOptions.typeForAny,
            exports.newtonsoftCSharpOptions.baseclass,
            exports.newtonsoftCSharpOptions.virtual,
        ];
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new NewtonsoftCSharpRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.newtonsoftCSharpOptions, untypedOptionValues));
    }
}
exports.NewtonsoftCSharpTargetLanguage = NewtonsoftCSharpTargetLanguage;
class NewtonsoftCSharpRenderer extends CSharpRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext, _options);
        this._options = _options;
        this._enumExtensionsNames = new Map();
        this._needHelpers = _options.features.helpers;
        this._needAttributes = _options.features.attributes;
        this._needNamespaces = _options.features.namespaces;
    }
    forbiddenNamesForGlobalNamespace() {
        const forbidden = [
            "Converter",
            "JsonConverter",
            "JsonSerializer",
            "JsonWriter",
            "JsonToken",
            "Serialize",
            "Newtonsoft",
            "MetadataPropertyHandling",
            "DateParseHandling",
            "FromJson",
            "Required",
        ];
        if (this._options.dense) {
            forbidden.push("J", "R", "N");
        }
        if (this._options.baseclass !== undefined) {
            forbidden.push(this._options.baseclass);
        }
        return super.forbiddenNamesForGlobalNamespace().concat(forbidden);
    }
    forbiddenForObjectProperties(c, className) {
        const result = super.forbiddenForObjectProperties(c, className);
        result.names = result.names.concat(["ToJson", "FromJson", "Required"]);
        return result;
    }
    makeNameForTransformation(xf, typeName) {
        if (typeName === undefined) {
            let xfer = xf.transformer;
            if (xfer instanceof Transformers_1.DecodingTransformer && xfer.consumer !== undefined) {
                xfer = xfer.consumer;
            }
            return new Naming_1.SimpleName([`${xfer.kind}_converter`], namingFunction, ConvenienceRenderer_1.inferredNameOrder + 30);
        }
        return new Naming_1.DependencyName(namingFunction, typeName.order + 30, (lookup) => `${lookup(typeName)}_converter`);
    }
    makeNamedTypeDependencyNames(t, name) {
        if (!(t instanceof Type_1.EnumType))
            return [];
        const extensionsName = new Naming_1.DependencyName(namingFunction, name.order + 30, (lookup) => `${lookup(name)}_extensions`);
        this._enumExtensionsNames.set(name, extensionsName);
        return [extensionsName];
    }
    emitUsings() {
        // FIXME: We need System.Collections.Generic whenever we have maps or use List.
        if (!this._needAttributes && !this._needHelpers)
            return;
        super.emitUsings();
        this.ensureBlankLine();
        for (const ns of ["System.Globalization", "Newtonsoft.Json", "Newtonsoft.Json.Converters"]) {
            this.emitUsing(ns);
        }
        if (this._options.dense) {
            this.emitUsing([denseJsonPropertyName, " = Newtonsoft.Json.JsonPropertyAttribute"]);
            this.emitUsing([denseRequiredEnumName, " = Newtonsoft.Json.Required"]);
            this.emitUsing([denseNullValueHandlingEnumName, " = Newtonsoft.Json.NullValueHandling"]);
        }
        if (this._options.baseclass === "EntityData") {
            this.emitUsing("Microsoft.Azure.Mobile.Server");
        }
    }
    baseclassForType(_t) {
        return this._options.baseclass;
    }
    emitDefaultLeadingComments() {
        if (!this._needHelpers)
            return;
        this.emitLine("// <auto-generated />");
        this.emitLine("//");
        this.emitLine("// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do", this.topLevels.size === 1 ? "" : " one of these", ":");
        this.emitLine("//");
        this.emitLine("//    using ", this._options.namespace, ";");
        this.emitLine("//");
        this.forEachTopLevel("none", (t, topLevelName) => {
            let rhs;
            if (t instanceof Type_1.EnumType) {
                rhs = ["JsonConvert.DeserializeObject<", topLevelName, ">(jsonString)"];
            }
            else {
                rhs = [topLevelName, ".FromJson(jsonString)"];
            }
            this.emitLine("//    var ", Source_1.modifySource(Strings_1.camelCase, topLevelName), " = ", rhs, ";");
        });
    }
    converterForType(t) {
        let xf = Transformers_1.transformationForType(t);
        if (xf === undefined && t instanceof Type_1.UnionType) {
            const maybeNullable = TypeUtils_1.nullableFromUnion(t);
            if (maybeNullable !== null) {
                t = maybeNullable;
                xf = Transformers_1.transformationForType(t);
            }
        }
        if (xf === undefined)
            return undefined;
        if (alwaysApplyTransformation(xf))
            return undefined;
        return Support_1.defined(this.nameForTransformation(t));
    }
    attributesForProperty(property, _name, _c, jsonName) {
        if (!this._needAttributes)
            return undefined;
        const attributes = [];
        const jsonProperty = this._options.dense ? denseJsonPropertyName : "JsonProperty";
        const escapedName = Strings_1.utf16StringEscape(jsonName);
        const isNullable = Transformers_1.followTargetType(property.type).isNullable;
        const isOptional = property.isOptional;
        const requiredClass = this._options.dense ? "R" : "Required";
        const nullValueHandlingClass = this._options.dense ? "N" : "NullValueHandling";
        const nullValueHandling = isOptional && !isNullable ? [", NullValueHandling = ", nullValueHandlingClass, ".Ignore"] : [];
        let required;
        if (!this._options.checkRequired || (isOptional && isNullable)) {
            required = [nullValueHandling];
        }
        else if (isOptional && !isNullable) {
            required = [", Required = ", requiredClass, ".DisallowNull", nullValueHandling];
        }
        else if (!isOptional && isNullable) {
            required = [", Required = ", requiredClass, ".AllowNull"];
        }
        else {
            required = [", Required = ", requiredClass, ".Always", nullValueHandling];
        }
        attributes.push(["[", jsonProperty, '("', escapedName, '"', required, ")]"]);
        const converter = this.converterForType(property.type);
        if (converter !== undefined) {
            attributes.push(["[JsonConverter(typeof(", converter, "))]"]);
        }
        return attributes;
    }
    blankLinesBetweenAttributes() {
        return this._needAttributes && !this._options.dense;
    }
    // The "this" type can't be `dynamic`, so we have to force it to `object`.
    topLevelResultType(t) {
        return t.kind === "any" || t.kind === "none" ? "object" : this.csType(t);
    }
    emitFromJsonForTopLevel(t, name) {
        if (t instanceof Type_1.EnumType)
            return;
        let partial;
        let typeKind;
        const definedType = this.namedTypeToNameForTopLevel(t);
        if (definedType !== undefined) {
            partial = "partial ";
            typeKind = definedType instanceof Type_1.ClassType ? "class" : "struct";
        }
        else {
            partial = "";
            typeKind = "class";
        }
        const csType = this.topLevelResultType(t);
        this.emitType(undefined, AccessModifier.Public, [partial, typeKind], name, this.baseclassForType(t), () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(["public static ", csType, " FromJson(string json)"], ["JsonConvert.DeserializeObject<", csType, ">(json, ", this._options.namespace, ".Converter.Settings)"]);
        });
    }
    emitDecoderSwitch(emitBody) {
        this.emitLine("switch (reader.TokenType)");
        this.emitBlock(emitBody);
    }
    emitTokenCase(tokenType) {
        this.emitLine("case JsonToken.", tokenType, ":");
    }
    emitThrow(message) {
        this.emitLine("throw new Exception(", message, ");");
    }
    deserializeTypeCode(typeName) {
        return ["serializer.Deserialize<", typeName, ">(reader)"];
    }
    serializeValueCode(value) {
        return ["serializer.Serialize(writer, ", value, ")"];
    }
    emitSerializeClass() {
        // FIXME: Make Serialize a Named
        this.emitType(undefined, AccessModifier.Public, "static class", "Serialize", undefined, () => {
            // Sometimes multiple top-levels will resolve to the same type, so we have to take care
            // not to emit more than one extension method for the same type.
            const seenTypes = new Set();
            this.forEachTopLevel("none", (t) => {
                // FIXME: Make ToJson a Named
                if (!seenTypes.has(t)) {
                    seenTypes.add(t);
                    this.emitExpressionMember(["public static string ToJson(this ", this.topLevelResultType(t), " self)"], ["JsonConvert.SerializeObject(self, ", this._options.namespace, ".Converter.Settings)"]);
                }
            });
        });
    }
    emitCanConvert(expr) {
        this.emitExpressionMember("public override bool CanConvert(Type t)", expr);
    }
    emitReadJson(emitBody) {
        this.emitLine("public override object ReadJson(JsonReader reader, Type t, object existingValue, JsonSerializer serializer)");
        this.emitBlock(emitBody);
    }
    emitWriteJson(variable, emitBody) {
        this.emitLine("public override void WriteJson(JsonWriter writer, object ", variable, ", JsonSerializer serializer)");
        this.emitBlock(emitBody);
    }
    converterObject(converterName) {
        // FIXME: Get a singleton
        return [converterName, ".Singleton"];
    }
    emitConverterClass() {
        // FIXME: Make Converter a Named
        const converterName = ["Converter"];
        this.emitType(undefined, AccessModifier.Internal, "static class", converterName, undefined, () => {
            this.emitLine("public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings");
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
                this.emitLine("Converters =");
                this.emitLine("{");
                this.indent(() => {
                    for (const [t, converter] of this.typesWithNamedTransformations) {
                        if (alwaysApplyTransformation(Support_1.defined(Transformers_1.transformationForType(t)))) {
                            this.emitLine(this.converterObject(converter), ",");
                        }
                    }
                    this.emitLine("new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }");
                });
                this.emitLine(`},`);
            }, true);
        });
    }
    emitDecoderTransformerCase(tokenCases, variableName, xfer, targetType, emitFinish) {
        if (xfer === undefined)
            return;
        for (const tokenCase of tokenCases) {
            this.emitTokenCase(tokenCase);
        }
        this.indent(() => {
            const allHandled = this.emitDecodeTransformer(xfer, targetType, emitFinish, variableName);
            if (!allHandled) {
                this.emitLine("break;");
            }
        });
    }
    emitConsume(value, consumer, targetType, emitFinish) {
        if (consumer === undefined) {
            emitFinish(value);
            return true;
        }
        else {
            return this.emitTransformer(value, consumer, targetType, emitFinish);
        }
    }
    emitDecodeTransformer(xfer, targetType, emitFinish, variableName = "value") {
        if (xfer instanceof Transformers_1.DecodingTransformer) {
            const source = xfer.sourceType;
            const converter = this.converterForType(targetType);
            if (converter !== undefined) {
                const typeSource = this.csType(targetType);
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine("var ", variableName, " = (", typeSource, ")converter.ReadJson(reader, typeof(", typeSource, "), null, serializer);");
            }
            else if (source.kind !== "null") {
                let output = targetType.kind === "double" ? targetType : source;
                this.emitLine("var ", variableName, " = ", this.deserializeTypeCode(this.csType(output)), ";");
            }
            return this.emitConsume(variableName, xfer.consumer, targetType, emitFinish);
        }
        else if (xfer instanceof Transformers_1.ArrayDecodingTransformer) {
            // FIXME: Consume StartArray
            if (!(targetType instanceof Type_1.ArrayType)) {
                return Support_1.panic("Array decoding must produce an array type");
            }
            // FIXME: handle EOF
            this.emitLine("reader.Read();");
            this.emitLine("var ", variableName, " = new List<", this.csType(targetType.items), ">();");
            this.emitLine("while (reader.TokenType != JsonToken.EndArray)");
            this.emitBlock(() => {
                this.emitDecodeTransformer(xfer.itemTransformer, xfer.itemTargetType, (v) => this.emitLine(variableName, ".Add(", v, ");"), "arrayItem");
                // FIXME: handle EOF
                this.emitLine("reader.Read();");
            });
            let result = variableName;
            if (!this._options.useList) {
                result = [result, ".ToArray()"];
            }
            emitFinish(result);
            return true;
        }
        else if (xfer instanceof Transformers_1.DecodingChoiceTransformer) {
            this.emitDecoderSwitch(() => {
                const nullTransformer = xfer.nullTransformer;
                if (nullTransformer !== undefined) {
                    this.emitTokenCase("Null");
                    this.indent(() => {
                        const allHandled = this.emitDecodeTransformer(nullTransformer, targetType, emitFinish, "null");
                        if (!allHandled) {
                            this.emitLine("break");
                        }
                    });
                }
                this.emitDecoderTransformerCase(["Integer"], "integerValue", xfer.integerTransformer, targetType, emitFinish);
                this.emitDecoderTransformerCase(xfer.integerTransformer === undefined ? ["Integer", "Float"] : ["Float"], "doubleValue", xfer.doubleTransformer, targetType, emitFinish);
                this.emitDecoderTransformerCase(["Boolean"], "boolValue", xfer.boolTransformer, targetType, emitFinish);
                this.emitDecoderTransformerCase(["String", "Date"], "stringValue", xfer.stringTransformer, targetType, emitFinish);
                this.emitDecoderTransformerCase(["StartObject"], "objectValue", xfer.objectTransformer, targetType, emitFinish);
                this.emitDecoderTransformerCase(["StartArray"], "arrayValue", xfer.arrayTransformer, targetType, emitFinish);
            });
            return false;
        }
        else {
            return Support_1.panic("Unknown transformer");
        }
    }
    stringCaseValue(t, stringCase) {
        if (t.kind === "string") {
            return ['"', Strings_1.utf16StringEscape(stringCase), '"'];
        }
        else if (t instanceof Type_1.EnumType) {
            return [this.nameForNamedType(t), ".", this.nameForEnumCase(t, stringCase)];
        }
        return Support_1.panic(`Type ${t.kind} does not have string cases`);
    }
    emitTransformer(variable, xfer, targetType, emitFinish) {
        function directTargetType(continuation) {
            if (continuation === undefined) {
                return targetType;
            }
            return Transformers_1.followTargetType(continuation.sourceType);
        }
        if (xfer instanceof Transformers_1.ChoiceTransformer) {
            const caseXfers = xfer.transformers;
            if (caseXfers.length > 1 && caseXfers.every((caseXfer) => caseXfer instanceof Transformers_1.StringMatchTransformer)) {
                this.emitLine("switch (", variable, ")");
                this.emitBlock(() => {
                    for (const caseXfer of caseXfers) {
                        const matchXfer = caseXfer;
                        const value = this.stringCaseValue(Transformers_1.followTargetType(matchXfer.sourceType), matchXfer.stringCase);
                        this.emitLine("case ", value, ":");
                        this.indent(() => {
                            const allDone = this.emitTransformer(variable, matchXfer.transformer, targetType, emitFinish);
                            if (!allDone) {
                                this.emitLine("break;");
                            }
                        });
                    }
                });
                // FIXME: Can we check for exhaustiveness?  For enums it should be easy.
                return false;
            }
            else {
                for (const caseXfer of caseXfers) {
                    this.emitTransformer(variable, caseXfer, targetType, emitFinish);
                }
            }
        }
        else if (xfer instanceof Transformers_1.UnionMemberMatchTransformer) {
            const memberType = xfer.memberType;
            const maybeNullable = TypeUtils_1.nullableFromUnion(xfer.sourceType);
            let test;
            let member;
            if (maybeNullable !== null) {
                if (memberType.kind === "null") {
                    test = [variable, " == null"];
                    member = "null";
                }
                else {
                    test = [variable, " != null"];
                    member = variable;
                }
            }
            else if (memberType.kind === "null") {
                test = [variable, ".IsNull"];
                member = "null";
            }
            else {
                const memberName = this.nameForUnionMember(xfer.sourceType, memberType);
                member = [variable, ".", memberName];
                test = [member, " != null"];
            }
            if (memberType.kind !== "null" && isValueType(memberType)) {
                member = [member, ".Value"];
            }
            this.emitLine("if (", test, ")");
            this.emitBlock(() => this.emitTransformer(member, xfer.transformer, targetType, emitFinish));
        }
        else if (xfer instanceof Transformers_1.StringMatchTransformer) {
            const value = this.stringCaseValue(Transformers_1.followTargetType(xfer.sourceType), xfer.stringCase);
            this.emitLine("if (", variable, " == ", value, ")");
            this.emitBlock(() => this.emitTransformer(variable, xfer.transformer, targetType, emitFinish));
        }
        else if (xfer instanceof Transformers_1.EncodingTransformer) {
            const converter = this.converterForType(xfer.sourceType);
            if (converter !== undefined) {
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine("converter.WriteJson(writer, ", variable, ", serializer);");
            }
            else {
                this.emitLine(this.serializeValueCode(variable), ";");
            }
            emitFinish([]);
            return true;
        }
        else if (xfer instanceof Transformers_1.ArrayEncodingTransformer) {
            this.emitLine("writer.WriteStartArray();");
            const itemVariable = "arrayItem";
            this.emitLine("foreach (var ", itemVariable, " in ", variable, ")");
            this.emitBlock(() => {
                this.emitTransformer(itemVariable, xfer.itemTransformer, xfer.itemTargetType, () => {
                    return;
                });
            });
            this.emitLine("writer.WriteEndArray();");
            emitFinish([]);
            return true;
        }
        else if (xfer instanceof Transformers_1.ParseStringTransformer) {
            const immediateTargetType = xfer.consumer === undefined ? targetType : xfer.consumer.sourceType;
            switch (immediateTargetType.kind) {
                case "date-time":
                    this.emitLine("DateTimeOffset dt;");
                    this.emitLine("if (DateTimeOffset.TryParse(", variable, ", out dt))");
                    this.emitBlock(() => this.emitConsume("dt", xfer.consumer, targetType, emitFinish));
                    break;
                case "uuid":
                    this.emitLine("Guid guid;");
                    this.emitLine("if (Guid.TryParse(", variable, ", out guid))");
                    this.emitBlock(() => this.emitConsume("guid", xfer.consumer, targetType, emitFinish));
                    break;
                case "uri":
                    this.emitLine("try");
                    this.emitBlock(() => {
                        this.emitLine("var uri = new Uri(", variable, ");");
                        this.emitConsume("uri", xfer.consumer, targetType, emitFinish);
                    });
                    this.emitLine("catch (UriFormatException) {}");
                    break;
                case "integer":
                    this.emitLine("long l;");
                    this.emitLine("if (Int64.TryParse(", variable, ", out l))");
                    this.emitBlock(() => this.emitConsume("l", xfer.consumer, targetType, emitFinish));
                    break;
                case "bool":
                    this.emitLine("bool b;");
                    this.emitLine("if (Boolean.TryParse(", variable, ", out b))");
                    this.emitBlock(() => this.emitConsume("b", xfer.consumer, targetType, emitFinish));
                    break;
                default:
                    return Support_1.panic(`Parsing string to ${immediateTargetType.kind} not supported`);
            }
        }
        else if (xfer instanceof Transformers_1.StringifyTransformer) {
            switch (xfer.sourceType.kind) {
                case "date-time":
                    return this.emitConsume([variable, '.ToString("o", System.Globalization.CultureInfo.InvariantCulture)'], xfer.consumer, targetType, emitFinish);
                case "uuid":
                    return this.emitConsume([variable, '.ToString("D", System.Globalization.CultureInfo.InvariantCulture)'], xfer.consumer, targetType, emitFinish);
                case "integer":
                case "uri":
                    return this.emitConsume([variable, ".ToString()"], xfer.consumer, targetType, emitFinish);
                case "bool":
                    this.emitLine("var boolString = ", variable, ' ? "true" : "false";');
                    return this.emitConsume("boolString", xfer.consumer, targetType, emitFinish);
                default:
                    return Support_1.panic(`Stringifying ${xfer.sourceType.kind} not supported`);
            }
        }
        else if (xfer instanceof Transformers_1.StringProducerTransformer) {
            const value = this.stringCaseValue(directTargetType(xfer.consumer), xfer.result);
            return this.emitConsume(value, xfer.consumer, targetType, emitFinish);
        }
        else if (xfer instanceof Transformers_1.MinMaxLengthCheckTransformer) {
            const min = xfer.minLength;
            const max = xfer.maxLength;
            const conditions = [];
            if (min !== undefined) {
                conditions.push([variable, ".Length >= ", min.toString()]);
            }
            if (max !== undefined) {
                conditions.push([variable, ".Length <= ", max.toString()]);
            }
            this.emitLine("if (", collection_utils_1.arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        }
        else if (xfer instanceof Transformers_1.MinMaxValueTransformer) {
            const min = xfer.minimum;
            const max = xfer.maximum;
            const conditions = [];
            if (min !== undefined) {
                conditions.push([variable, " >= ", min.toString()]);
            }
            if (max !== undefined) {
                conditions.push([variable, " <= ", max.toString()]);
            }
            this.emitLine("if (", collection_utils_1.arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        }
        else if (xfer instanceof Transformers_1.UnionInstantiationTransformer) {
            if (!(targetType instanceof Type_1.UnionType)) {
                return Support_1.panic("Union instantiation transformer must produce a union type");
            }
            const maybeNullable = TypeUtils_1.nullableFromUnion(targetType);
            if (maybeNullable !== null) {
                emitFinish(variable);
            }
            else {
                const unionName = this.nameForNamedType(targetType);
                let initializer;
                if (xfer.sourceType.kind === "null") {
                    initializer = " ";
                }
                else {
                    const memberName = this.nameForUnionMember(targetType, xfer.sourceType);
                    initializer = [" ", memberName, " = ", variable, " "];
                }
                emitFinish(["new ", unionName, " {", initializer, "}"]);
            }
            return true;
        }
        else {
            return Support_1.panic("Unknown transformer");
        }
        return false;
    }
    emitTransformation(converterName, t) {
        const xf = Support_1.defined(Transformers_1.transformationForType(t));
        const reverse = xf.reverse;
        const targetType = xf.targetType;
        const xfer = xf.transformer;
        this.emitType(undefined, AccessModifier.Internal, "class", converterName, "JsonConverter", () => {
            const csType = this.csType(targetType);
            let canConvertExpr = ["t == typeof(", csType, ")"];
            const haveNullable = isValueType(targetType);
            if (haveNullable) {
                canConvertExpr = [canConvertExpr, " || t == typeof(", csType, "?)"];
            }
            this.emitCanConvert(canConvertExpr);
            this.ensureBlankLine();
            this.emitReadJson(() => {
                // FIXME: It's unsatisfying that we need this.  The reason is that we not
                // only match T, but also T?.  If we didn't, then the T in T? would not be
                // deserialized with our converter but with the default one.  Can we check
                // whether the type is a nullable?
                // FIXME: This could duplicate one of the cases handled below in
                // `emitDecodeTransformer`.
                if (haveNullable && !(targetType instanceof Type_1.UnionType)) {
                    this.emitLine("if (reader.TokenType == JsonToken.Null) return null;");
                }
                const allHandled = this.emitDecodeTransformer(xfer, targetType, (v) => this.emitLine("return ", v, ";"));
                if (!allHandled) {
                    this.emitThrow(['"Cannot unmarshal type ', csType, '"']);
                }
            });
            this.ensureBlankLine();
            this.emitWriteJson("untypedValue", () => {
                // FIXME: See above.
                if (haveNullable && !(targetType instanceof Type_1.UnionType)) {
                    this.emitLine("if (untypedValue == null)");
                    this.emitBlock(() => {
                        this.emitLine("serializer.Serialize(writer, null);");
                        this.emitLine("return;");
                    });
                }
                this.emitLine("var value = (", csType, ")untypedValue;");
                const allHandled = this.emitTransformer("value", reverse.transformer, reverse.targetType, () => this.emitLine("return;"));
                if (!allHandled) {
                    this.emitThrow(['"Cannot marshal type ', csType, '"']);
                }
            });
            this.ensureBlankLine();
            this.emitLine("public static readonly ", converterName, " Singleton = new ", converterName, "();");
        });
    }
    emitRequiredHelpers() {
        if (this._needHelpers) {
            this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitFromJsonForTopLevel(t, n));
            this.ensureBlankLine();
            this.emitSerializeClass();
        }
        if (this._needHelpers || (this._needAttributes && (this.haveNamedUnions || this.haveEnums))) {
            this.ensureBlankLine();
            this.emitConverterClass();
            this.forEachTransformation("leading-and-interposing", (n, t) => this.emitTransformation(n, t));
        }
    }
    needNamespace() {
        return this._needNamespaces;
    }
}
exports.NewtonsoftCSharpRenderer = NewtonsoftCSharpRenderer;
