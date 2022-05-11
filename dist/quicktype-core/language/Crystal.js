"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TargetLanguage_1 = require("../TargetLanguage");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Strings_1 = require("../support/Strings");
const Naming_1 = require("../Naming");
const TypeUtils_1 = require("../TypeUtils");
const Source_1 = require("../Source");
const Annotation_1 = require("../Annotation");
class CrystalTargetLanguage extends TargetLanguage_1.TargetLanguage {
    makeRenderer(renderContext) {
        return new CrystalRenderer(this, renderContext);
    }
    constructor() {
        super("Crystal", ["crystal", "cr", "crystallang"], "cr");
    }
    get defaultIndentation() {
        return "  ";
    }
    getOptions() {
        return [];
    }
}
exports.CrystalTargetLanguage = CrystalTargetLanguage;
const keywords = [
    "Any",
    "Array",
    "Atomic",
    "Bool",
    "Channel",
    "Char",
    "Class",
    "Enum",
    "Enumerable",
    "Event",
    "Extern",
    "Exception",
    "File",
    "Float",
    "Float32",
    "Float64",
    "GC",
    "GZip",
    "Hash",
    "HTML",
    "HTTP",
    "Int",
    "Int128",
    "Int16",
    "Int32",
    "Int64",
    "Int8",
    "Iterable",
    "Link",
    "Logger",
    "Math",
    "Mutex",
    "Nil",
    "Number",
    "JSON",
    "IO",
    "Object",
    "Pointer",
    "Proc",
    "Process",
    "Range",
    "Random",
    "Regex",
    "Reference",
    "Set",
    "Signal",
    "Slice",
    "Spec",
    "StaticArray",
    "String",
    "Struct",
    "Symbol",
    "System",
    "TCPServer",
    "TCPSocket",
    "Socket",
    "Tempfile",
    "Termios",
    "Time",
    "Tuple",
    "ThreadLocal",
    "UDPSocket",
    "UInt128",
    "UInt16",
    "UInt32",
    "UInt64",
    "UInt8",
    "Union",
    "UNIXServer",
    "UNIXSocket",
    "UUID",
    "URI",
    "VaList",
    "Value",
    "Void",
    "WeakRef",
    "XML",
    "YAML",
    "Zip",
    "Zlib",
    "abstract",
    "alias",
    "as",
    "as?",
    "asm",
    "begin",
    "break",
    "case",
    "class",
    "def",
    "do",
    "else",
    "elsif",
    "end",
    "ensure",
    "enum",
    "extend",
    "false",
    "for",
    "fun",
    "if",
    "in",
    "include",
    "instance_sizeof",
    "is_a?",
    "lib",
    "macro",
    "module",
    "next",
    "nil",
    "nil?",
    "of",
    "out",
    "pointerof",
    "private",
    "protected",
    "require",
    "rescue",
    "return",
    "select",
    "self",
    "sizeof",
    "struct",
    "super",
    "then",
    "true",
    "type",
    "typeof",
    "uninitialized",
    "union",
    "unless",
    "until",
    "when",
    "while",
    "with",
    "yield"
];
function isAsciiLetterOrUnderscoreOrDigit(codePoint) {
    if (!Strings_1.isAscii(codePoint)) {
        return false;
    }
    return Strings_1.isLetterOrUnderscoreOrDigit(codePoint);
}
function isAsciiLetterOrUnderscore(codePoint) {
    if (!Strings_1.isAscii(codePoint)) {
        return false;
    }
    return Strings_1.isLetterOrUnderscore(codePoint);
}
const legalizeName = Strings_1.legalizeCharacters(isAsciiLetterOrUnderscoreOrDigit);
function crystalStyle(original, isSnakeCase) {
    const words = Strings_1.splitIntoWords(original);
    const wordStyle = isSnakeCase ? Strings_1.allLowerWordStyle : Strings_1.firstUpperWordStyle;
    const combined = Strings_1.combineWords(words, legalizeName, wordStyle, wordStyle, wordStyle, wordStyle, isSnakeCase ? "_" : "", isAsciiLetterOrUnderscore);
    return combined === "_" ? "_underscore" : combined;
}
const snakeNamingFunction = Naming_1.funPrefixNamer("default", (original) => crystalStyle(original, true));
const camelNamingFunction = Naming_1.funPrefixNamer("camel", (original) => crystalStyle(original, false));
function standardUnicodeCrystalEscape(codePoint) {
    if (codePoint <= 0xffff) {
        return "\\u{" + Strings_1.intToHex(codePoint, 4) + "}";
    }
    else {
        return "\\u{" + Strings_1.intToHex(codePoint, 6) + "}";
    }
}
const crystalStringEscape = Strings_1.utf32ConcatMap(Strings_1.escapeNonPrintableMapper(Strings_1.isPrintable, standardUnicodeCrystalEscape));
class CrystalRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext) {
        super(targetLanguage, renderContext);
    }
    makeNamedTypeNamer() {
        return camelNamingFunction;
    }
    namerForObjectProperty() {
        return snakeNamingFunction;
    }
    makeUnionMemberNamer() {
        return camelNamingFunction;
    }
    makeEnumCaseNamer() {
        return camelNamingFunction;
    }
    forbiddenNamesForGlobalNamespace() {
        return keywords;
    }
    forbiddenForObjectProperties(_c, _className) {
        return { names: [], includeGlobalForbidden: true };
    }
    forbiddenForUnionMembers(_u, _unionName) {
        return { names: [], includeGlobalForbidden: true };
    }
    forbiddenForEnumCases(_e, _enumName) {
        return { names: [], includeGlobalForbidden: true };
    }
    get commentLineStart() {
        return "# ";
    }
    nullableCrystalType(t, withIssues) {
        return [this.crystalType(t, withIssues), "?"];
    }
    isImplicitCycleBreaker(t) {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }
    crystalType(t, withIssues = false) {
        return TypeUtils_1.matchType(t, _anyType => Source_1.maybeAnnotated(withIssues, Annotation_1.anyTypeIssueAnnotation, "JSON::Any?"), _nullType => Source_1.maybeAnnotated(withIssues, Annotation_1.nullTypeIssueAnnotation, "Nil"), _boolType => "Bool", _integerType => "Int32", _doubleType => "Float64", _stringType => "String", arrayType => ["Array(", this.crystalType(arrayType.items, withIssues), ")"], classType => this.nameForNamedType(classType), mapType => ["Hash(String, ", this.crystalType(mapType.values, withIssues), ")"], _enumType => "String", unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null)
                return this.nullableCrystalType(nullable, withIssues);
            const [hasNull] = TypeUtils_1.removeNullFromUnion(unionType);
            const name = this.nameForNamedType(unionType);
            return hasNull !== null ? [name, "?"] : name;
        });
    }
    breakCycle(t, withIssues) {
        return this.crystalType(t, withIssues);
    }
    emitRenameAttribute(propName, jsonName) {
        const escapedName = crystalStringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer) {
            this.emitLine('@[JSON::Field(key: "', escapedName, '")]');
        }
    }
    emitStructDefinition(c, className) {
        this.emitDescription(this.descriptionForType(c));
        const structBody = () => this.forEachClassProperty(c, "none", (name, jsonName, prop) => {
            this.ensureBlankLine();
            this.emitDescription(this.descriptionForClassProperty(c, jsonName));
            this.emitRenameAttribute(name, jsonName);
            this.emitLine("property ", name, " : ", this.crystalType(prop.type, true));
        });
        this.emitBlock(["class ", className], structBody);
    }
    emitBlock(line, f) {
        this.emitLine(line);
        this.indent(() => {
            this.emitLine("include JSON::Serializable");
        });
        this.ensureBlankLine();
        this.indent(f);
        this.emitLine("end");
    }
    emitEnum(line, f) {
        this.emitLine(line);
        this.indent(f);
        this.emitLine("end");
    }
    emitUnion(u, unionName) {
        const isMaybeWithSingleType = TypeUtils_1.nullableFromUnion(u);
        if (isMaybeWithSingleType !== null) {
            return;
        }
        this.emitDescription(this.descriptionForType(u));
        const [, nonNulls] = TypeUtils_1.removeNullFromUnion(u);
        let types = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_name, t) => {
            const crystalType = this.breakCycle(t, true);
            types.push([crystalType]);
        });
        this.emitLine([
            "alias ",
            unionName,
            " = ",
            types.map(r => r.map(sl => this.sourcelikeToString(sl))).join(" | ")
        ]);
    }
    emitTopLevelAlias(t, name) {
        this.emitLine("alias ", name, " = ", this.crystalType(t));
    }
    emitLeadingComments() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            return;
        }
        this.emitMultiline(`# Example code that deserializes and serializes the model:
#
# require "json"
#
# class Location
#   include JSON::Serializable
#
#   @[JSON::Field(key: "lat")]
#   property latitude : Float64
#
#   @[JSON::Field(key: "lng")]
#   property longitude : Float64
# end
#
# class House
#   include JSON::Serializable
#   property address : String
#   property location : Location?
# end
#
# house = House.from_json(%({"address": "Crystal Road 1234", "location": {"lat": 12.3, "lng": 34.5}}))
# house.address  # => "Crystal Road 1234"
# house.location # => #<Location:0x10cd93d80 @latitude=12.3, @longitude=34.5>
`);
    }
    emitSourceStructure() {
        this.emitLeadingComments();
        this.ensureBlankLine();
        this.emitLine('require "json"');
        this.forEachTopLevel("leading", (t, name) => this.emitTopLevelAlias(t, name), t => this.namedTypeToNameForTopLevel(t) === undefined);
        this.forEachObject("leading-and-interposing", (c, name) => this.emitStructDefinition(c, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnion(u, name));
    }
}
exports.CrystalRenderer = CrystalRenderer;
