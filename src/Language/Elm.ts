"use strict";

import { Map, List } from "immutable";

import { TargetLanguage } from "../TargetLanguage";
import { EnumOption, StringOption } from "../RendererOptions";
import { NamedType, Type, matchType, nullableFromUnion, ClassType, UnionType, EnumType, PrimitiveType } from "../Type";
import { TypeGraph } from "../TypeGraph";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Namer, Name, DependencyName, funPrefixNamer, Namespace } from "../Naming";
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
} from "../Strings";
import { defined, intercalate } from "../Support";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";

export default class ElmTargetLanguage extends TargetLanguage {
    private readonly _listOption = new EnumOption("array-type", "Use Array or List", [
        ["array", false],
        ["list", true]
    ]);
    // FIXME: Do this via a configurable named eventually.
    private readonly _moduleOption = new StringOption("module", "Generated module name", "NAME", "QuickType");

    constructor() {
        super("Elm", ["elm"], "elm");
        this.setOptions([this._moduleOption, this._listOption]);
    }

    protected get rendererClass(): new (graph: TypeGraph, ...optionValues: any[]) => ConvenienceRenderer {
        return ElmRenderer;
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
    "makeNullableEncoder"
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

const upperNamingFunction = funPrefixNamer(n => elmNameStyle(n, true));
const lowerNamingFunction = funPrefixNamer(n => elmNameStyle(n, false));

type MultiWord = {
    source: Sourcelike;
    needsParens: boolean;
};

function singleWord(source: Sourcelike): MultiWord {
    return { source, needsParens: false };
}

function multiWord(a: Sourcelike, b: Sourcelike): MultiWord {
    return { source: [a, " ", b], needsParens: true };
}

function parenIfNeeded({ source, needsParens }: MultiWord): Sourcelike {
    if (needsParens) {
        return ["(", source, ")"];
    }
    return source;
}

type RequiredOrOptional = {
    reqOrOpt: string;
    fallback: string;
};

function requiredOrOptional(t: Type): RequiredOrOptional {
    function optional(fallback: string): RequiredOrOptional {
        return { reqOrOpt: "Jpipe.optional", fallback };
    }
    if (t.kind === "null") {
        return optional(" ()");
    }
    if (t instanceof UnionType && nullableFromUnion(t)) {
        return optional(" Nothing");
    }
    return { reqOrOpt: "Jpipe.required", fallback: "" };
}

type TopLevelDependent = {
    encoder: Name;
    decoder?: Name;
};

type NamedTypeDependent = {
    encoder: Name;
    decoder: Name;
};

class ElmRenderer extends ConvenienceRenderer {
    private _topLevelDependents: Map<Name, TopLevelDependent> = Map();
    private _namedTypeDependents: Map<Name, NamedTypeDependent> = Map();

    constructor(graph: TypeGraph, private readonly _moduleName: string, private readonly _useList: boolean) {
        super(graph);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return forbiddenNames;
    }

    protected topLevelNameStyle(rawName: string): string {
        return elmNameStyle(rawName, true);
    }

    protected topLevelDependencyNames(t: Type, topLevelName: Name): DependencyName[] {
        const encoder = new DependencyName(lowerNamingFunction, lookup => `${lookup(topLevelName)}_to_string`);
        let decoder: DependencyName | undefined = undefined;
        if (!this.namedTypeToNameForTopLevel(t)) {
            decoder = new DependencyName(lowerNamingFunction, lookup => lookup(topLevelName));
        }
        this._topLevelDependents = this._topLevelDependents.set(topLevelName, { encoder, decoder });
        if (decoder !== undefined) {
            return [encoder, decoder];
        }
        return [encoder];
    }

    protected get namedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namedTypeDependencyNames(_: NamedType, typeName: Name): DependencyName[] {
        const encoder = new DependencyName(lowerNamingFunction, lookup => `encode_${lookup(typeName)}`);
        const decoder = new DependencyName(lowerNamingFunction, lookup => lookup(typeName));
        this._namedTypeDependents = this._namedTypeDependents.set(typeName, { encoder, decoder });
        return [encoder, decoder];
    }

    protected get classPropertyNamer(): Namer {
        return lowerNamingFunction;
    }

    protected forbiddenForClassProperties(
        _c: ClassType,
        _classNamed: Name
    ): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected get unionMemberNamer(): Namer {
        return upperNamingFunction;
    }

    protected get unionMembersInGlobalNamespace(): boolean {
        return true;
    }

    protected get enumCaseNamer(): Namer {
        return upperNamingFunction;
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return true;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
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

    private get arrayType(): string {
        return this._useList ? "List" : "Array";
    }

    private elmType = (t: Type, withIssues: boolean = false): MultiWord => {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord(maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Jdec.Value")),
            _nullType => singleWord(maybeAnnotated(withIssues, nullTypeIssueAnnotation, "()")),
            _boolType => singleWord("Bool"),
            _integerType => singleWord("Int"),
            _doubleType => singleWord("Float"),
            _stringType => singleWord("String"),
            arrayType => multiWord(this.arrayType, parenIfNeeded(this.elmType(arrayType.items, withIssues))),
            classType => singleWord(this.nameForNamedType(classType)),
            mapType => multiWord("Dict String", parenIfNeeded(this.elmType(mapType.values, withIssues))),
            enumType => singleWord(this.nameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable) return multiWord("Maybe", parenIfNeeded(this.elmType(nullable, withIssues)));
                return singleWord(this.nameForNamedType(unionType));
            }
        );
    };

    private decoderNameForNamedType = (t: NamedType): Name => {
        const name = this.nameForNamedType(t);
        return defined(this._namedTypeDependents.get(name)).decoder;
    };

    private decoderNameForType = (t: Type): MultiWord => {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("Jdec.value"),
            _nullType => multiWord("Jdec.null", "()"),
            _boolType => singleWord("Jdec.bool"),
            _integerType => singleWord("Jdec.int"),
            _doubleType => singleWord("Jdec.float"),
            _stringType => singleWord("Jdec.string"),
            arrayType =>
                multiWord(
                    ["Jdec.", decapitalize(this.arrayType)],
                    parenIfNeeded(this.decoderNameForType(arrayType.items))
                ),
            classType => singleWord(this.decoderNameForNamedType(classType)),
            mapType => multiWord("Jdec.dict", parenIfNeeded(this.decoderNameForType(mapType.values))),
            enumType => singleWord(this.decoderNameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable) return multiWord("Jdec.nullable", parenIfNeeded(this.decoderNameForType(nullable)));
                return singleWord(this.decoderNameForNamedType(unionType));
            }
        );
    };

    private encoderNameForNamedType = (t: NamedType): Name => {
        const name = this.nameForNamedType(t);
        return defined(this._namedTypeDependents.get(name)).encoder;
    };

    private encoderNameForType = (t: Type): MultiWord => {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("identity"),
            _nullType => multiWord("always", "Jenc.null"),
            _boolType => singleWord("Jenc.bool"),
            _integerType => singleWord("Jenc.int"),
            _doubleType => singleWord("Jenc.float"),
            _stringType => singleWord("Jenc.string"),
            arrayType =>
                multiWord(["make", this.arrayType, "Encoder"], parenIfNeeded(this.encoderNameForType(arrayType.items))),
            classType => singleWord(this.encoderNameForNamedType(classType)),
            mapType => multiWord("makeDictEncoder", parenIfNeeded(this.encoderNameForType(mapType.values))),
            enumType => singleWord(this.encoderNameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable) return multiWord("makeNullableEncoder", parenIfNeeded(this.encoderNameForType(nullable)));
                return singleWord(this.encoderNameForNamedType(unionType));
            }
        );
    };

    private emitTopLevelDefinition = (t: Type, topLevelName: Name): void => {
        this.emitLine("type alias ", topLevelName, " = ", this.elmType(t).source);
    };

    private emitClassDefinition = (c: ClassType, className: Name): void => {
        this.emitLine("type alias ", className, " =");
        this.indent(() => {
            let onFirst = true;
            this.forEachClassProperty(c, "none", (name, _, t) => {
                this.emitLine(onFirst ? "{" : ",", " ", name, " : ", this.elmType(t).source);
                onFirst = false;
            });
            if (onFirst) {
                this.emitLine("{");
            }
            this.emitLine("}");
        });
    };

    private emitEnumDefinition = (e: EnumType, enumName: Name): void => {
        this.emitLine("type ", enumName);
        this.indent(() => {
            let onFirst = true;
            this.forEachEnumCase(e, "none", name => {
                const equalsOrPipe = onFirst ? "=" : "|";
                this.emitLine(equalsOrPipe, " ", name);
                onFirst = false;
            });
        });
    };

    private emitUnionDefinition = (u: UnionType, unionName: Name): void => {
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
    };

    private emitTopLevelFunctions = (t: Type, topLevelName: Name): void => {
        const { encoder, decoder } = defined(this._topLevelDependents.get(topLevelName));
        if (!this.namedTypeToNameForTopLevel(t)) {
            this.emitLine(defined(decoder), " : Jdec.Decoder ", topLevelName);
            this.emitLine(defined(decoder), " = ", this.decoderNameForType(t).source);
            this.emitNewline();
        }
        this.emitLine(encoder, " : ", topLevelName, " -> String");
        this.emitLine(encoder, " r = Jenc.encode 0 (", this.encoderNameForType(t).source, " r)");
    };

    private emitClassFunctions = (c: ClassType, className: Name): void => {
        const decoderName = this.decoderNameForNamedType(c);
        this.emitLine(decoderName, " : Jdec.Decoder ", className);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Jpipe.decode ", className);
            this.indent(() => {
                this.forEachClassProperty(c, "none", (_, jsonName, t) => {
                    const propDecoder = parenIfNeeded(this.decoderNameForType(t));
                    const { reqOrOpt, fallback } = requiredOrOptional(t);
                    this.emitLine("|> ", reqOrOpt, ' "', stringEscape(jsonName), '" ', propDecoder, fallback);
                });
            });
        });
        this.emitNewline();

        const encoderName = this.encoderNameForNamedType(c);
        this.emitLine(encoderName, " : ", className, " -> Jenc.Value");
        this.emitLine(encoderName, " x =");
        this.indent(() => {
            this.emitLine("Jenc.object");
            this.indent(() => {
                let onFirst = true;
                this.forEachClassProperty(c, "none", (name, jsonName, t) => {
                    const bracketOrComma = onFirst ? "[" : ",";
                    const propEncoder = this.encoderNameForType(t).source;
                    this.emitLine(bracketOrComma, ' ("', stringEscape(jsonName), '", ', propEncoder, " x.", name, ")");
                    onFirst = false;
                });
                if (onFirst) {
                    this.emitLine("[");
                }
                this.emitLine("]");
            });
        });
    };

    private emitEnumFunctions = (e: EnumType, enumName: Name): void => {
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
        this.emitNewline();

        const encoderName = this.encoderNameForNamedType(e);
        this.emitLine(encoderName, " : ", enumName, " -> Jenc.Value");
        this.emitLine(encoderName, " x = case x of");
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine(name, ' -> Jenc.string "', stringEscape(jsonName), '"');
            });
        });
    };

    private emitUnionFunctions = (u: UnionType, unionName: Name): void => {
        // We need arrays first, then strings.
        function sortOrder(_: Name, t: Type): string {
            if (t.kind === "array") {
                return "  array";
            } else if (t instanceof PrimitiveType) {
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
        this.emitNewline();

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
    };

    protected emitSourceStructure(): void {
        const exports: Sourcelike[] = [];
        let topLevelDecoders: List<Sourcelike> = List();
        this.forEachTopLevel("none", (_, name) => {
            let { encoder, decoder } = defined(this._topLevelDependents.get(name));
            if (decoder === undefined) {
                decoder = defined(this._namedTypeDependents.get(name)).decoder;
            }
            topLevelDecoders = topLevelDecoders.push(decoder);
            exports.push(name, encoder, decoder);
        });
        this.forEachClass("none", (t, name) => {
            if (!this.topLevels.contains(t)) exports.push(name);
        });
        this.forEachUnion("none", (t, name) => {
            if (!this.topLevels.contains(t)) exports.push([name, "(..)"]);
        });

        this.emitMultiline(`-- To decode the JSON data, add this file to your project, run
--
--     elm-package install NoRedInk/elm-decode-pipeline
--
-- add these imports
--
--     import Json.Decode exposing (decodeString)`);
        this.emitLine(
            "--     import ",
            this._moduleName,
            " exposing (",
            intercalate(", ", topLevelDecoders).toArray(),
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
        this.emitNewline();

        this.emitLine("module ", this._moduleName, " exposing");
        this.indent(() => {
            for (let i = 0; i < exports.length; i++) {
                this.emitLine(i === 0 ? "(" : ",", " ", exports[i]);
            }
            this.emitLine(")");
        });
        this.emitNewline();

        this.emitMultiline(`import Json.Decode as Jdec
import Json.Decode.Pipeline as Jpipe
import Json.Encode as Jenc
import Dict exposing (Dict, map, toList)`);
        if (this._useList) {
            this.emitLine("import List exposing (map)");
        } else {
            this.emitLine("import Array exposing (Array, map)");
        }

        this.forEachTopLevel(
            "leading-and-interposing",
            this.emitTopLevelDefinition,
            t => !this.namedTypeToNameForTopLevel(t)
        );
        this.forEachNamedType(
            "leading-and-interposing",
            false,
            this.emitClassDefinition,
            this.emitEnumDefinition,
            this.emitUnionDefinition
        );
        this.emitNewline();

        this.emitLine("-- decoders and encoders");
        this.forEachTopLevel("leading-and-interposing", this.emitTopLevelFunctions);
        this.forEachNamedType(
            "leading-and-interposing",
            false,
            this.emitClassFunctions,
            this.emitEnumFunctions,
            this.emitUnionFunctions
        );
        this.emitNewline();

        this.emitLine("--- encoder helpers");
        this.emitNewline();
        this.emitLine("make", this.arrayType, "Encoder : (a -> Jenc.Value) -> ", this.arrayType, " a -> Jenc.Value");
        this.emitLine("make", this.arrayType, "Encoder f arr =");
        this.indent(() => {
            this.emitLine("Jenc.", decapitalize(this.arrayType), " (", this.arrayType, ".map f arr)");
        });
        this.emitNewline();
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
