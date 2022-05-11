"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TargetLanguage_1 = require("../TargetLanguage");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Strings_1 = require("../support/Strings");
const Naming_1 = require("../Naming");
const TypeUtils_1 = require("../TypeUtils");
const Source_1 = require("../Source");
const Annotation_1 = require("../Annotation");
const RendererOptions_1 = require("../RendererOptions");
const Support_1 = require("../support/Support");
var Density;
(function (Density) {
    Density[Density["Normal"] = 0] = "Normal";
    Density[Density["Dense"] = 1] = "Dense";
})(Density = exports.Density || (exports.Density = {}));
var Visibility;
(function (Visibility) {
    Visibility[Visibility["Private"] = 0] = "Private";
    Visibility[Visibility["Crate"] = 1] = "Crate";
    Visibility[Visibility["Public"] = 2] = "Public";
})(Visibility = exports.Visibility || (exports.Visibility = {}));
exports.rustOptions = {
    density: new RendererOptions_1.EnumOption("density", "Density", [
        ["normal", Density.Normal],
        ["dense", Density.Dense]
    ]),
    visibility: new RendererOptions_1.EnumOption("visibility", "Field visibility", [
        ["private", Visibility.Private],
        ["crate", Visibility.Crate],
        ["public", Visibility.Public]
    ]),
    deriveDebug: new RendererOptions_1.BooleanOption("derive-debug", "Derive Debug impl", false),
    edition2018: new RendererOptions_1.BooleanOption("edition-2018", "Edition 2018", false),
    leadingComments: new RendererOptions_1.BooleanOption("leading-comments", "Leading Comments", true)
};
class RustTargetLanguage extends TargetLanguage_1.TargetLanguage {
    makeRenderer(renderContext, untypedOptionValues) {
        return new RustRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.rustOptions, untypedOptionValues));
    }
    constructor() {
        super("Rust", ["rust", "rs", "rustlang"], "rs");
    }
    getOptions() {
        return [exports.rustOptions.density, exports.rustOptions.visibility, exports.rustOptions.deriveDebug];
    }
}
exports.RustTargetLanguage = RustTargetLanguage;
const keywords = [
    // Special reserved identifiers used internally for elided lifetimes,
    // unnamed method parameters, crate root module, error recovery etc.
    "{{root}}",
    "$crate",
    // Keywords used in the language.
    "as",
    "box",
    "break",
    "const",
    "continue",
    "crate",
    "else",
    "enum",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "unsafe",
    "use",
    "where",
    "while",
    // Keywords reserved for future use.
    "abstract",
    "alignof",
    "become",
    "do",
    "final",
    "macro",
    "offsetof",
    "override",
    "priv",
    "proc",
    "pure",
    "sizeof",
    "typeof",
    "unsized",
    "virtual",
    "yield",
    // Weak keywords, have special meaning only in specific contexts.
    "catch",
    "default",
    "dyn",
    "'static",
    "union"
];
const isAsciiLetterOrUnderscoreOrDigit = (codePoint) => {
    if (!Strings_1.isAscii(codePoint)) {
        return false;
    }
    return Strings_1.isLetterOrUnderscoreOrDigit(codePoint);
};
const isAsciiLetterOrUnderscore = (codePoint) => {
    if (!Strings_1.isAscii(codePoint)) {
        return false;
    }
    return Strings_1.isLetterOrUnderscore(codePoint);
};
const legalizeName = Strings_1.legalizeCharacters(isAsciiLetterOrUnderscoreOrDigit);
function rustStyle(original, isSnakeCase) {
    const words = Strings_1.splitIntoWords(original);
    const wordStyle = isSnakeCase ? Strings_1.allLowerWordStyle : Strings_1.firstUpperWordStyle;
    const combined = Strings_1.combineWords(words, legalizeName, wordStyle, wordStyle, wordStyle, wordStyle, isSnakeCase ? "_" : "", isAsciiLetterOrUnderscore);
    return combined === "_" ? "_underscore" : combined;
}
const snakeNamingFunction = Naming_1.funPrefixNamer("default", (original) => rustStyle(original, true));
const camelNamingFunction = Naming_1.funPrefixNamer("camel", (original) => rustStyle(original, false));
const standardUnicodeRustEscape = (codePoint) => {
    if (codePoint <= 0xffff) {
        return "\\u{" + Strings_1.intToHex(codePoint, 4) + "}";
    }
    else {
        return "\\u{" + Strings_1.intToHex(codePoint, 6) + "}";
    }
};
const rustStringEscape = Strings_1.utf32ConcatMap(Strings_1.escapeNonPrintableMapper(Strings_1.isPrintable, standardUnicodeRustEscape));
class RustRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
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
        return "/// ";
    }
    nullableRustType(t, withIssues) {
        return ["Option<", this.breakCycle(t, withIssues), ">"];
    }
    isImplicitCycleBreaker(t) {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }
    rustType(t, withIssues = false) {
        return TypeUtils_1.matchType(t, _anyType => Source_1.maybeAnnotated(withIssues, Annotation_1.anyTypeIssueAnnotation, "Option<serde_json::Value>"), _nullType => Source_1.maybeAnnotated(withIssues, Annotation_1.nullTypeIssueAnnotation, "Option<serde_json::Value>"), _boolType => "bool", _integerType => "i64", _doubleType => "f64", _stringType => "String", arrayType => ["Vec<", this.rustType(arrayType.items, withIssues), ">"], classType => this.nameForNamedType(classType), mapType => ["HashMap<String, ", this.rustType(mapType.values, withIssues), ">"], enumType => this.nameForNamedType(enumType), unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null)
                return this.nullableRustType(nullable, withIssues);
            const [hasNull] = TypeUtils_1.removeNullFromUnion(unionType);
            const isCycleBreaker = this.isCycleBreakerType(unionType);
            const name = isCycleBreaker
                ? ["Box<", this.nameForNamedType(unionType), ">"]
                : this.nameForNamedType(unionType);
            return hasNull !== null ? ["Option<", name, ">"] : name;
        });
    }
    breakCycle(t, withIssues) {
        const rustType = this.rustType(t, withIssues);
        const isCycleBreaker = this.isCycleBreakerType(t);
        return isCycleBreaker ? ["Box<", rustType, ">"] : rustType;
    }
    emitRenameAttribute(propName, jsonName) {
        const escapedName = rustStringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer || this._options.density === Density.Normal) {
            this.emitLine('#[serde(rename = "', escapedName, '")]');
        }
    }
    get visibility() {
        if (this._options.visibility === Visibility.Crate) {
            return "pub(crate) ";
        }
        else if (this._options.visibility === Visibility.Public) {
            return "pub ";
        }
        return "";
    }
    emitStructDefinition(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("#[derive(", this._options.deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");
        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        const structBody = () => this.forEachClassProperty(c, blankLines, (name, jsonName, prop) => {
            this.emitDescription(this.descriptionForClassProperty(c, jsonName));
            this.emitRenameAttribute(name, jsonName);
            this.emitLine(this.visibility, name, ": ", this.breakCycle(prop.type, true), ",");
        });
        this.emitBlock(["pub struct ", className], structBody);
    }
    emitBlock(line, f) {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }
    emitUnion(u, unionName) {
        const isMaybeWithSingleType = TypeUtils_1.nullableFromUnion(u);
        if (isMaybeWithSingleType !== null) {
            return;
        }
        this.emitDescription(this.descriptionForType(u));
        this.emitLine("#[derive(", this._options.deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");
        this.emitLine("#[serde(untagged)]");
        const [, nonNulls] = TypeUtils_1.removeNullFromUnion(u);
        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", unionName], () => this.forEachUnionMember(u, nonNulls, blankLines, null, (fieldName, t) => {
            const rustType = this.breakCycle(t, true);
            this.emitLine([fieldName, "(", rustType, "),"]);
        }));
    }
    emitEnumDefinition(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("#[derive(", this._options.deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");
        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", enumName], () => this.forEachEnumCase(e, blankLines, (name, jsonName) => {
            this.emitRenameAttribute(name, jsonName);
            this.emitLine([name, ","]);
        }));
    }
    emitTopLevelAlias(t, name) {
        this.emitLine("pub type ", name, " = ", this.rustType(t), ";");
    }
    emitLeadingComments() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            return;
        }
        const topLevelName = Support_1.defined(collection_utils_1.mapFirst(this.topLevels));
        this.emitMultiline(`// Example code that deserializes and serializes the model.
// extern crate serde;
// #[macro_use]
// extern crate serde_derive;
// extern crate serde_json;
//
// use generated_module::${topLevelName};
//
// fn main() {
//     let json = r#"{"answer": 42}"#;
//     let model: ${topLevelName} = serde_json::from_str(&json).unwrap();
// }`);
    }
    emitSourceStructure() {
        if (this._options.leadingComments) {
            this.emitLeadingComments();
        }
        this.ensureBlankLine();
        if (this._options.edition2018) {
            this.emitLine("use serde::{Serialize, Deserialize};");
        }
        else {
            this.emitLine("extern crate serde_derive;");
        }
        if (this.haveMaps) {
            this.emitLine("use std::collections::HashMap;");
        }
        this.forEachTopLevel("leading", (t, name) => this.emitTopLevelAlias(t, name), t => this.namedTypeToNameForTopLevel(t) === undefined);
        this.forEachObject("leading-and-interposing", (c, name) => this.emitStructDefinition(c, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnion(u, name));
        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
    }
}
exports.RustRenderer = RustRenderer;
