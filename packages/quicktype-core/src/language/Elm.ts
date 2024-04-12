import { arrayIntercalate, mapContains } from "collection-utils";

import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, type ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { DependencyName, type Name, type Namer, funPrefixNamer } from "../Naming";
import { type RenderContext } from "../Renderer";
import {
    BooleanOption,
    EnumOption,
    type Option,
    type OptionValues,
    StringOption,
    getOptionValues
} from "../RendererOptions";
import { type MultiWord, type Sourcelike, annotated, multiWord, parenIfNeeded, singleWord } from "../Source";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    decapitalize,
    firstUpperWordStyle,
    isAscii,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    legalizeCharacters,
    splitIntoWords,
    stringEscape
} from "../support/Strings";
import { defined } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { type ClassProperty, type ClassType, type EnumType, type Type, UnionType } from "../Type";
import { matchType, nullableFromUnion } from "../TypeUtils";

export const elmOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    useList: new EnumOption("array-type", "Use Array or List", [
        ["array", false],
        ["list", true]
    ]),
    // FIXME: Do this via a configurable named eventually.
    moduleName: new StringOption("module", "Generated module name", "NAME", "QuickType")
};

export class ElmTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Elm", ["elm"], "elm");
    }

    protected getOptions(): Array<Option<any>> {
        return [elmOptions.justTypes, elmOptions.moduleName, elmOptions.useList];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): ElmRenderer {
        return new ElmRenderer(this, renderContext, getOptionValues(elmOptions, untypedOptionValues));
    }
}

const forbiddenNames = [
    "if",
    "then",
    "else",
    "case",
    "of",
    "let",
    "in",
    "infix",
    "type",
    "module",
    "where",
    "import",
    "exposing",
    "as",
    "port",
    "int",
    "float",
    "bool",
    "string",
    "Jenc",
    "Jdec",
    "Jpipe",
    "always",
    "identity",
    "Array",
    "List",
    "Dict",
    "Maybe",
    "map",
    "toList",
    "makeArrayEncoder",
    "makeDictEncoder",
    "makeNullableEncoder",
    "Int",
    "True",
    "False",
    "String",
    "Float"
];

const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

function elmNameStyle(original: string, upper: boolean): string {
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

const upperNamingFunction = funPrefixNamer("upper", n => elmNameStyle(n, true));
const lowerNamingFunction = funPrefixNamer("lower", n => elmNameStyle(n, false));

interface RequiredOrOptional {
    fallback: string;
    reqOrOpt: string;
}

function requiredOrOptional(p: ClassProperty): RequiredOrOptional {
    function optional(fallback: string): RequiredOrOptional {
        return { reqOrOpt: "Jpipe.optional", fallback };
    }

    const t = p.type;
    if (p.isOptional || (t instanceof UnionType && nullableFromUnion(t) !== null)) {
        return optional(" Nothing");
    }

    if (t.kind === "null") {
        return optional(" ()");
    }

    return { reqOrOpt: "Jpipe.required", fallback: "" };
}

interface TopLevelDependent {
    decoder?: Name;
    encoder: Name;
}

interface NamedTypeDependent {
    decoder: Name;
    encoder: Name;
}

export class ElmRenderer extends ConvenienceRenderer {
    private readonly _topLevelDependents = new Map<Name, TopLevelDependent>();

    private readonly _namedTypeDependents = new Map<Name, NamedTypeDependent>();

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof elmOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return forbiddenNames;
    }

    protected makeTopLevelDependencyNames(t: Type, topLevelName: Name): DependencyName[] {
        const encoder = new DependencyName(
            lowerNamingFunction,
            topLevelName.order,
            lookup => `${lookup(topLevelName)}_to_string`
        );
        let decoder: DependencyName | undefined = undefined;
        if (this.namedTypeToNameForTopLevel(t) === undefined) {
            decoder = new DependencyName(lowerNamingFunction, topLevelName.order, lookup => lookup(topLevelName));
        }

        this._topLevelDependents.set(topLevelName, { encoder, decoder });
        if (decoder !== undefined) {
            return [encoder, decoder];
        }

        return [encoder];
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected makeNamedTypeDependencyNames(_: Type, typeName: Name): DependencyName[] {
        const encoder = new DependencyName(lowerNamingFunction, typeName.order, lookup => `encode_${lookup(typeName)}`);
        const decoder = new DependencyName(lowerNamingFunction, typeName.order, lookup => lookup(typeName));
        this._namedTypeDependents.set(typeName, { encoder, decoder });
        return [encoder, decoder];
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
            this.emitCommentLines(lines, { firstLineStart: "{-| ", lineStart: "", afterComment: "-}" });
        }
    }

    private get arrayType(): string {
        return this._options.useList ? "List" : "Array";
    }

    private elmType(t: Type, noOptional = false): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord(annotated(anyTypeIssueAnnotation, "Jdec.Value")),
            _nullType => singleWord(annotated(nullTypeIssueAnnotation, "()")),
            _boolType => singleWord("Bool"),
            _integerType => singleWord("Int"),
            _doubleType => singleWord("Float"),
            _stringType => singleWord("String"),
            arrayType => multiWord(" ", this.arrayType, parenIfNeeded(this.elmType(arrayType.items))),
            classType => singleWord(this.nameForNamedType(classType)),
            mapType => multiWord(" ", "Dict String", parenIfNeeded(this.elmType(mapType.values))),
            enumType => singleWord(this.nameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    const nullableType = this.elmType(nullable);
                    if (noOptional) return nullableType;
                    return multiWord(" ", "Maybe", parenIfNeeded(nullableType));
                }

                return singleWord(this.nameForNamedType(unionType));
            }
        );
    }

    private elmProperty(p: ClassProperty): Sourcelike {
        if (p.isOptional) {
            return multiWord(" ", "Maybe", parenIfNeeded(this.elmType(p.type, true))).source;
        } else {
            return this.elmType(p.type).source;
        }
    }

    private decoderNameForNamedType(t: Type): Name {
        const name = this.nameForNamedType(t);
        return defined(this._namedTypeDependents.get(name)).decoder;
    }

    private decoderNameForType(t: Type, noOptional = false): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("Jdec.value"),
            _nullType => multiWord(" ", "Jdec.null", "()"),
            _boolType => singleWord("Jdec.bool"),
            _integerType => singleWord("Jdec.int"),
            _doubleType => singleWord("Jdec.float"),
            _stringType => singleWord("Jdec.string"),
            arrayType =>
                multiWord(
                    " ",
                    ["Jdec.", decapitalize(this.arrayType)],
                    parenIfNeeded(this.decoderNameForType(arrayType.items))
                ),
            classType => singleWord(this.decoderNameForNamedType(classType)),
            mapType => multiWord(" ", "Jdec.dict", parenIfNeeded(this.decoderNameForType(mapType.values))),
            enumType => singleWord(this.decoderNameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    const nullableDecoder = this.decoderNameForType(nullable);
                    if (noOptional) return nullableDecoder;
                    return multiWord(" ", "Jdec.nullable", parenIfNeeded(nullableDecoder));
                }

                return singleWord(this.decoderNameForNamedType(unionType));
            }
        );
    }

    private decoderNameForProperty(p: ClassProperty): MultiWord {
        if (p.isOptional) {
            return multiWord(" ", "Jdec.nullable", parenIfNeeded(this.decoderNameForType(p.type, true)));
        } else {
            return this.decoderNameForType(p.type);
        }
    }

    private encoderNameForNamedType(t: Type): Name {
        const name = this.nameForNamedType(t);
        return defined(this._namedTypeDependents.get(name)).encoder;
    }

    private encoderNameForType(t: Type, noOptional = false): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("identity"),
            _nullType => multiWord(" ", "always", "Jenc.null"),
            _boolType => singleWord("Jenc.bool"),
            _integerType => singleWord("Jenc.int"),
            _doubleType => singleWord("Jenc.float"),
            _stringType => singleWord("Jenc.string"),
            arrayType =>
                multiWord(
                    " ",
                    ["make", this.arrayType, "Encoder"],
                    parenIfNeeded(this.encoderNameForType(arrayType.items))
                ),
            classType => singleWord(this.encoderNameForNamedType(classType)),
            mapType => multiWord(" ", "makeDictEncoder", parenIfNeeded(this.encoderNameForType(mapType.values))),
            enumType => singleWord(this.encoderNameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    const nullableEncoder = this.encoderNameForType(nullable);
                    if (noOptional) return nullableEncoder;
                    return multiWord(" ", "makeNullableEncoder", parenIfNeeded(nullableEncoder));
                }

                return singleWord(this.encoderNameForNamedType(unionType));
            }
        );
    }

    private encoderNameForProperty(p: ClassProperty): MultiWord {
        if (p.isOptional) {
            return multiWord(" ", "makeNullableEncoder", parenIfNeeded(this.encoderNameForType(p.type, true)));
        } else {
            return this.encoderNameForType(p.type);
        }
    }

    private emitTopLevelDefinition(t: Type, topLevelName: Name): void {
        this.emitLine("type alias ", topLevelName, " = ", this.elmType(t).source);
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
        this.emitLine("type alias ", className, " =");
        this.indent(() => {
            let onFirst = true;
            this.forEachClassProperty(c, "none", (name, _jsonName, p) => {
                this.emitLine(onFirst ? "{" : ",", " ", name, " : ", this.elmProperty(p));
                onFirst = false;
            });
            if (onFirst) {
                this.emitLine("{");
            }

            this.emitLine("}");
        });
    }

    private emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("type ", enumName);
        this.indent(() => {
            let onFirst = true;
            this.forEachEnumCase(e, "none", name => {
                const equalsOrPipe = onFirst ? "=" : "|";
                this.emitLine(equalsOrPipe, " ", name);
                onFirst = false;
            });
        });
    }

    private emitUnionDefinition(u: UnionType, unionName: Name): void {
        this.emitDescription(this.descriptionForType(u));
        this.emitLine("type ", unionName);
        this.indent(() => {
            let onFirst = true;
            this.forEachUnionMember(u, null, "none", null, (constructor, t) => {
                const equalsOrPipe = onFirst ? "=" : "|";
                if (t.kind === "null") {
                    this.emitLine(equalsOrPipe, " ", constructor);
                } else {
                    this.emitLine(equalsOrPipe, " ", constructor, " ", parenIfNeeded(this.elmType(t)));
                }

                onFirst = false;
            });
        });
    }

    private emitTopLevelFunctions(t: Type, topLevelName: Name): void {
        const { encoder, decoder } = defined(this._topLevelDependents.get(topLevelName));
        if (this.namedTypeToNameForTopLevel(t) === undefined) {
            this.emitLine(defined(decoder), " : Jdec.Decoder ", topLevelName);
            this.emitLine(defined(decoder), " = ", this.decoderNameForType(t).source);
            this.ensureBlankLine();
        }

        this.emitLine(encoder, " : ", topLevelName, " -> String");
        this.emitLine(encoder, " r = Jenc.encode 0 (", this.encoderNameForType(t).source, " r)");
    }

    private emitClassFunctions(c: ClassType, className: Name): void {
        const decoderName = this.decoderNameForNamedType(c);
        this.emitLine(decoderName, " : Jdec.Decoder ", className);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Jpipe.decode ", className);
            this.indent(() => {
                this.forEachClassProperty(c, "none", (_, jsonName, p) => {
                    const propDecoder = parenIfNeeded(this.decoderNameForProperty(p));
                    const { reqOrOpt, fallback } = requiredOrOptional(p);
                    this.emitLine("|> ", reqOrOpt, ' "', stringEscape(jsonName), '" ', propDecoder, fallback);
                });
            });
        });
        this.ensureBlankLine();

        const encoderName = this.encoderNameForNamedType(c);
        this.emitLine(encoderName, " : ", className, " -> Jenc.Value");
        this.emitLine(encoderName, " x =");
        this.indent(() => {
            this.emitLine("Jenc.object");
            this.indent(() => {
                let onFirst = true;
                this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                    const bracketOrComma = onFirst ? "[" : ",";
                    const propEncoder = this.encoderNameForProperty(p).source;
                    this.emitLine(bracketOrComma, ' ("', stringEscape(jsonName), '", ', propEncoder, " x.", name, ")");
                    onFirst = false;
                });
                if (onFirst) {
                    this.emitLine("[");
                }

                this.emitLine("]");
            });
        });
    }

    private emitEnumFunctions(e: EnumType, enumName: Name): void {
        const decoderName = this.decoderNameForNamedType(e);
        this.emitLine(decoderName, " : Jdec.Decoder ", enumName);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Jdec.string");
            this.indent(() => {
                this.emitLine("|> Jdec.andThen (\\str ->");
                this.indent(() => {
                    this.emitLine("case str of");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            this.emitLine('"', stringEscape(jsonName), '" -> Jdec.succeed ', name);
                        });
                        this.emitLine('somethingElse -> Jdec.fail <| "Invalid ', enumName, ': " ++ somethingElse');
                    });
                });
                this.emitLine(")");
            });
        });
        this.ensureBlankLine();

        const encoderName = this.encoderNameForNamedType(e);
        this.emitLine(encoderName, " : ", enumName, " -> Jenc.Value");
        this.emitLine(encoderName, " x = case x of");
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine(name, ' -> Jenc.string "', stringEscape(jsonName), '"');
            });
        });
    }

    private emitUnionFunctions(u: UnionType, unionName: Name): void {
        // We need arrays first, then strings, and integers before doubles.
        function sortOrder(_: Name, t: Type): string {
            if (t.kind === "array") {
                return "  array";
            } else if (t.kind === "double") {
                return " xdouble";
            } else if (t.isPrimitive()) {
                return " " + t.kind;
            }

            return t.kind;
        }

        const decoderName = this.decoderNameForNamedType(u);
        this.emitLine(decoderName, " : Jdec.Decoder ", unionName);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Jdec.oneOf");
            this.indent(() => {
                let onFirst = true;
                this.forEachUnionMember(u, null, "none", sortOrder, (constructor, t) => {
                    const bracketOrComma = onFirst ? "[" : ",";
                    if (t.kind === "null") {
                        this.emitLine(bracketOrComma, " Jdec.null ", constructor);
                    } else {
                        const decoder = parenIfNeeded(this.decoderNameForType(t));
                        this.emitLine(bracketOrComma, " Jdec.map ", constructor, " ", decoder);
                    }

                    onFirst = false;
                });
                this.emitLine("]");
            });
        });
        this.ensureBlankLine();

        const encoderName = this.encoderNameForNamedType(u);
        this.emitLine(encoderName, " : ", unionName, " -> Jenc.Value");
        this.emitLine(encoderName, " x = case x of");
        this.indent(() => {
            this.forEachUnionMember(u, null, "none", sortOrder, (constructor, t) => {
                if (t.kind === "null") {
                    this.emitLine(constructor, " -> Jenc.null");
                } else {
                    const encoder = this.encoderNameForType(t).source;
                    this.emitLine(constructor, " y -> ", encoder, " y");
                }
            });
        });
    }

    protected emitSourceStructure(): void {
        const exports: Sourcelike[] = [];
        const topLevelDecoders: Sourcelike[] = [];
        this.forEachTopLevel("none", (_, name) => {
            let { encoder, decoder } = defined(this._topLevelDependents.get(name));
            if (decoder === undefined) {
                decoder = defined(this._namedTypeDependents.get(name)).decoder;
            }

            topLevelDecoders.push(decoder);
            exports.push(name, encoder, decoder);
        });
        this.forEachObject("none", (t: ClassType, name: Name) => {
            if (!mapContains(this.topLevels, t)) exports.push(name);
        });
        this.forEachEnum("none", (t, name) => {
            if (!mapContains(this.topLevels, t)) exports.push([name, "(..)"]);
        });
        this.forEachUnion("none", (t, name) => {
            if (!mapContains(this.topLevels, t)) exports.push([name, "(..)"]);
        });

        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitCommentLines([
                "To decode the JSON data, add this file to your project, run",
                "",
                "    elm-package install NoRedInk/elm-decode-pipeline",
                "",
                "add these imports",
                "",
                "    import Json.Decode exposing (decodeString)`);"
            ]);
            this.emitLine(
                "--     import ",
                this._options.moduleName,
                " exposing (",
                arrayIntercalate(", ", topLevelDecoders),
                ")"
            );
            this.emitMultiline(`--
-- and you're off to the races with
--`);
            this.forEachTopLevel("none", (_, name) => {
                let { decoder } = defined(this._topLevelDependents.get(name));
                if (decoder === undefined) {
                    decoder = defined(this._namedTypeDependents.get(name)).decoder;
                }

                this.emitLine("--     decodeString ", decoder, " myJsonString");
            });
        }

        if (!this._options.justTypes) {
            this.ensureBlankLine();
            this.emitLine("module ", this._options.moduleName, " exposing");
            this.indent(() => {
                for (let i = 0; i < exports.length; i++) {
                    this.emitLine(i === 0 ? "(" : ",", " ", exports[i]);
                }

                this.emitLine(")");
            });
            this.ensureBlankLine();

            this.emitMultiline(`import Json.Decode as Jdec
import Json.Decode.Pipeline as Jpipe
import Json.Encode as Jenc
import Dict exposing (Dict, map, toList)`);
            if (this._options.useList) {
                this.emitLine("import List exposing (map)");
            } else {
                this.emitLine("import Array exposing (Array, map)");
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

        if (this._options.justTypes) return;

        this.ensureBlankLine();
        this.emitLine("-- decoders and encoders");
        this.forEachTopLevel("leading-and-interposing", (t: Type, topLevelName: Name) =>
            this.emitTopLevelFunctions(t, topLevelName)
        );
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) => this.emitClassFunctions(c, className),
            (e: EnumType, enumName: Name) => this.emitEnumFunctions(e, enumName),
            (u: UnionType, unionName: Name) => this.emitUnionFunctions(u, unionName)
        );
        this.ensureBlankLine();

        this.emitLine("--- encoder helpers");
        this.ensureBlankLine();
        this.emitLine("make", this.arrayType, "Encoder : (a -> Jenc.Value) -> ", this.arrayType, " a -> Jenc.Value");
        this.emitLine("make", this.arrayType, "Encoder f arr =");
        this.indent(() => {
            this.emitLine("Jenc.", decapitalize(this.arrayType), " (", this.arrayType, ".map f arr)");
        });
        this.ensureBlankLine();
        this.emitMultiline(`makeDictEncoder : (a -> Jenc.Value) -> Dict String a -> Jenc.Value
makeDictEncoder f dict =
    Jenc.object (toList (Dict.map (\\k -> f) dict))

makeNullableEncoder : (a -> Jenc.Value) -> Maybe a -> Jenc.Value
makeNullableEncoder f m =
    case m of
    Just x -> f x
    Nothing -> Jenc.null`);
    }
}
