"use strict";

import { Map, List } from "immutable";

import { TypeScriptTargetLanguage } from "../TargetLanguage";
import { EnumOption, StringOption } from "../RendererOptions";
import {
    TopLevels,
    NamedType,
    Type,
    matchType,
    nullableFromUnion,
    ClassType,
    UnionType,
    EnumType,
    PrimitiveType
} from "../Type";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Namer, Name, DependencyName, funPrefixNamer, AssociatedName, Namespace } from "../Naming";
import {
    legalizeCharacters,
    isLetterOrUnderscoreOrDigit,
    pascalCase,
    startWithLetter,
    isLetterOrUnderscore,
    decapitalize,
    defined,
    stringEscape,
    intercalate
} from "../Support";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";

export default class ElmTargetLanguage extends TypeScriptTargetLanguage {
    private readonly _listOption: EnumOption<boolean>;
    private readonly _moduleOption: StringOption;

    constructor() {
        const listOption = new EnumOption("array-type", "Use Array or List", [["array", false], ["list", true]]);
        // FIXME: Do this via a configurable named eventually.
        const moduleOption = new StringOption("module", "Generated module name", "NAME", "QuickType");
        const options = [moduleOption, listOption];
        super("Elm", ["elm"], "elm", options.map(o => o.definition));
        this._listOption = listOption;
        this._moduleOption = moduleOption;
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new ElmRenderer(
            topLevels,
            this._listOption.getValue(optionValues),
            this._moduleOption.getValue(optionValues)
        );
        return renderer.render();
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

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);

function elmNameStyle(original: string, upper: boolean): string {
    const legalized = legalizeName(original);
    const pascaled = pascalCase(legalized);
    const result = startWithLetter(isLetterOrUnderscore, upper, pascaled);
    return result;
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

    constructor(topLevels: TopLevels, private readonly _useList: boolean, private readonly _moduleName: string) {
        super(topLevels);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return forbiddenNames;
    }

    protected topLevelNameStyle(rawName: string): string {
        return elmNameStyle(rawName, true);
    }

    protected topLevelDependencyNames(t: Type, topLevelName: Name): DependencyName[] {
        const encoder = new DependencyName(
            lowerNamingFunction,
            List([topLevelName]),
            names => `${decapitalize(defined(names.first()))}ToString`
        );
        let decoder: DependencyName | undefined = undefined;
        if (!this.namedTypeToNameForTopLevel(t)) {
            decoder = new DependencyName(lowerNamingFunction, List([topLevelName]), names => defined(names.first()));
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

    protected namedTypeDependencyNames(t: NamedType, typeName: Name): DependencyName[] {
        const encoder = new DependencyName(
            lowerNamingFunction,
            List([typeName]),
            names => `encode${defined(names.first())}`
        );
        const decoder = new DependencyName(lowerNamingFunction, List([typeName]), names => defined(names.first()));
        this._namedTypeDependents = this._namedTypeDependents.set(typeName, { encoder, decoder });
        return [encoder, decoder];
    }

    protected get propertyNamer(): Namer {
        return lowerNamingFunction;
    }

    protected forbiddenForProperties(c: ClassType, classNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected get caseNamer(): Namer {
        return upperNamingFunction;
    }

    protected get casesInGlobalNamespace(): boolean {
        return true;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    private get arrayType(): string {
        return this._useList ? "List" : "Array";
    }

    private elmType = (t: Type, withIssues: boolean = false): MultiWord => {
        return matchType<MultiWord>(
            t,
            anyType => singleWord(maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Jdec.Value")),
            nullType => singleWord(maybeAnnotated(withIssues, nullTypeIssueAnnotation, "()")),
            boolType => singleWord("Bool"),
            integerType => singleWord("Int"),
            doubleType => singleWord("Float"),
            stringType => singleWord("String"),
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
            anyType => singleWord("Jdec.value"),
            nullType => multiWord("Jdec.null", "()"),
            boolType => singleWord("Jdec.bool"),
            integerType => singleWord("Jdec.int"),
            doubleType => singleWord("Jdec.float"),
            stringType => singleWord("Jdec.string"),
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
            anyType => singleWord("identity"),
            nullType => multiWord("always", "Jenc.null"),
            boolType => singleWord("Jenc.bool"),
            integerType => singleWord("Jenc.int"),
            doubleType => singleWord("Jenc.float"),
            stringType => singleWord("Jenc.string"),
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

    private unionConstructorName = (unionName: Name, t: Type): Sourcelike => {
        return [elmNameStyle(this.unionFieldName(t), true), "In", unionName];
    };

    private emitTopLevelDefinition = (t: Type, topLevelName: Name): void => {
        this.emitLine("type alias ", topLevelName, " = ", this.elmType(t).source);
    };

    private emitClassDefinition = (c: ClassType, className: Name): void => {
        this.emitLine("type alias ", className, " =");
        this.indent(() => {
            let onFirst = true;
            this.forEachProperty(c, "none", (name, _, t) => {
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
            this.forEachCase(e, "none", name => {
                const equalsOrPipe = onFirst ? "=" : "|";
                this.emitLine(equalsOrPipe, " ", name);
                onFirst = false;
            });
        });
    };

    private emitUnionDefinition = (u: UnionType, unionName: Name): void => {
        const members = u.members.sortBy(this.unionFieldName);
        this.emitLine("type ", unionName);
        this.indent(() => {
            let onFirst = true;
            members.forEach(t => {
                const equalsOrPipe = onFirst ? "=" : "|";
                const constructor = this.unionConstructorName(unionName, t);
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
                this.forEachProperty(c, "none", (name, jsonName, t) => {
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
                this.forEachProperty(c, "none", (name, jsonName, t) => {
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
                this.emitLine("|> Jdec.andThen (str ->");
                this.indent(() => {
                    this.emitLine("case str of");
                    this.indent(() => {
                        this.forEachCase(e, "none", (name, jsonName) => {
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
            this.forEachCase(e, "none", (name, jsonName) => {
                this.emitLine(name, ' -> Jenc.string "', stringEscape(jsonName), '"');
            });
        });
    };

    private emitUnionFunctions = (u: UnionType, unionName: Name): void => {
        // We need arrays first, then strings.
        function sortOrder(t: Type): string {
            if (t.kind === "array") {
                return "  array";
            } else if (t instanceof PrimitiveType) {
                return " " + t.kind;
            }
            return t.kind;
        }

        const members = u.members.sortBy(sortOrder);
        const decoderName = this.decoderNameForNamedType(u);
        this.emitLine(decoderName, " : Jdec.Decoder ", unionName);
        this.emitLine(decoderName, " =");
        this.indent(() => {
            this.emitLine("Jdec.oneOf");
            this.indent(() => {
                let onFirst = true;
                members.forEach(t => {
                    const bracketOrComma = onFirst ? "[" : ",";
                    const constructor = this.unionConstructorName(unionName, t);
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
            members.forEach(t => {
                const constructor = this.unionConstructorName(unionName, t);
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
