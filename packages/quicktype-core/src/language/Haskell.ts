import { mapContains } from "collection-utils";
import { type LanguageConfig, TargetLanguage } from "../TargetLanguage";
import { EnumOption, StringOption, BooleanOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { Type, ClassType, UnionType, EnumType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion } from "../TypeUtils";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Namer, Name, funPrefixNamer } from "../Naming";
import {
    legalizeCharacters,
    isLetterOrUnderscoreOrDigit,
    isLetterOrUnderscore,
    stringEscape,
    isAscii,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle
} from "../support/Strings";
import { Sourcelike, MultiWord, singleWord, multiWord, parenIfNeeded } from "../Source";
import { RenderContext } from "../Renderer";

export const haskellOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    useList: new EnumOption("array-type", "Use Array or List", [
        ["array", false],
        ["list", true]
    ]),
    moduleName: new StringOption("module", "Generated module name", "NAME", "QuickType")
};

export class HaskellTargetLanguage extends TargetLanguage implements LanguageConfig {
    readonly displayName = "Haskell" as const;
    readonly names = ["haskell"] as const;
    readonly extension = "haskell" as const;

    protected getOptions(): Option<any>[] {
        return [haskellOptions.justTypes, haskellOptions.moduleName, haskellOptions.useList];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): HaskellRenderer {
        return new HaskellRenderer(this, renderContext, getOptionValues(haskellOptions, untypedOptionValues));
    }
}

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
    "Error"
];

const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

function haskellNameStyle(original: string, upper: boolean): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        upper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isLetterOrUnderscore
    );
}

const upperNamingFunction = funPrefixNamer("upper", n => haskellNameStyle(n, true));
const lowerNamingFunction = funPrefixNamer("lower", n => haskellNameStyle(n, false));

export class HaskellRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof haskellOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return forbiddenNames;
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return lowerNamingFunction;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeUnionMemberNamer(): Namer {
        return upperNamingFunction;
    }

    protected get unionMembersInGlobalNamespace(): boolean {
        return true;
    }

    protected makeEnumCaseNamer(): Namer {
        return upperNamingFunction;
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return true;
    }

    protected proposeUnionMemberName(
        u: UnionType,
        unionName: Name,
        fieldType: Type,
        lookup: (n: Name) => string
    ): string {
        const fieldName = super.proposeUnionMemberName(u, unionName, fieldType, lookup);
        return `${fieldName}_in_${lookup(unionName)}`;
    }

    protected get commentLineStart(): string {
        return "-- ";
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        if (lines.length === 1) {
            this.emitComments([{ customLines: lines, lineStart: "{-| ", lineEnd: " -}" }]);
        } else {
            this.emitCommentLines(lines, {
                firstLineStart: "{-| ",
                lineStart: "",
                afterComment: "-}"
            });
        }
    }

    private haskellType(t: Type, noOptional = false): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => multiWord(" ", "Maybe", "Text"),
            _nullType => multiWord(" ", "Maybe", "Text"),
            _boolType => singleWord("Bool"),
            _integerType => singleWord("Int"),
            _doubleType => singleWord("Float"),
            _stringType => singleWord("Text"),
            arrayType => {
                if (this._options.useList) {
                    return multiWord("", "[", parenIfNeeded(this.haskellType(arrayType.items)), "]");
                }
                return multiWord(" ", "Vector", parenIfNeeded(this.haskellType(arrayType.items)));
            },
            classType => singleWord(this.nameForNamedType(classType)),
            mapType => multiWord(" ", "HashMap Text", parenIfNeeded(this.haskellType(mapType.values))),
            enumType => singleWord(this.nameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    const nullableType = this.haskellType(nullable);
                    if (noOptional) return nullableType;
                    return multiWord(" ", "Maybe", parenIfNeeded(nullableType));
                }
                return singleWord(this.nameForNamedType(unionType));
            }
        );
    }

    private haskellProperty(p: ClassProperty): Sourcelike {
        if (p.isOptional) {
            return multiWord(" ", "Maybe", parenIfNeeded(this.haskellType(p.type, true))).source;
        } else {
            return this.haskellType(p.type).source;
        }
    }

    private encoderNameForType(t: Type): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("String"),
            _nullType => singleWord("Null"),
            _boolType => singleWord("Bool"),
            _integerType => singleWord("Number"),
            _doubleType => singleWord("Number"),
            _stringType => singleWord("String"),
            _arrayType => singleWord("Array"),
            _classType => singleWord("Object"),
            _mapType => singleWord("Object"),
            _enumType => singleWord("Object"),
            _unionType => singleWord("Object")
        );
    }

    private emitTopLevelDefinition(t: Type, topLevelName: Name): void {
        this.emitLine("type ", topLevelName, " = ", this.haskellType(t).source);
    }

    private emitClassDefinition(c: ClassType, className: Name): void {
        let description = this.descriptionForType(c);
        this.forEachClassProperty(c, "none", (name, jsonName) => {
            const propertyDescription = this.descriptionForClassProperty(c, jsonName);
            if (propertyDescription === undefined) return;

            if (description === undefined) {
                description = [];
            } else {
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

    private emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("data ", enumName);
        this.indent(() => {
            let onFirst = true;
            this.forEachEnumCase(e, "none", name => {
                const equalsOrPipe = onFirst ? "=" : "|";
                this.emitLine(equalsOrPipe, " ", name, enumName);
                onFirst = false;
            });
            this.emitLine("deriving (Show)");
        });
    }

    private emitUnionDefinition(u: UnionType, unionName: Name): void {
        this.emitDescription(this.descriptionForType(u));
        this.emitLine("data ", unionName);
        this.indent(() => {
            let onFirst = true;
            this.forEachUnionMember(u, null, "none", null, (constructor, t) => {
                const equalsOrPipe = onFirst ? "=" : "|";
                if (t.kind === "null") {
                    this.emitLine(equalsOrPipe, " ", constructor);
                } else {
                    this.emitLine(equalsOrPipe, " ", constructor, " ", parenIfNeeded(this.haskellType(t)));
                }
                onFirst = false;
            });
            this.emitLine("deriving (Show)");
        });
    }

    private emitTopLevelFunctions(topLevelName: Name): void {
        this.emitLine("decodeTopLevel :: ByteString -> Maybe ", topLevelName);
        this.emitLine("decodeTopLevel = decode");
    }

    private classPropertyLength(c: ClassType): number {
        let counter = 0;
        this.forEachClassProperty(c, "none", () => {
            counter += 1;
        });
        return counter;
    }

    private emitClassEncoderInstance(c: ClassType, className: Name): void {
        let classProperties: Array<Name | string> = [];
        this.forEachClassProperty(c, "none", name => {
            classProperties.push(" ");
            classProperties.push(name);
            classProperties.push(className);
        });

        this.emitLine("instance ToJSON ", className, " where");
        this.indent(() => {
            if (classProperties.length === 0) {
                this.emitLine("toJSON = \\_ -> emptyObject");
            } else {
                this.emitLine("toJSON (", className, ...classProperties, ") =");
                this.indent(() => {
                    this.emitLine("object");
                    let onFirst = true;
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        this.emitLine(onFirst ? "[ " : ", ", '"', stringEscape(jsonName), '" .= ', name, className);
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

    private emitClassDecoderInstance(c: ClassType, className: Name): void {
        this.emitLine("instance FromJSON ", className, " where");

        this.indent(() => {
            if (this.classPropertyLength(c) === 0) {
                this.emitLine("parseJSON emptyObject = return ", className);
            } else {
                this.emitLine("parseJSON (Object v) = ", className);
                this.indent(() => {
                    let onFirst = true;
                    this.forEachClassProperty(c, "none", (_, jsonName, p) => {
                        const operator = p.isOptional ? ".:?" : ".:";
                        this.emitLine(onFirst ? "<$> " : "<*> ", "v ", operator, ' "', stringEscape(jsonName), '"');
                        onFirst = false;
                    });
                });
            }
        });
    }

    private emitClassFunctions(c: ClassType, className: Name): void {
        this.emitClassEncoderInstance(c, className);
        this.ensureBlankLine();
        this.emitClassDecoderInstance(c, className);
    }

    private emitEnumEncoderInstance(e: EnumType, enumName: Name): void {
        this.emitLine("instance ToJSON ", enumName, " where");
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine("toJSON ", name, enumName, ' = "', stringEscape(jsonName), '"');
            });
        });
    }

    private emitEnumDecoderInstance(e: EnumType, enumName: Name): void {
        this.emitLine("instance FromJSON ", enumName, " where");
        this.indent(() => {
            this.emitLine('parseJSON = withText "', enumName, '" parseText');
            this.indent(() => {
                this.emitLine("where");
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        this.emitLine('parseText "', stringEscape(jsonName), '" = return ', name, enumName);
                    });
                });
            });
        });
    }

    private emitEnumFunctions(e: EnumType, enumName: Name): void {
        this.emitEnumEncoderInstance(e, enumName);
        this.ensureBlankLine();
        this.emitEnumDecoderInstance(e, enumName);
    }

    private emitUnionEncoderInstance(u: UnionType, unionName: Name): void {
        this.emitLine("instance ToJSON ", unionName, " where");
        this.indent(() => {
            this.forEachUnionMember(u, null, "none", null, (constructor, t) => {
                if (t.kind === "null") {
                    this.emitLine("toJSON ", constructor, " = Null");
                } else {
                    this.emitLine("toJSON (", constructor, " x) = toJSON x");
                }
            });
        });
    }

    private emitUnionDecoderInstance(u: UnionType, unionName: Name): void {
        this.emitLine("instance FromJSON ", unionName, " where");
        this.indent(() => {
            this.forEachUnionMember(u, null, "none", null, (constructor, t) => {
                if (t.kind === "null") {
                    this.emitLine("parseJSON Null = return ", constructor);
                } else {
                    this.emitLine(
                        "parseJSON xs@(",
                        this.encoderNameForType(t).source,
                        " _) = (fmap ",
                        constructor,
                        " . parseJSON) xs"
                    );
                }
            });
        });
    }

    private emitUnionFunctions(u: UnionType, unionName: Name): void {
        this.emitUnionEncoderInstance(u, unionName);
        this.ensureBlankLine();
        this.emitUnionDecoderInstance(u, unionName);
    }

    private emitLanguageExtensions(ext: string): void {
        this.emitLine(`{-# LANGUAGE ${ext} #-}`);
    }

    protected emitSourceStructure(): void {
        const exports: Sourcelike[] = [];
        this.forEachTopLevel("none", (_, name) => {
            exports.push([name, " (..)"]);
        });
        this.forEachObject("none", (t: ClassType, name: Name) => {
            if (!mapContains(this.topLevels, t)) exports.push([name, " (..)"]);
        });
        this.forEachEnum("none", (t, name) => {
            if (!mapContains(this.topLevels, t)) exports.push([name, " (..)"]);
        });
        this.forEachUnion("none", (t, name) => {
            if (!mapContains(this.topLevels, t)) exports.push([name, " (..)"]);
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
            } else {
                this.emitLine("import Data.Vector (Vector)");
            }
        }

        this.forEachTopLevel(
            "leading-and-interposing",
            (t: Type, topLevelName: Name) => this.emitTopLevelDefinition(t, topLevelName),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) => this.emitClassDefinition(c, className),
            (e: EnumType, enumName: Name) => this.emitEnumDefinition(e, enumName),
            (u: UnionType, unionName: Name) => this.emitUnionDefinition(u, unionName)
        );

        this.forEachTopLevel("leading-and-interposing", (_: Type, topLevelName: Name) =>
            this.emitTopLevelFunctions(topLevelName)
        );

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) => this.emitClassFunctions(c, className),
            (e: EnumType, enumName: Name) => this.emitEnumFunctions(e, enumName),
            (u: UnionType, unionName: Name) => this.emitUnionFunctions(u, unionName)
        );

        if (this._options.justTypes) return;

        this.ensureBlankLine();
    }
}
