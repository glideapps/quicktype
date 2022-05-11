"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Naming_1 = require("../Naming");
const Source_1 = require("../Source");
const TargetLanguage_1 = require("../TargetLanguage");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Strings_1 = require("../support/Strings");
exports.pikeOptions = {};
const keywords = [
    "auto",
    "nomask",
    "final",
    "static",
    "extern",
    "private",
    "local",
    "public",
    "protected",
    "inline",
    "optional",
    "variant",
    "void",
    "mixed",
    "array",
    "__attribute__",
    "__deprecated__",
    "mapping",
    "multiset",
    "object",
    "function",
    "__func__",
    "program",
    "string",
    "float",
    "int",
    "enum",
    "typedef",
    "if",
    "do",
    "for",
    "while",
    "else",
    "foreach",
    "catch",
    "gauge",
    "class",
    "break",
    "case",
    "const",
    "constant",
    "continue",
    "default",
    "import",
    "inherit",
    "lambda",
    "predef",
    "return",
    "sscanf",
    "switch",
    "typeof",
    "global"
];
const legalizeName = Strings_1.legalizeCharacters(Strings_1.isLetterOrUnderscoreOrDigit);
const enumNamingFunction = Naming_1.funPrefixNamer("enumNamer", Strings_1.makeNameStyle("upper-underscore", legalizeName));
const namingFunction = Naming_1.funPrefixNamer("genericNamer", Strings_1.makeNameStyle("underscore", legalizeName));
const namedTypeNamingFunction = Naming_1.funPrefixNamer("typeNamer", Strings_1.makeNameStyle("pascal", legalizeName));
class PikeTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Pike", ["pike", "pikelang"], "pmod");
    }
    getOptions() {
        return [];
    }
    makeRenderer(renderContext) {
        return new PikeRenderer(this, renderContext);
    }
}
exports.PikeTargetLanguage = PikeTargetLanguage;
class PikeRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    emitSourceStructure() {
        this.emitInformationComment();
        this.ensureBlankLine();
        this.forEachTopLevel("leading", (t, name) => {
            this.emitTopLevelTypedef(t, name);
            this.ensureBlankLine();
            this.emitTopLevelConverter(t, name);
            this.ensureBlankLine();
        }, t => this.namedTypeToNameForTopLevel(t) === undefined);
        this.ensureBlankLine();
        this.forEachNamedType("leading-and-interposing", (c, className) => this.emitClassDefinition(c, className), (e, n) => this.emitEnum(e, n), (u, n) => this.emitUnion(u, n));
    }
    get enumCasesInGlobalNamespace() {
        return true;
    }
    makeEnumCaseNamer() {
        return enumNamingFunction;
    }
    makeNamedTypeNamer() {
        return namedTypeNamingFunction;
    }
    makeUnionMemberNamer() {
        return namingFunction;
    }
    namerForObjectProperty() {
        return namingFunction;
    }
    forbiddenNamesForGlobalNamespace() {
        return [...keywords];
    }
    forbiddenForObjectProperties(_c, _className) {
        return { names: [], includeGlobalForbidden: true };
    }
    forbiddenForEnumCases(_e, _enumName) {
        return { names: [], includeGlobalForbidden: true };
    }
    forbiddenForUnionMembers(_u, _unionName) {
        return { names: [], includeGlobalForbidden: true };
    }
    sourceFor(t) {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return Source_1.singleWord(this.nameForNamedType(t));
        }
        return TypeUtils_1.matchType(t, _anyType => Source_1.singleWord("mixed"), _nullType => Source_1.singleWord("mixed"), _boolType => Source_1.singleWord("bool"), _integerType => Source_1.singleWord("int"), _doubleType => Source_1.singleWord("float"), _stringType => Source_1.singleWord("string"), arrayType => Source_1.singleWord(["array(", this.sourceFor(arrayType.items).source, ")"]), _classType => Source_1.singleWord(this.nameForNamedType(_classType)), mapType => {
            let valueSource;
            const v = mapType.values;
            valueSource = this.sourceFor(v).source;
            return Source_1.singleWord(["mapping(string:", valueSource, ")"]);
        }, _enumType => Source_1.singleWord("enum"), unionType => {
            if (TypeUtils_1.nullableFromUnion(unionType) !== null) {
                const children = Array.from(unionType.getChildren()).map(c => Source_1.parenIfNeeded(this.sourceFor(c)));
                return Source_1.multiWord("|", ...children);
            }
            else {
                return Source_1.singleWord(this.nameForNamedType(unionType));
            }
        });
    }
    emitClassDefinition(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock(["class ", className], () => {
            this.emitClassMembers(c);
            this.ensureBlankLine();
            this.emitEncodingFunction(c);
        });
        this.ensureBlankLine();
        this.emitDecodingFunction(className, c);
    }
    emitEnum(e, enumName) {
        this.emitBlock([e.kind, " ", enumName], () => {
            let table = [];
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                table.push([[name, ' = "', Strings_1.stringEscape(jsonName), '", '], ['// json: "', jsonName, '"']]);
            });
            this.emitTable(table);
        });
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
            const pikeType = this.sourceFor(t).source;
            types.push([pikeType]);
        });
        this.emitLine([
            "typedef ",
            types.map(r => r.map(sl => this.sourcelikeToString(sl))).join("|"),
            " ",
            unionName,
            ";"
        ]);
        this.ensureBlankLine();
        this.emitBlock([unionName, " ", unionName, "_from_JSON(mixed json)"], () => {
            this.emitLine(["return json;"]);
        });
    }
    emitBlock(line, f, opening = " {", closing = "}") {
        this.emitLine(line, opening);
        this.indent(f);
        this.emitLine(closing);
    }
    emitMappingBlock(line, f) {
        this.emitBlock(line, f, "([", "]);");
    }
    emitClassMembers(c) {
        let table = [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const pikeType = this.sourceFor(p.type).source;
            table.push([[pikeType, " "], [name, "; "], ['// json: "', jsonName, '"']]);
        });
        this.emitTable(table);
    }
    emitInformationComment() {
        this.emitCommentLines([
            "This source has been automatically generated by quicktype.",
            "( https://github.com/quicktype/quicktype )",
            "",
            "To use this code, simply import it into your project as a Pike module.",
            "To JSON-encode your object, you can pass it to `Standards.JSON.encode`",
            "or call `encode_json` on it.",
            "",
            "To decode a JSON string, first pass it to `Standards.JSON.decode`,",
            "and then pass the result to `<YourClass>_from_JSON`.",
            "It will return an instance of <YourClass>.",
            "Bear in mind that these functions have unexpected behavior,",
            "and will likely throw an error, if the JSON string does not",
            "match the expected interface, even if the JSON itself is valid."
        ], "// ");
    }
    emitTopLevelTypedef(t, name) {
        this.emitLine("typedef ", this.sourceFor(t).source, " ", name, ";");
    }
    emitTopLevelConverter(t, name) {
        this.emitBlock([name, " ", name, "_from_JSON(mixed json)"], () => {
            if (t instanceof Type_1.PrimitiveType) {
                this.emitLine(["return json;"]);
            }
            else if (t instanceof Type_1.ArrayType) {
                if (t.items instanceof Type_1.PrimitiveType)
                    this.emitLine(["return json;"]);
                else
                    this.emitLine(["return map(json, ", this.sourceFor(t.items).source, "_from_JSON);"]);
            }
            else if (t instanceof Type_1.MapType) {
                const type = this.sourceFor(t.values).source;
                this.emitLine(["mapping(string:", type, ") retval = ([]);"]);
                let assignmentRval;
                if (t.values instanceof Type_1.PrimitiveType)
                    assignmentRval = ["(", type, ") v"];
                else
                    assignmentRval = [type, "_from_JSON(v)"];
                this.emitBlock(["foreach (json; string k; mixed v)"], () => {
                    this.emitLine(["retval[k] = ", assignmentRval, ";"]);
                });
                this.emitLine(["return retval;"]);
            }
        });
    }
    emitEncodingFunction(c) {
        this.emitBlock(["string encode_json()"], () => {
            this.emitMappingBlock(["mapping(string:mixed) json = "], () => {
                this.forEachClassProperty(c, "none", (name, jsonName) => {
                    this.emitLine(['"', Strings_1.stringEscape(jsonName), '" : ', name, ","]);
                });
            });
            this.ensureBlankLine();
            this.emitLine(["return Standards.JSON.encode(json);"]);
        });
    }
    emitDecodingFunction(className, c) {
        this.emitBlock([className, " ", className, "_from_JSON(mixed json)"], () => {
            this.emitLine([className, " retval = ", className, "();"]);
            this.ensureBlankLine();
            this.forEachClassProperty(c, "none", (name, jsonName) => {
                this.emitLine(["retval.", name, ' = json["', Strings_1.stringEscape(jsonName), '"];']);
            });
            this.ensureBlankLine();
            this.emitLine(["return retval;"]);
        });
    }
}
exports.PikeRenderer = PikeRenderer;
