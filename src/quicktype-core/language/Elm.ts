import { mapContains, arrayIntercalate } from "collection-utils";

import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Namer, Name, DependencyName, funPrefixNamer } from "../Naming";
import { RenderContext } from "../Renderer";
import { EnumOption, StringOption, BooleanOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { Sourcelike, annotated, MultiWord, singleWord, multiWord, parenIfNeeded } from "../Source";
import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, UnionType, EnumType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion } from "../TypeUtils";

import { defined } from "../support/Support";
import {
    legalizeCharacters,
    isLetterOrUnderscoreOrDigit,
    isLetterOrUnderscore,
    decapitalize,
    stringEscape,
    isAscii,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle
} from "../support/Strings";

// CONSTANTS

const forbiddenNames = [
    "if",
    "then",
    "else",
    "case",
    "of",
    "let",
    "in",
    "type",
    "module",
    "where",
    "import",
    "exposing",
    "as",
    "port",

    "always",
    "identity",
    "never",
    "e",
    "compare",
    "min",
    "max",
    "round",
    "floor",
    "ceiling",

    "Array",
    "List",
    "Dict",
    "Maybe",
    "Just",
    "Nothing",
    "Result",
    "Ok",
    "Err",
    "Int",
    "True",
    "False",
    "String",
    "Float",

    "encoder"
];

export const elmOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    moduleName: new StringOption("module", "Generated module name", "NAME", "QuickType"),
    useArray: new EnumOption("array-type", "Use Array or List (default is List)", [
        ["list", false],
        ["array", true]
    ])
};

// Types

type RequiredOrOptional = {
    reqOrOpt: string;
    fallback: string;
};

type TopLevelDependent = {
    encoder: Name;
    decoder?: Name;
};

type NamedTypeDependent = {
    encoder: Name;
    decoder: Name;
    unit: Name;
};

// 🛠

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

const lowerNamingFunction = funPrefixNamer("lower", n => elmNameStyle(n, false));
const upperNamingFunction = funPrefixNamer("upper", n => elmNameStyle(n, true));

function optional(fallback: string): RequiredOrOptional {
    return { reqOrOpt: "Json.Decode.Pipeline.optional", fallback };
}

function requiredOrOptional(p: ClassProperty): RequiredOrOptional {
    const t = p.type;

    if (p.isOptional || (t instanceof UnionType && nullableFromUnion(t) !== null)) {
        return optional(" Nothing");
    }

    if (t.kind === "null") {
        return optional(" ()");
    }

    return { reqOrOpt: "Json.Decode.Pipeline.required", fallback: "" };
}

// RENDERER

export class ElmRenderer extends ConvenienceRenderer {
    private readonly _topLevelDependents = new Map<Name, TopLevelDependent>();
    private readonly _namedTypeDependents = new Map<Name, NamedTypeDependent>();

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof elmOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    // NAMES
    // -----

    protected forbiddenForObjectProperties(): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return forbiddenNames;
    }

    private get arrayType(): string {
        return this._options.useArray ? "Array" : "List";
    }

    protected get commentLineStart(): string {
        return "-- ";
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return true;
    }

    protected get unionMembersInGlobalNamespace(): boolean {
        return true;
    }

    protected makeEnumCaseNamer(): Namer {
        return upperNamingFunction;
    }

    protected makeNamedTypeDependencyNames(_: Type, typeName: Name): DependencyName[] {
        const encoder = new DependencyName(lowerNamingFunction, typeName.order, lookup => `encode_${lookup(typeName)}`);
        const decoder = new DependencyName(lowerNamingFunction, typeName.order, lookup => lookup(typeName));
        const unit = new DependencyName(lowerNamingFunction, typeName.order, lookup => `${lookup(typeName)}_unit`);
        this._namedTypeDependents.set(typeName, { encoder, decoder, unit });
        return [encoder, decoder, unit];
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
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

        return decoder !== undefined ? [encoder, decoder] : [encoder];
    }

    protected makeUnionMemberNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return lowerNamingFunction;
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

    private unitNameForNamedType(t: Type): Name {
        const name = this.nameForNamedType(t);
        return defined(this._namedTypeDependents.get(name)).unit;
    }

    // TYPES & PROPERTIES
    // ------------------

    private elmType(t: Type, noOptional: boolean = false): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord(annotated(anyTypeIssueAnnotation, "Json.Decode.Value")),
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

    // DECODING
    // --------

    private decoderNameForNamedType(t: Type): Name {
        const name = this.nameForNamedType(t);
        return defined(this._namedTypeDependents.get(name)).decoder;
    }

    private decoderNameForType(t: Type, noOptional: boolean = false): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("Json.Decode.value"),
            _nullType => multiWord(" ", "Json.Decode.null", "()"),
            _boolType => singleWord("Json.Decode.bool"),
            _integerType => singleWord("Json.Decode.int"),
            _doubleType => singleWord("Json.Decode.float"),
            _stringType => singleWord("Json.Decode.string"),
            arrayType =>
                multiWord(
                    " ",
                    ["Json.Decode.", decapitalize(this.arrayType)],
                    parenIfNeeded(this.decoderNameForType(arrayType.items))
                ),
            classType => singleWord(this.decoderNameForNamedType(classType)),
            mapType => multiWord(" ", "Json.Decode.dict", parenIfNeeded(this.decoderNameForType(mapType.values))),
            enumType => singleWord(this.decoderNameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);

                if (nullable !== null) {
                    const nullableDecoder = this.decoderNameForType(nullable);
                    if (noOptional) return nullableDecoder;
                    return multiWord(" ", "Json.Decode.nullable", parenIfNeeded(nullableDecoder));
                }

                return singleWord(this.decoderNameForNamedType(unionType));
            }
        );
    }

    private decoderNameForProperty(p: ClassProperty): MultiWord {
        if (p.isOptional) {
            return multiWord(" ", "Json.Decode.nullable", parenIfNeeded(this.decoderNameForType(p.type, true)));
        } else {
            return this.decoderNameForType(p.type);
        }
    }

    // ENCODING
    // --------

    private encoderNameForNamedType(t: Type): Name {
        const name = this.nameForNamedType(t);
        return defined(this._namedTypeDependents.get(name)).encoder;
    }

    private encoderNameForType(t: Type, noOptional: boolean = false): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("identity"),
            _nullType => multiWord(" ", "always", "Json.Encode.null"),
            _boolType => singleWord("Json.Encode.bool"),
            _integerType => singleWord("Json.Encode.int"),
            _doubleType => singleWord("Json.Encode.float"),
            _stringType => singleWord("Json.Encode.string"),
            arrayType =>
                multiWord(
                    " ",
                    ["Json.Encode.", decapitalize(this.arrayType)],
                    parenIfNeeded(this.encoderNameForType(arrayType.items))
                ),
            classType => singleWord(this.encoderNameForNamedType(classType)),
            mapType =>
                multiWord(" ", "Json.Encode.dict identity", parenIfNeeded(this.encoderNameForType(mapType.values))),
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

    // EMITTERS
    // --------

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        if (lines.length === 1) {
            this.emitLine("{-| ", lines[0]);
            this.emitLine("-}");
        } else {
            this.emitCommentLines(lines, "", undefined, "\n-}", "{-| ");
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

            if (onFirst) this.emitLine("{");
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
            this.emitLine(defined(decoder), " : Decoder ", topLevelName);
            this.emitLine(defined(decoder), " = ", this.decoderNameForType(t).source);
            this.ensureBlankLine();
            this.ensureBlankLine();
        }

        this.emitLine(encoder, " : ", topLevelName, " -> String");
        this.emitLine(encoder, " = ", this.encoderNameForType(t).source, " >> Json.Encode.encode 0");
    }

    private emitClassFunctions(c: ClassType, className: Name): void {
        const decoderName = this.decoderNameForNamedType(c);
        const unitName = this.unitNameForNamedType(c);

        this.emitLine(decoderName, " : Json.Decode.Decoder ", className);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Json.Decode.succeed ", className);
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
        this.emitLine(encoderName, " : ", className, " -> Json.Encode.Value");
        this.emitLine(encoderName, " ", unitName, " =");
        this.indent(() => {
            this.emitLine("Json.Encode.object");
            this.indent(() => {
                let onFirst = true;

                this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                    const bracketOrComma = onFirst ? "[" : ",";
                    const propEncoder = this.encoderNameForProperty(p).source;
                    this.emitLine(
                        bracketOrComma,
                        ' ("',
                        stringEscape(jsonName),
                        '", ',
                        propEncoder,
                        " ",
                        unitName,
                        ".",
                        name,
                        ")"
                    );
                    onFirst = false;
                });

                if (onFirst) this.emitLine("[");
                this.emitLine("]");
            });
        });
    }

    private emitEnumFunctions(e: EnumType, enumName: Name): void {
        const decoderName = this.decoderNameForNamedType(e);
        const unitName = this.unitNameForNamedType(e);

        this.emitLine(decoderName, " : Json.Decode.Decoder ", enumName);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Json.Decode.string");
            this.indent(() => {
                this.emitLine("|> Json.Decode.andThen (\\str ->");
                this.indent(() => {
                    this.emitLine("case str of");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            this.emitLine('"', stringEscape(jsonName), '" -> Json.Decode.succeed ', name);
                        });
                        this.emitLine(
                            'somethingElse -> Json.Decode.fail <| "Invalid ',
                            enumName,
                            ': " ++ somethingElse'
                        );
                    });
                });
                this.emitLine(")");
            });
        });

        this.ensureBlankLine();

        const encoderName = this.encoderNameForNamedType(e);
        this.emitLine(encoderName, " : ", enumName, " -> Json.Encode.Value");
        this.emitLine(encoderName, " ", unitName, " = case ", unitName, " of");
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine(name, ' -> Json.Encode.string "', stringEscape(jsonName), '"');
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

        this.emitLine(decoderName, " : Json.Decode.Decoder ", unionName);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Json.Decode.oneOf");
            this.indent(() => {
                let onFirst = true;

                this.forEachUnionMember(u, null, "none", sortOrder, (constructor, t) => {
                    const bracketOrComma = onFirst ? "[" : ",";

                    if (t.kind === "null") {
                        this.emitLine(bracketOrComma, " Json.Decode.null ", constructor);
                    } else {
                        const decoder = parenIfNeeded(this.decoderNameForType(t));
                        this.emitLine(bracketOrComma, " Json.Decode.map ", constructor, " ", decoder);
                    }

                    onFirst = false;
                });

                this.emitLine("]");
            });
        });

        this.ensureBlankLine();

        const encoderName = this.encoderNameForNamedType(u);
        const unitName = this.unitNameForNamedType(u);

        this.emitLine(encoderName, " : ", unionName, " -> Json.Encode.Value");
        this.emitLine(encoderName, " ", unitName, " = case ", unitName, " of");
        this.indent(() => {
            this.forEachUnionMember(u, null, "none", sortOrder, (constructor, t) => {
                if (t.kind === "null") {
                    this.emitLine(constructor, " -> Json.Encode.null");
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
            const namedTypeDependents = defined(this._namedTypeDependents.get(name));
            if (decoder === undefined) {
                decoder = namedTypeDependents.decoder;
            }
            const rawEncoder = namedTypeDependents.encoder;
            topLevelDecoders.push(decoder);
            exports.push(name, encoder, rawEncoder, decoder);
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

        if (!this._options.justTypes) {
            this.ensureBlankLine();
            this.emitLine("module ", this._options.moduleName, " exposing");
            this.indent(() => {
                for (let i = 0; i < exports.length; i++) {
                    this.emitLine(i === 0 ? "(" : ",", " ", exports[i]);
                }
                this.emitLine(")");
            });
        }

        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this._options.justTypes) {
            const decoders: Array<Name> = [];

            this.forEachTopLevel("none", (_, name) => {
                let { decoder } = defined(this._topLevelDependents.get(name));
                if (decoder === undefined) {
                    decoder = defined(this._namedTypeDependents.get(name)).decoder;
                }
                decoders.push(decoder);
            });

            this.ensureBlankLine();
            this.emitDescriptionBlock(
                [
                    "To decode the JSON data, add this file to your project, run:",
                    "",
                    "        elm install NoRedInk/elm-json-decode-pipeline",
                    "",
                    "add these imports",
                    "",
                    "        import Json.Decode",
                    `        import ${this._options.moduleName} exposing (${this.sourcelikeToString(
                        arrayIntercalate(", ", topLevelDecoders)
                    )})`,
                    "",
                    "and you're off to the races with",
                    ""
                ].concat(decoders.map(decoder => `        Json.Decode.decodeValue ${decoder} myJsonValue`))
            );
        }

        if (!this._options.justTypes) {
            this.ensureBlankLine();
            this.emitMultiline(`import Json.Decode exposing (Decoder)
import Json.Decode.Pipeline
import Json.Encode
import Dict exposing (Dict)`);
            if (this._options.useArray) {
                this.emitLine("import Array exposing (Array)");
            } else {
                this.emitLine("import List");
            }

            this.ensureBlankLine();
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
        this.ensureBlankLine();
        this.ensureBlankLine();
        this.emitLine("-- Decoders & Encoders");

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
        this.ensureBlankLine();
        this.ensureBlankLine();
        this.emitLine("--- Helpers");
        this.ensureBlankLine();
        this.ensureBlankLine();
        this.emitMultiline(`makeNullableEncoder : (a -> Json.Encode.Value) -> Maybe a -> Json.Encode.Value
makeNullableEncoder encoder =
    Maybe.map encoder >> Maybe.withDefault Json.Encode.null`);
    }
}

// TARGET

export class ElmTargetLanguage extends TargetLanguage {
    constructor() {
        super("Elm", ["elm"], "elm");
    }

    protected getOptions(): Option<unknown>[] {
        return [elmOptions.justTypes, elmOptions.moduleName, elmOptions.useArray];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: unknown }): ElmRenderer {
        return new ElmRenderer(this, renderContext, getOptionValues(elmOptions, untypedOptionValues));
    }
}
