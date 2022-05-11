"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TargetLanguage_1 = require("../TargetLanguage");
const RendererOptions_1 = require("../RendererOptions");
const TypeUtils_1 = require("../TypeUtils");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Naming_1 = require("../Naming");
const Strings_1 = require("../support/Strings");
const Source_1 = require("../Source");
exports.haskellOptions = {
    justTypes: new RendererOptions_1.BooleanOption("just-types", "Plain types only", false),
    useList: new RendererOptions_1.EnumOption("array-type", "Use Array or List", [
        ["array", false],
        ["list", true],
    ]),
    moduleName: new RendererOptions_1.StringOption("module", "Generated module name", "NAME", "QuickType"),
};
class HaskellTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Haskell", ["haskell"], "haskell");
    }
    getOptions() {
        return [exports.haskellOptions.justTypes, exports.haskellOptions.moduleName, exports.haskellOptions.useList];
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    get supportsUnionsWithBothNumberTypes() {
        return true;
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new HaskellRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.haskellOptions, untypedOptionValues));
    }
}
exports.HaskellTargetLanguage = HaskellTargetLanguage;
const forbiddenNames = [
    // reserved keywords
    "as",
    "case",
    "class",
    "data",
    "default",
    "deriving",
    "do",
    "else",
    "family",
    "forall",
    "foreign",
    "hiding",
    "if",
    "import",
    "in",
    "infix",
    "infixl",
    "infixr",
    "instance",
    "let",
    "of",
    "mdo",
    "module",
    "newtype",
    "proc",
    "qualified",
    "rec",
    "then",
    "type",
    "where",
    // in Prelude keywords ...
    "id",
    "Array",
    "HashMap",
    "Map",
    "Maybe",
    "Bool",
    "Int",
    "True",
    "False",
    "Enum",
    // Aeson types
    "encode",
    "decode",
    "text",
    "Text",
    "Value",
    "Object",
    "Result",
    "Series",
    "Error",
];
const legalizeName = Strings_1.legalizeCharacters((cp) => Strings_1.isAscii(cp) && Strings_1.isLetterOrUnderscoreOrDigit(cp));
function haskellNameStyle(original, upper) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, upper ? Strings_1.firstUpperWordStyle : Strings_1.allLowerWordStyle, Strings_1.firstUpperWordStyle, upper ? Strings_1.allUpperWordStyle : Strings_1.allLowerWordStyle, Strings_1.allUpperWordStyle, "", Strings_1.isLetterOrUnderscore);
}
const upperNamingFunction = Naming_1.funPrefixNamer("upper", (n) => haskellNameStyle(n, true));
const lowerNamingFunction = Naming_1.funPrefixNamer("lower", (n) => haskellNameStyle(n, false));
class HaskellRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
    }
    forbiddenNamesForGlobalNamespace() {
        return forbiddenNames;
    }
    makeNamedTypeNamer() {
        return upperNamingFunction;
    }
    namerForObjectProperty() {
        return lowerNamingFunction;
    }
    forbiddenForObjectProperties(_c, _className) {
        return { names: [], includeGlobalForbidden: true };
    }
    makeUnionMemberNamer() {
        return upperNamingFunction;
    }
    get unionMembersInGlobalNamespace() {
        return true;
    }
    makeEnumCaseNamer() {
        return upperNamingFunction;
    }
    get enumCasesInGlobalNamespace() {
        return true;
    }
    proposeUnionMemberName(u, unionName, fieldType, lookup) {
        const fieldName = super.proposeUnionMemberName(u, unionName, fieldType, lookup);
        return `${fieldName}_in_${lookup(unionName)}`;
    }
    get commentLineStart() {
        return "-- ";
    }
    emitDescriptionBlock(lines) {
        if (lines.length === 1) {
            this.emitLine("{-| ", lines[0], " -}");
        }
        else {
            this.emitCommentLines(lines, "", undefined, "-}", "{-| ");
        }
    }
    haskellType(t, noOptional = false) {
        return TypeUtils_1.matchType(t, (_anyType) => Source_1.multiWord(" ", "Maybe", "Text"), (_nullType) => Source_1.multiWord(" ", "Maybe", "Text"), (_boolType) => Source_1.singleWord("Bool"), (_integerType) => Source_1.singleWord("Int"), (_doubleType) => Source_1.singleWord("Float"), (_stringType) => Source_1.singleWord("Text"), (arrayType) => {
            if (this._options.useList) {
                return Source_1.multiWord("", "[", Source_1.parenIfNeeded(this.haskellType(arrayType.items)), "]");
            }
            return Source_1.multiWord(" ", "Vector", Source_1.parenIfNeeded(this.haskellType(arrayType.items)));
        }, (classType) => Source_1.singleWord(this.nameForNamedType(classType)), (mapType) => Source_1.multiWord(" ", "HashMap Text", Source_1.parenIfNeeded(this.haskellType(mapType.values))), (enumType) => Source_1.singleWord(this.nameForNamedType(enumType)), (unionType) => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                const nullableType = this.haskellType(nullable);
                if (noOptional)
                    return nullableType;
                return Source_1.multiWord(" ", "Maybe", Source_1.parenIfNeeded(nullableType));
            }
            return Source_1.singleWord(this.nameForNamedType(unionType));
        });
    }
    haskellProperty(p) {
        if (p.isOptional) {
            return Source_1.multiWord(" ", "Maybe", Source_1.parenIfNeeded(this.haskellType(p.type, true))).source;
        }
        else {
            return this.haskellType(p.type).source;
        }
    }
    encoderNameForType(t) {
        return TypeUtils_1.matchType(t, _anyType => Source_1.singleWord("String"), _nullType => Source_1.singleWord("Null"), _boolType => Source_1.singleWord("Bool"), _integerType => Source_1.singleWord("Number"), _doubleType => Source_1.singleWord("Number"), _stringType => Source_1.singleWord("String"), _arrayType => Source_1.singleWord("Array"), _classType => Source_1.singleWord("Object"), _mapType => Source_1.singleWord("Object"), _enumType => Source_1.singleWord("Object"), _unionType => Source_1.singleWord("Object"));
    }
    emitTopLevelDefinition(t, topLevelName) {
        this.emitLine("type ", topLevelName, " = ", this.haskellType(t).source);
    }
    emitClassDefinition(c, className) {
        let description = this.descriptionForType(c);
        this.forEachClassProperty(c, "none", (name, jsonName) => {
            const propertyDescription = this.descriptionForClassProperty(c, jsonName);
            if (propertyDescription === undefined)
                return;
            if (description === undefined) {
                description = [];
            }
            else {
                description.push("");
            }
            description.push(`${this.sourcelikeToString(name)}:`);
            description.push(...propertyDescription);
        });
        this.emitDescription(description);
        this.emitLine("data ", className, " = ", className);
        this.indent(() => {
            let onFirst = true;
            this.forEachClassProperty(c, "none", (name, _jsonName, p) => {
                this.emitLine(onFirst ? "{ " : ", ", name, className, " :: ", this.haskellProperty(p));
                onFirst = false;
            });
            if (onFirst) {
                this.emitLine("{");
            }
            this.emitLine("} deriving (Show)");
        });
    }
    emitEnumDefinition(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("data ", enumName);
        this.indent(() => {
            let onFirst = true;
            this.forEachEnumCase(e, "none", (name) => {
                const equalsOrPipe = onFirst ? "=" : "|";
                this.emitLine(equalsOrPipe, " ", name, enumName);
                onFirst = false;
            });
            this.emitLine("deriving (Show)");
        });
    }
    emitUnionDefinition(u, unionName) {
        this.emitDescription(this.descriptionForType(u));
        this.emitLine("data ", unionName);
        this.indent(() => {
            let onFirst = true;
            this.forEachUnionMember(u, null, "none", null, (constructor, t) => {
                const equalsOrPipe = onFirst ? "=" : "|";
                if (t.kind === "null") {
                    this.emitLine(equalsOrPipe, " ", constructor);
                }
                else {
                    this.emitLine(equalsOrPipe, " ", constructor, " ", Source_1.parenIfNeeded(this.haskellType(t)));
                }
                onFirst = false;
            });
            this.emitLine("deriving (Show)");
        });
    }
    emitTopLevelFunctions(topLevelName) {
        this.emitLine("decodeTopLevel :: ByteString -> Maybe ", topLevelName);
        this.emitLine("decodeTopLevel = decode");
    }
    classPropertyLength(c) {
        let counter = 0;
        this.forEachClassProperty(c, "none", () => {
            counter += 1;
        });
        return counter;
    }
    emitClassEncoderInstance(c, className) {
        let classProperties = [];
        this.forEachClassProperty(c, "none", (name) => {
            classProperties.push(" ");
            classProperties.push(name);
            classProperties.push(className);
        });
        this.emitLine("instance ToJSON ", className, " where");
        this.indent(() => {
            if (classProperties.length === 0) {
                this.emitLine("toJSON = \\_ -> emptyObject");
            }
            else {
                this.emitLine("toJSON (", className, ...classProperties, ") =");
                this.indent(() => {
                    this.emitLine("object");
                    let onFirst = true;
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        this.emitLine(onFirst ? "[ " : ", ", "\"", Strings_1.stringEscape(jsonName), "\" .= ", name, className);
                        onFirst = false;
                    });
                    if (onFirst) {
                        this.emitLine("[");
                    }
                    this.emitLine("]");
                });
            }
        });
    }
    emitClassDecoderInstance(c, className) {
        this.emitLine("instance FromJSON ", className, " where");
        this.indent(() => {
            if (this.classPropertyLength(c) === 0) {
                this.emitLine("parseJSON emptyObject = return ", className);
            }
            else {
                this.emitLine("parseJSON (Object v) = ", className);
                this.indent(() => {
                    let onFirst = true;
                    this.forEachClassProperty(c, "none", (_, jsonName, p) => {
                        const operator = p.isOptional ? ".:?" : ".:";
                        this.emitLine(onFirst ? "<$> " : "<*> ", "v ", operator, " \"", Strings_1.stringEscape(jsonName), "\"");
                        onFirst = false;
                    });
                });
            }
        });
    }
    emitClassFunctions(c, className) {
        this.emitClassEncoderInstance(c, className);
        this.ensureBlankLine();
        this.emitClassDecoderInstance(c, className);
    }
    emitEnumEncoderInstance(e, enumName) {
        this.emitLine("instance ToJSON ", enumName, " where");
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine("toJSON ", name, enumName, " = \"", Strings_1.stringEscape(jsonName), "\"");
            });
        });
    }
    emitEnumDecoderInstance(e, enumName) {
        this.emitLine("instance FromJSON ", enumName, " where");
        this.indent(() => {
            this.emitLine("parseJSON = withText \"", enumName, "\" parseText");
            this.indent(() => {
                this.emitLine("where");
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        this.emitLine("parseText \"", Strings_1.stringEscape(jsonName), "\" = return ", name, enumName);
                    });
                });
            });
        });
    }
    emitEnumFunctions(e, enumName) {
        this.emitEnumEncoderInstance(e, enumName);
        this.ensureBlankLine();
        this.emitEnumDecoderInstance(e, enumName);
    }
    emitUnionEncoderInstance(u, unionName) {
        this.emitLine("instance ToJSON ", unionName, " where");
        this.indent(() => {
            this.forEachUnionMember(u, null, "none", null, (constructor, t) => {
                if (t.kind === "null") {
                    this.emitLine("toJSON ", constructor, " = Null");
                }
                else {
                    this.emitLine("toJSON (", constructor, " x) = toJSON x");
                }
            });
        });
    }
    emitUnionDecoderInstance(u, unionName) {
        this.emitLine("instance FromJSON ", unionName, " where");
        this.indent(() => {
            this.forEachUnionMember(u, null, "none", null, (constructor, t) => {
                if (t.kind === "null") {
                    this.emitLine("parseJSON Null = return ", constructor);
                }
                else {
                    this.emitLine("parseJSON xs@(", this.encoderNameForType(t).source, " _) = (fmap ", constructor, " . parseJSON) xs");
                }
            });
        });
    }
    emitUnionFunctions(u, unionName) {
        this.emitUnionEncoderInstance(u, unionName);
        this.ensureBlankLine();
        this.emitUnionDecoderInstance(u, unionName);
    }
    emitLanguageExtensions(ext) {
        this.emitLine(`{-# LANGUAGE ${ext} #-}`);
    }
    emitSourceStructure() {
        const exports = [];
        this.forEachTopLevel("none", (_, name) => {
            exports.push([name, " (..)"]);
        });
        this.forEachObject("none", (t, name) => {
            if (!collection_utils_1.mapContains(this.topLevels, t))
                exports.push([name, " (..)"]);
        });
        this.forEachEnum("none", (t, name) => {
            if (!collection_utils_1.mapContains(this.topLevels, t))
                exports.push([name, " (..)"]);
        });
        this.forEachUnion("none", (t, name) => {
            if (!collection_utils_1.mapContains(this.topLevels, t))
                exports.push([name, " (..)"]);
        });
        this.emitLanguageExtensions("StrictData");
        this.emitLanguageExtensions("OverloadedStrings");
        if (!this._options.justTypes) {
            this.ensureBlankLine();
            this.emitLine("module ", this._options.moduleName);
            this.indent(() => {
                for (let i = 0; i < exports.length; i++) {
                    this.emitLine(i === 0 ? "(" : ",", " ", exports[i]);
                }
                this.emitLine(", decodeTopLevel");
                this.emitLine(") where");
            });
            this.ensureBlankLine();
            this.emitMultiline(`import Data.Aeson
import Data.Aeson.Types (emptyObject)
import Data.ByteString.Lazy (ByteString)
import Data.HashMap.Strict (HashMap)
import Data.Text (Text)`);
            if (this._options.useList) {
                // this.emitLine("import List (map)");
            }
            else {
                this.emitLine("import Data.Vector (Vector)");
            }
        }
        this.forEachTopLevel("leading-and-interposing", (t, topLevelName) => this.emitTopLevelDefinition(t, topLevelName), t => this.namedTypeToNameForTopLevel(t) === undefined);
        this.forEachNamedType("leading-and-interposing", (c, className) => this.emitClassDefinition(c, className), (e, enumName) => this.emitEnumDefinition(e, enumName), (u, unionName) => this.emitUnionDefinition(u, unionName));
        this.forEachTopLevel("leading-and-interposing", (_, topLevelName) => this.emitTopLevelFunctions(topLevelName));
        this.forEachNamedType("leading-and-interposing", (c, className) => this.emitClassFunctions(c, className), (e, enumName) => this.emitEnumFunctions(e, enumName), (u, unionName) => this.emitUnionFunctions(u, unionName));
        if (this._options.justTypes)
            return;
        this.ensureBlankLine();
    }
}
exports.HaskellRenderer = HaskellRenderer;
