"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Annotation_1 = require("../Annotation");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Naming_1 = require("../Naming");
const RendererOptions_1 = require("../RendererOptions");
const Source_1 = require("../Source");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const TargetLanguage_1 = require("../TargetLanguage");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
var Framework;
(function (Framework) {
    Framework[Framework["None"] = 0] = "None";
    Framework[Framework["Jackson"] = 1] = "Jackson";
    Framework[Framework["Klaxon"] = 2] = "Klaxon";
    Framework[Framework["KotlinX"] = 3] = "KotlinX";
})(Framework = exports.Framework || (exports.Framework = {}));
exports.kotlinOptions = {
    framework: new RendererOptions_1.EnumOption("framework", "Serialization framework", [["just-types", Framework.None], ["jackson", Framework.Jackson], ["klaxon", Framework.Klaxon], ["kotlinx", Framework.KotlinX]], "klaxon"),
    packageName: new RendererOptions_1.StringOption("package", "Package", "PACKAGE", "quicktype")
};
class KotlinTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Kotlin", ["kotlin"], "kt");
    }
    getOptions() {
        return [exports.kotlinOptions.framework, exports.kotlinOptions.packageName];
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    get supportsUnionsWithBothNumberTypes() {
        return true;
    }
    makeRenderer(renderContext, untypedOptionValues) {
        const options = RendererOptions_1.getOptionValues(exports.kotlinOptions, untypedOptionValues);
        switch (options.framework) {
            case Framework.None:
                return new KotlinRenderer(this, renderContext, options);
            case Framework.Jackson:
                return new KotlinJacksonRenderer(this, renderContext, options);
            case Framework.Klaxon:
                return new KotlinKlaxonRenderer(this, renderContext, options);
            case Framework.KotlinX:
                return new KotlinXRenderer(this, renderContext, options);
            default:
                return Support_1.assertNever(options.framework);
        }
    }
}
exports.KotlinTargetLanguage = KotlinTargetLanguage;
const keywords = [
    "package",
    "as",
    "typealias",
    "class",
    "this",
    "super",
    "val",
    "var",
    "fun",
    "for",
    "null",
    "true",
    "false",
    "is",
    "in",
    "throw",
    "return",
    "break",
    "continue",
    "object",
    "if",
    "try",
    "else",
    "while",
    "do",
    "when",
    "interface",
    "typeof",
    "klaxon",
    "toJson",
    "Any",
    "Boolean",
    "Double",
    "Float",
    "Long",
    "Int",
    "Short",
    "System",
    "Byte",
    "String",
    "Array",
    "List",
    "Map",
    "Enum",
    "Class",
    "JsonObject",
    "JsonValue",
    "Converter",
    "Klaxon"
];
function isPartCharacter(codePoint) {
    return Strings_1.isLetterOrUnderscore(codePoint) || Strings_1.isNumeric(codePoint);
}
function isStartCharacter(codePoint) {
    return isPartCharacter(codePoint) && !Strings_1.isDigit(codePoint);
}
const legalizeName = Strings_1.legalizeCharacters(isPartCharacter);
function kotlinNameStyle(isUpper, original) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, isUpper ? Strings_1.firstUpperWordStyle : Strings_1.allLowerWordStyle, Strings_1.firstUpperWordStyle, isUpper ? Strings_1.allUpperWordStyle : Strings_1.allLowerWordStyle, Strings_1.allUpperWordStyle, "", isStartCharacter);
}
function unicodeEscape(codePoint) {
    return "\\u" + Strings_1.intToHex(codePoint, 4);
}
const _stringEscape = Strings_1.utf32ConcatMap(Strings_1.escapeNonPrintableMapper(Strings_1.isPrintable, unicodeEscape));
function stringEscape(s) {
    // "$this" is a template string in Kotlin so we have to escape $
    return _stringEscape(s).replace(/\$/g, "\\$");
}
const upperNamingFunction = Naming_1.funPrefixNamer("upper", s => kotlinNameStyle(true, s));
const lowerNamingFunction = Naming_1.funPrefixNamer("lower", s => kotlinNameStyle(false, s));
class KotlinRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _kotlinOptions) {
        super(targetLanguage, renderContext);
        this._kotlinOptions = _kotlinOptions;
    }
    forbiddenNamesForGlobalNamespace() {
        return keywords;
    }
    forbiddenForObjectProperties(_o, _classNamed) {
        return { names: [], includeGlobalForbidden: true };
    }
    forbiddenForEnumCases(_e, _enumName) {
        return { names: [], includeGlobalForbidden: true };
    }
    forbiddenForUnionMembers(_u, _unionName) {
        return { names: [], includeGlobalForbidden: false };
    }
    topLevelNameStyle(rawName) {
        return kotlinNameStyle(true, rawName);
    }
    makeNamedTypeNamer() {
        return upperNamingFunction;
    }
    namerForObjectProperty() {
        return lowerNamingFunction;
    }
    makeUnionMemberNamer() {
        return Naming_1.funPrefixNamer("upper", s => kotlinNameStyle(true, s) + "Value");
    }
    makeEnumCaseNamer() {
        return upperNamingFunction;
    }
    emitDescriptionBlock(lines) {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }
    emitBlock(line, f, delimiter = "curly") {
        const [open, close] = delimiter === "curly" ? ["{", "}"] : delimiter === "paren" ? ["(", ")"] : ["{", "})"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }
    anySourceType(optional) {
        return ["Any", optional];
    }
    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    arrayType(arrayType, withIssues = false, _noOptional = false) {
        return ["List<", this.kotlinType(arrayType.items, withIssues), ">"];
    }
    mapType(mapType, withIssues = false, _noOptional = false) {
        return ["Map<String, ", this.kotlinType(mapType.values, withIssues), ">"];
    }
    kotlinType(t, withIssues = false, noOptional = false) {
        const optional = noOptional ? "" : "?";
        return TypeUtils_1.matchType(t, _anyType => {
            return Source_1.maybeAnnotated(withIssues, Annotation_1.anyTypeIssueAnnotation, this.anySourceType(optional));
        }, _nullType => {
            return Source_1.maybeAnnotated(withIssues, Annotation_1.nullTypeIssueAnnotation, this.anySourceType(optional));
        }, _boolType => "Boolean", _integerType => "Long", _doubleType => "Double", _stringType => "String", arrayType => this.arrayType(arrayType, withIssues), classType => this.nameForNamedType(classType), mapType => this.mapType(mapType, withIssues), enumType => this.nameForNamedType(enumType), unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null)
                return [this.kotlinType(nullable, withIssues), optional];
            return this.nameForNamedType(unionType);
        });
    }
    emitUsageHeader() {
        // To be overridden
    }
    emitHeader() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }
        else {
            this.emitUsageHeader();
        }
        this.ensureBlankLine();
        this.emitLine("package ", this._kotlinOptions.packageName);
        this.ensureBlankLine();
    }
    emitTopLevelArray(t, name) {
        const elementType = this.kotlinType(t.items);
        this.emitLine(["typealias ", name, " = ArrayList<", elementType, ">"]);
    }
    emitTopLevelMap(t, name) {
        const elementType = this.kotlinType(t.values);
        this.emitLine(["typealias ", name, " = HashMap<String, ", elementType, ">"]);
    }
    emitEmptyClassDefinition(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitClassAnnotations(c, className);
        this.emitLine("class ", className, "()");
    }
    emitClassDefinition(c, className) {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }
        const kotlinType = (p) => {
            if (p.isOptional) {
                return [this.kotlinType(p.type, true, true), "?"];
            }
            else {
                return this.kotlinType(p.type, true);
            }
        };
        this.emitDescription(this.descriptionForType(c));
        this.emitClassAnnotations(c, className);
        this.emitLine("data class ", className, " (");
        this.indent(() => {
            let count = c.getProperties().size;
            let first = true;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const nullable = p.type.kind === "union" && TypeUtils_1.nullableFromUnion(p.type) !== null;
                const nullableOrOptional = p.isOptional || p.type.kind === "null" || nullable;
                const last = --count === 0;
                let meta = [];
                const description = this.descriptionForClassProperty(c, jsonName);
                if (description !== undefined) {
                    meta.push(() => this.emitDescription(description));
                }
                this.renameAttribute(name, jsonName, !nullableOrOptional, meta);
                if (meta.length > 0 && !first) {
                    this.ensureBlankLine();
                }
                for (const emit of meta) {
                    emit();
                }
                this.emitLine("val ", name, ": ", kotlinType(p), nullableOrOptional ? " = null" : "", last ? "" : ",");
                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }
                first = false;
            });
        });
        this.emitClassDefinitionMethods(c, className);
    }
    emitClassDefinitionMethods(_c, _className) {
        this.emitLine(")");
    }
    emitClassAnnotations(_c, _className) {
        // to be overridden
    }
    renameAttribute(_name, _jsonName, _required, _meta) {
        // to be overridden
    }
    emitEnumDefinition(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        this.emitBlock(["enum class ", enumName], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", name => {
                this.emitLine(name, --count === 0 ? "" : ",");
            });
        });
    }
    emitUnionDefinition(u, unionName) {
        function sortBy(t) {
            const kind = t.kind;
            if (kind === "class")
                return kind;
            return "_" + kind;
        }
        this.emitDescription(this.descriptionForType(u));
        const [maybeNull, nonNulls] = TypeUtils_1.removeNullFromUnion(u, sortBy);
        this.emitClassAnnotations(u, unionName);
        this.emitBlock(["sealed class ", unionName], () => {
            {
                let table = [];
                this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                    table.push([["class ", name, "(val value: ", this.kotlinType(t), ")"], [" : ", unionName, "()"]]);
                });
                if (maybeNull !== null) {
                    table.push([["class ", this.nameForUnionMember(u, maybeNull), "()"], [" : ", unionName, "()"]]);
                }
                this.emitTable(table);
            }
            this.emitUnionDefinitionMethods(u, nonNulls, maybeNull, unionName);
        });
    }
    emitUnionDefinitionMethods(_u, _nonNulls, _maybeNull, _unionName) {
        // to be overridden
    }
    emitSourceStructure() {
        this.emitHeader();
        // Top-level arrays, maps
        this.forEachTopLevel("leading", (t, name) => {
            if (t instanceof Type_1.ArrayType) {
                this.emitTopLevelArray(t, name);
            }
            else if (t instanceof Type_1.MapType) {
                this.emitTopLevelMap(t, name);
            }
        });
        this.forEachNamedType("leading-and-interposing", (c, n) => this.emitClassDefinition(c, n), (e, n) => this.emitEnumDefinition(e, n), (u, n) => this.emitUnionDefinition(u, n));
    }
}
exports.KotlinRenderer = KotlinRenderer;
class KotlinKlaxonRenderer extends KotlinRenderer {
    constructor(targetLanguage, renderContext, _kotlinOptions) {
        super(targetLanguage, renderContext, _kotlinOptions);
    }
    unionMemberFromJsonValue(t, e) {
        return TypeUtils_1.matchType(t, _anyType => [e, ".inside"], _nullType => "null", _boolType => [e, ".boolean"], _integerType => ["(", e, ".int?.toLong() ?: ", e, ".longValue)"], _doubleType => [e, ".double"], _stringType => [e, ".string"], arrayType => [e, ".array?.let { klaxon.parseFromJsonArray<", this.kotlinType(arrayType.items), ">(it) }"], _classType => [e, ".obj?.let { klaxon.parseFromJsonObject<", this.kotlinType(t), ">(it) }"], _mapType => [e, ".obj?.let { klaxon.parseFromJsonObject<", this.kotlinType(t), ">(it) }"], enumType => [e, ".string?.let { ", this.kotlinType(enumType), ".fromValue(it) }"], _unionType => Support_1.mustNotHappen());
    }
    unionMemberJsonValueGuard(t, _e) {
        return TypeUtils_1.matchType(t, _anyType => "is Any", _nullType => "null", _boolType => "is Boolean", _integerType => "is Int, is Long", _doubleType => "is Double", _stringType => "is String", _arrayType => "is JsonArray<*>", 
        // These could be stricter, but for now we don't allow maps
        // and objects in the same union
        _classType => "is JsonObject", _mapType => "is JsonObject", 
        // This could be stricter, but for now we don't allow strings
        // and enums in the same union
        _enumType => "is String", _unionType => Support_1.mustNotHappen());
    }
    emitUsageHeader() {
        this.emitLine("// To parse the JSON, install Klaxon and do:");
        this.emitLine("//");
        this.forEachTopLevel("none", (_, name) => {
            this.emitLine("//   val ", Source_1.modifySource(Strings_1.camelCase, name), " = ", name, ".fromJson(jsonString)");
        });
    }
    emitHeader() {
        super.emitHeader();
        this.emitLine("import com.beust.klaxon.*");
        const hasUnions = collection_utils_1.iterableSome(this.typeGraph.allNamedTypes(), t => t instanceof Type_1.UnionType && TypeUtils_1.nullableFromUnion(t) === null);
        const hasEmptyObjects = collection_utils_1.iterableSome(this.typeGraph.allNamedTypes(), c => c instanceof Type_1.ClassType && c.getProperties().size === 0);
        if (hasUnions || this.haveEnums || hasEmptyObjects) {
            this.emitGenericConverter();
        }
        let converters = [];
        if (hasEmptyObjects) {
            converters.push([[".convert(JsonObject::class,"], [" { it.obj!! },"], [" { it.toJsonString() })"]]);
        }
        this.forEachEnum("none", (_, name) => {
            converters.push([
                [".convert(", name, "::class,"],
                [" { ", name, ".fromValue(it.string!!) },"],
                [' { "\\"${it.value}\\"" })']
            ]);
        });
        this.forEachUnion("none", (_, name) => {
            converters.push([
                [".convert(", name, "::class,"],
                [" { ", name, ".fromJson(it) },"],
                [" { it.toJson() }, true)"]
            ]);
        });
        this.ensureBlankLine();
        this.emitLine("private val klaxon = Klaxon()");
        if (converters.length > 0) {
            this.indent(() => this.emitTable(converters));
        }
    }
    emitTopLevelArray(t, name) {
        const elementType = this.kotlinType(t.items);
        this.emitBlock(["class ", name, "(elements: Collection<", elementType, ">) : ArrayList<", elementType, ">(elements)"], () => {
            this.emitLine("public fun toJson() = klaxon.toJsonString(this)");
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitLine("public fun fromJson(json: String) = ", name, "(klaxon.parseArray<", elementType, ">(json)!!)");
            });
        });
    }
    emitTopLevelMap(t, name) {
        const elementType = this.kotlinType(t.values);
        this.emitBlock([
            "class ",
            name,
            "(elements: Map<String, ",
            elementType,
            ">) : HashMap<String, ",
            elementType,
            ">(elements)"
        ], () => {
            this.emitLine("public fun toJson() = klaxon.toJsonString(this)");
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitBlock(["public fun fromJson(json: String) = ", name], () => {
                    this.emitLine("klaxon.parseJsonObject(java.io.StringReader(json)) as Map<String, ", elementType, ">");
                }, "paren");
            });
        });
    }
    klaxonRenameAttribute(propName, jsonName, ignore = false) {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        const properties = [];
        if (namesDiffer) {
            properties.push(['name = "', escapedName, '"']);
        }
        if (ignore) {
            properties.push("ignored = true");
        }
        return properties.length === 0 ? undefined : ["@Json(", collection_utils_1.arrayIntercalate(", ", properties), ")"];
    }
    emitEmptyClassDefinition(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("typealias ", className, " = JsonObject");
    }
    emitClassDefinitionMethods(c, className) {
        const isTopLevel = collection_utils_1.iterableSome(this.topLevels, ([_, top]) => top === c);
        if (isTopLevel) {
            this.emitBlock(")", () => {
                this.emitLine("public fun toJson() = klaxon.toJsonString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine("public fun fromJson(json: String) = klaxon.parse<", className, ">(json)");
                });
            });
        }
        else {
            this.emitLine(")");
        }
    }
    renameAttribute(name, jsonName, _required, meta) {
        const rename = this.klaxonRenameAttribute(name, jsonName);
        if (rename !== undefined) {
            meta.push(() => this.emitLine(rename));
        }
    }
    emitEnumDefinition(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                this.emitLine(name, `("${stringEscape(json)}")`, --count === 0 ? ";" : ",");
            });
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitBlock(["public fun fromValue(value: String): ", enumName, " = when (value)"], () => {
                    let table = [];
                    this.forEachEnumCase(e, "none", (name, json) => {
                        table.push([[`"${stringEscape(json)}"`], [" -> ", name]]);
                    });
                    table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                    this.emitTable(table);
                });
            });
        });
    }
    emitGenericConverter() {
        this.ensureBlankLine();
        this.emitLine("private fun <T> Klaxon.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonValue) -> T, toJson: (T) -> String, isUnion: Boolean = false) =");
        this.indent(() => {
            this.emitLine("this.converter(object: Converter {");
            this.indent(() => {
                this.emitLine(`@Suppress("UNCHECKED_CAST")`);
                this.emitTable([
                    ["override fun toJson(value: Any)", " = toJson(value as T)"],
                    ["override fun fromJson(jv: JsonValue)", " = fromJson(jv) as Any"],
                    [
                        "override fun canConvert(cls: Class<*>)",
                        " = cls == k.java || (isUnion && cls.superclass == k.java)"
                    ]
                ]);
            });
            this.emitLine("})");
        });
    }
    emitUnionDefinitionMethods(u, nonNulls, maybeNull, unionName) {
        this.ensureBlankLine();
        this.emitLine("public fun toJson(): String = klaxon.toJsonString(when (this) {");
        this.indent(() => {
            let toJsonTable = [];
            this.forEachUnionMember(u, nonNulls, "none", null, name => {
                toJsonTable.push([["is ", name], [" -> this.value"]]);
            });
            if (maybeNull !== null) {
                const name = this.nameForUnionMember(u, maybeNull);
                toJsonTable.push([["is ", name], [' -> "null"']]);
            }
            this.emitTable(toJsonTable);
        });
        this.emitLine("})");
        this.ensureBlankLine();
        this.emitBlock("companion object", () => {
            this.emitLine("public fun fromJson(jv: JsonValue): ", unionName, " = when (jv.inside) {");
            this.indent(() => {
                let table = [];
                this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                    table.push([
                        [this.unionMemberJsonValueGuard(t, "jv.inside")],
                        [" -> ", name, "(", this.unionMemberFromJsonValue(t, "jv"), "!!)"]
                    ]);
                });
                if (maybeNull !== null) {
                    const name = this.nameForUnionMember(u, maybeNull);
                    table.push([[this.unionMemberJsonValueGuard(maybeNull, "jv.inside")], [" -> ", name, "()"]]);
                }
                table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                this.emitTable(table);
            });
            this.emitLine("}");
        });
    }
}
exports.KotlinKlaxonRenderer = KotlinKlaxonRenderer;
class KotlinJacksonRenderer extends KotlinRenderer {
    constructor(targetLanguage, renderContext, _kotlinOptions) {
        super(targetLanguage, renderContext, _kotlinOptions);
    }
    unionMemberJsonValueGuard(t, _e) {
        return TypeUtils_1.matchType(t, _anyType => "is Any", _nullType => "null", _boolType => "is BooleanNode", _integerType => "is IntNode, is LongNode", _doubleType => "is DoubleNode", _stringType => "is TextNode", _arrayType => "is ArrayNode", 
        // These could be stricter, but for now we don't allow maps
        // and objects in the same union
        _classType => "is ObjectNode", _mapType => "is ObjectNode", 
        // This could be stricter, but for now we don't allow strings
        // and enums in the same union
        _enumType => "is TextNode", _unionType => Support_1.mustNotHappen());
    }
    emitUsageHeader() {
        this.emitLine("// To parse the JSON, install jackson-module-kotlin and do:");
        this.emitLine("//");
        this.forEachTopLevel("none", (_, name) => {
            this.emitLine("//   val ", Source_1.modifySource(Strings_1.camelCase, name), " = ", name, ".fromJson(jsonString)");
        });
    }
    emitHeader() {
        super.emitHeader();
        this.emitMultiline(`import com.fasterxml.jackson.annotation.*
import com.fasterxml.jackson.core.*
import com.fasterxml.jackson.databind.*
import com.fasterxml.jackson.databind.deser.std.StdDeserializer
import com.fasterxml.jackson.databind.module.SimpleModule
import com.fasterxml.jackson.databind.node.*
import com.fasterxml.jackson.databind.ser.std.StdSerializer
import com.fasterxml.jackson.module.kotlin.*`);
        const hasUnions = collection_utils_1.iterableSome(this.typeGraph.allNamedTypes(), t => t instanceof Type_1.UnionType && TypeUtils_1.nullableFromUnion(t) === null);
        const hasEmptyObjects = collection_utils_1.iterableSome(this.typeGraph.allNamedTypes(), c => c instanceof Type_1.ClassType && c.getProperties().size === 0);
        if (hasUnions || this.haveEnums || hasEmptyObjects) {
            this.emitGenericConverter();
        }
        let converters = [];
        // if (hasEmptyObjects) {
        //     converters.push([["convert(JsonNode::class,"], [" { it },"], [" { writeValueAsString(it) })"]]);
        // }
        this.forEachEnum("none", (_, name) => {
            converters.push([
                ["convert(", name, "::class,"],
                [" { ", name, ".fromValue(it.asText()) },"],
                [' { "\\"${it.value}\\"" })']
            ]);
        });
        this.forEachUnion("none", (_, name) => {
            converters.push([
                ["convert(", name, "::class,"],
                [" { ", name, ".fromJson(it) },"],
                [" { it.toJson() }, true)"]
            ]);
        });
        this.ensureBlankLine();
        this.emitLine("val mapper = jacksonObjectMapper().apply {");
        this.indent(() => {
            this.emitLine("propertyNamingStrategy = PropertyNamingStrategy.LOWER_CAMEL_CASE");
            this.emitLine("setSerializationInclusion(JsonInclude.Include.NON_NULL)");
        });
        if (converters.length > 0) {
            this.indent(() => this.emitTable(converters));
        }
        this.emitLine("}");
    }
    emitTopLevelArray(t, name) {
        const elementType = this.kotlinType(t.items);
        this.emitBlock(["class ", name, "(elements: Collection<", elementType, ">) : ArrayList<", elementType, ">(elements)"], () => {
            this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitLine("fun fromJson(json: String) = mapper.readValue<", name, ">(json)");
            });
        });
    }
    emitTopLevelMap(t, name) {
        const elementType = this.kotlinType(t.values);
        this.emitBlock([
            "class ",
            name,
            "(elements: Map<String, ",
            elementType,
            ">) : HashMap<String, ",
            elementType,
            ">(elements)"
        ], () => {
            this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitLine("fun fromJson(json: String) = mapper.readValue<", name, ">(json)");
            });
        });
    }
    jacksonRenameAttribute(propName, jsonName, required, ignore = false) {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        const properties = [];
        const isPrefixBool = jsonName.startsWith("is"); // https://github.com/FasterXML/jackson-module-kotlin/issues/80
        const propertyOpts = [];
        if (namesDiffer || isPrefixBool) {
            propertyOpts.push('"' + escapedName + '"');
        }
        if (required) {
            propertyOpts.push("required=true");
        }
        if (propertyOpts.length > 0) {
            properties.push(["@get:JsonProperty(", collection_utils_1.arrayIntercalate(", ", propertyOpts), ")"]);
            properties.push(["@field:JsonProperty(", collection_utils_1.arrayIntercalate(", ", propertyOpts), ")"]);
        }
        if (ignore) {
            properties.push("@get:JsonIgnore");
            properties.push("@field:JsonIgnore");
        }
        return properties.length === 0 ? undefined : properties;
    }
    emitEmptyClassDefinition(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("typealias ", className, " = JsonNode");
    }
    emitClassDefinitionMethods(c, className) {
        const isTopLevel = collection_utils_1.iterableSome(this.topLevels, ([_, top]) => top === c);
        if (isTopLevel) {
            this.emitBlock(")", () => {
                this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine("fun fromJson(json: String) = mapper.readValue<", className, ">(json)");
                });
            });
        }
        else {
            this.emitLine(")");
        }
    }
    renameAttribute(name, jsonName, required, meta) {
        const rename = this.jacksonRenameAttribute(name, jsonName, required);
        if (rename !== undefined) {
            meta.push(() => this.emitLine(rename));
        }
    }
    emitEnumDefinition(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                this.emitLine(name, `("${stringEscape(json)}")`, --count === 0 ? ";" : ",");
            });
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitBlock(["fun fromValue(value: String): ", enumName, " = when (value)"], () => {
                    let table = [];
                    this.forEachEnumCase(e, "none", (name, json) => {
                        table.push([[`"${stringEscape(json)}"`], [" -> ", name]]);
                    });
                    table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                    this.emitTable(table);
                });
            });
        });
    }
    emitGenericConverter() {
        this.ensureBlankLine();
        this.emitMultiline(`
@Suppress("UNCHECKED_CAST")
private fun <T> ObjectMapper.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonNode) -> T, toJson: (T) -> String, isUnion: Boolean = false) = registerModule(SimpleModule().apply {
    addSerializer(k.java as Class<T>, object : StdSerializer<T>(k.java as Class<T>) {
        override fun serialize(value: T, gen: JsonGenerator, provider: SerializerProvider) = gen.writeRawValue(toJson(value))
    })
    addDeserializer(k.java as Class<T>, object : StdDeserializer<T>(k.java as Class<T>) {
        override fun deserialize(p: JsonParser, ctxt: DeserializationContext) = fromJson(p.readValueAsTree())
    })
})`);
    }
    emitUnionDefinitionMethods(u, nonNulls, maybeNull, unionName) {
        this.ensureBlankLine();
        this.emitLine("fun toJson(): String = mapper.writeValueAsString(when (this) {");
        this.indent(() => {
            let toJsonTable = [];
            this.forEachUnionMember(u, nonNulls, "none", null, name => {
                toJsonTable.push([["is ", name], [" -> this.value"]]);
            });
            if (maybeNull !== null) {
                const name = this.nameForUnionMember(u, maybeNull);
                toJsonTable.push([["is ", name], [' -> "null"']]);
            }
            this.emitTable(toJsonTable);
        });
        this.emitLine("})");
        this.ensureBlankLine();
        this.emitBlock("companion object", () => {
            this.emitLine("fun fromJson(jn: JsonNode): ", unionName, " = when (jn) {");
            this.indent(() => {
                let table = [];
                this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                    table.push([[this.unionMemberJsonValueGuard(t, "jn")], [" -> ", name, "(mapper.treeToValue(jn))"]]);
                });
                if (maybeNull !== null) {
                    const name = this.nameForUnionMember(u, maybeNull);
                    table.push([[this.unionMemberJsonValueGuard(maybeNull, "jn")], [" -> ", name, "()"]]);
                }
                table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                this.emitTable(table);
            });
            this.emitLine("}");
        });
    }
}
exports.KotlinJacksonRenderer = KotlinJacksonRenderer;
/**
 * Currently supports simple classes, enums, and TS string unions (which are also enums).
 * TODO: Union, Any, Top Level Array, Top Level Map
 */
class KotlinXRenderer extends KotlinRenderer {
    constructor(targetLanguage, renderContext, _kotlinOptions) {
        super(targetLanguage, renderContext, _kotlinOptions);
    }
    anySourceType(optional) {
        return ["JsonObject", optional];
    }
    arrayType(arrayType, withIssues = false, noOptional = false) {
        const valType = this.kotlinType(arrayType.items, withIssues, true);
        const name = this.sourcelikeToString(valType);
        if (name === "JsonObject") {
            return "JsonArray";
        }
        return super.arrayType(arrayType, withIssues, noOptional);
    }
    mapType(mapType, withIssues = false, noOptional = false) {
        const valType = this.kotlinType(mapType.values, withIssues, true);
        const name = this.sourcelikeToString(valType);
        if (name === "JsonObject") {
            return "JsonObject";
        }
        return super.mapType(mapType, withIssues, noOptional);
    }
    emitTopLevelMap(t, name) {
        const elementType = this.kotlinType(t.values);
        if (elementType === "JsonObject") {
            this.emitLine(["typealias ", name, " = JsonObject"]);
        }
        else {
            super.emitTopLevelMap(t, name);
        }
    }
    emitTopLevelArray(t, name) {
        const elementType = this.kotlinType(t.items);
        this.emitLine(["typealias ", name, " = JsonArray<", elementType, ">"]);
    }
    emitUsageHeader() {
        this.emitLine("// To parse the JSON, install kotlin's serialization plugin and do:");
        this.emitLine("//");
        const table = [];
        table.push(["// val ", "json", " = Json { allowStructuredMapKeys = true }"]);
        this.forEachTopLevel("none", (_, name) => {
            table.push(["// val ", Source_1.modifySource(Strings_1.camelCase, name), ` = json.parse(${this.sourcelikeToString(name)}.serializer(), jsonString)`]);
        });
        this.emitTable(table);
    }
    emitHeader() {
        super.emitHeader();
        this.emitLine("import kotlinx.serialization.*");
        this.emitLine("import kotlinx.serialization.json.*");
        this.emitLine("import kotlinx.serialization.descriptors.*");
        this.emitLine("import kotlinx.serialization.encoding.*");
    }
    emitClassAnnotations(_c, _className) {
        this.emitLine("@Serializable");
    }
    renameAttribute(name, jsonName, _required, meta) {
        const rename = this._rename(name, jsonName);
        if (rename !== undefined) {
            meta.push(() => this.emitLine(rename));
        }
    }
    _rename(propName, jsonName) {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer) {
            return ["@SerialName(\"", escapedName, "\")"];
        }
        return undefined;
    }
    emitEnumDefinition(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine(["@Serializable(with = ", enumName, ".Companion::class)"]);
        this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                this.emitLine(name, `("${stringEscape(json)}")`, --count === 0 ? ";" : ",");
            });
            this.ensureBlankLine();
            this.emitBlock(["companion object : KSerializer<", enumName, ">"], () => {
                this.emitBlock("override val descriptor: SerialDescriptor get()", () => {
                    this.emitLine("return PrimitiveSerialDescriptor(\"", this._kotlinOptions.packageName, ".", enumName, "\", PrimitiveKind.STRING)");
                });
                this.emitBlock(["override fun deserialize(decoder: Decoder): ", enumName, " = when (val value = decoder.decodeString())"], () => {
                    let table = [];
                    this.forEachEnumCase(e, "none", (name, json) => {
                        table.push([[`"${stringEscape(json)}"`], [" -> ", name]]);
                    });
                    table.push([["else"], [" -> throw IllegalArgumentException(\"", enumName, " could not parse: $value\")"]]);
                    this.emitTable(table);
                });
                this.emitBlock(["override fun serialize(encoder: Encoder, value: ", enumName, ")"], () => {
                    this.emitLine(["return encoder.encodeString(value.value)"]);
                });
            });
        });
    }
}
exports.KotlinXRenderer = KotlinXRenderer;
