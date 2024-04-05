import unicode from "unicode-properties";

import { Sourcelike, modifySource, multiWord } from "../Source";
import { Namer, Name } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { Option, BooleanOption, EnumOption, OptionValues, getOptionValues, StringOption } from "../RendererOptions";

import * as keywords from "./ruby/keywords";

import { Type, EnumType, ClassType, UnionType, ArrayType, MapType, ClassProperty, PrimitiveType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";

import {
    legalizeCharacters,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    allLowerWordStyle,
    utf32ConcatMap,
    isPrintable,
    escapeNonPrintableMapper,
    intToHex,
    snakeCase,
    isLetterOrUnderscore
} from "../support/Strings";
import { RenderContext } from "../Renderer";
import { json } from "stream/consumers";

const forbiddenModuleNames = [
    "Access",
    "Agent",
    "Any",
    "Application",
    "ArgumentError",
    "ArithmeticError",
    "Atom",
    "BadArityError",
    "BadBooleanError",
    "BadFunctionError",
    "BadMapError",
    "BadStructError",
    "Base",
    "Behaviour",
    "Bitwise",
    "Calendar",
    "CaseClauseError",
    "Code",
    "Collectable",
    "CondClauseError",
    "Config",
    "Date",
    "DateTime",
    "Dict",
    "DynamicSupervisor",
    "Enum",
    "ErlangError",
    "Exception",
    "File",
    "Float",
    "Function",
    "FunctionClauseError",
    "GenEvent",
    "GenServer",
    "HashDict",
    "HashSet",
    "IO",
    "Inspect",
    "Integer",
    "Kernel",
    "KeyError",
    "Keyword",
    "List",
    "Macro",
    "Map",
    "MapSet",
    "MatchError",
    "Module",
    "Node",
    "OptionParser",
    "Path",
    "Port",
    "Process",
    "Protocol",
    "Range",
    "Record",
    "Regex",
    "Registry",
    "RuntimeError",
    "Set",
    "Stream",
    "String",
    "StringIO",
    "Supervisor",
    "SyntaxError",
    "System",
    "SystemLimitError",
    "Task",
    "Time",
    "TokenMissingError",
    "Tuple",
    "URI",
    "UndefinedFunctionError",
    "UnicodeConversionError",
    "Version",
    "WithClauseError"
];
const reservedWords = [
    "def",
    "defmodule",
    "use",
    "import",
    "alias",
    "true",
    "false",
    "nil",
    "when",
    "and",
    "or",
    "not",
    "in",
    "fn",
    "do",
    "end",
    "catch",
    "rescue",
    "after",
    "else"
];

function unicodeEscape(codePoint: number): string {
    return "\\u{" + intToHex(codePoint, 0) + "}";
}

function capitalizeFirstLetter(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

function escapeDoubleQuotes(str: string) {
    return str.replace(/"/g, '\\"');
}

function escapeNewLines(str: string) {
    return str.replace(/\n/g, "\\n");
}

export enum Strictness {
    Strict = "Strict::",
    Coercible = "Coercible::",
    None = "Types::"
}

export const elixirOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    strictness: new EnumOption("strictness", "Type strictness", [
        ["strict", Strictness.Strict],
        ["coercible", Strictness.Coercible],
        ["none", Strictness.None]
    ]),
    namespace: new StringOption("namespace", "Specify a wrapping Namespace", "NAME", "", "secondary")
};

export class ElixirTargetLanguage extends TargetLanguage {
    constructor() {
        super("Elixir", ["elixir"], "ex");
    }

    protected getOptions(): Option<any>[] {
        return [elixirOptions.justTypes, elixirOptions.strictness, elixirOptions.namespace];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): ElixirRenderer {
        return new ElixirRenderer(this, renderContext, getOptionValues(elixirOptions, untypedOptionValues));
    }
}

const isStartCharacter = isLetterOrUnderscore;

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function simpleNameStyle(original: string, uppercase: boolean): string {
    if (/^[0-9]+$/.test(original)) {
        original = original + "N";
    }
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        uppercase ? firstUpperWordStyle : allLowerWordStyle,
        uppercase ? firstUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function memberNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        allLowerWordStyle,
        allLowerWordStyle,
        allLowerWordStyle,
        allLowerWordStyle,
        "_",
        isStartCharacter
    );
}

export class ElixirRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof elixirOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected get commentLineStart(): string {
        return "# ";
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    protected canBeForwardDeclared(t: Type): boolean {
        return "class" === t.kind;
        // return true;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [...forbiddenModuleNames, ...reservedWords.map(word => capitalizeFirstLetter(word))];
    }

    protected forbiddenForObjectProperties(_c: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: reservedWords, includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return new Namer("types", n => simpleNameStyle(n, true), []);
    }

    protected namerForObjectProperty(): Namer {
        return new Namer("properties", memberNameStyle, []);
    }

    protected makeUnionMemberNamer(): Namer {
        return new Namer("properties", memberNameStyle, []);
    }

    protected makeEnumCaseNamer(): Namer {
        return new Namer("enum-cases", n => simpleNameStyle(n, true), []);
    }

    private elixirType(t: Type, isOptional = false): Sourcelike {
        const optional = isOptional ? " | nil" : "";
        return matchType<Sourcelike>(
            t,
            _anyType => ["any()", optional],
            _nullType => ["nil"],
            _boolType => ["boolean()", optional],
            _integerType => ["integer()", optional],
            _doubleType => ["float()", optional],
            _stringType => ["String.t()", optional],
            arrayType => ["[", this.elixirType(arrayType.items), "]", optional],
            classType => [this.nameForNamedType(classType), ".t()", optional],
            mapType => ["%{String.t() => ", this.elixirType(mapType.values), "}", optional],
            enumType => [this.nameForNamedType(enumType), ".t()", optional],
            unionType => {
                const children = [...unionType.getChildren()].map(t => this.elixirType(t));
                return [
                    children.flatMap((element, index) => (index === children.length - 1 ? element : [element, " | "])),
                    optional
                ];
            }
        );
    }

    private exampleUse(t: Type, exp: Sourcelike, depth = 6, optional = false): Sourcelike {
        if (depth-- <= 0) {
            return exp;
        }

        const safeNav = optional ? "&" : "";

        return matchType<Sourcelike>(
            t,
            _anyType => exp,
            _nullType => [exp, ".nil?"],
            _boolType => exp,
            _integerType => [exp, ".even?"],
            _doubleType => exp,
            _stringType => exp,
            arrayType => this.exampleUse(arrayType.items, [exp, safeNav, ".first"], depth),
            classType => {
                let info: { name: Name; prop: ClassProperty } | undefined;
                this.forEachClassProperty(classType, "none", (name, _json, prop) => {
                    if (["class", "map", "array"].indexOf(prop.type.kind) >= 0) {
                        info = { name, prop };
                    } else if (info === undefined) {
                        info = { name, prop };
                    }
                });
                if (info !== undefined) {
                    return this.exampleUse(info.prop.type, [exp, safeNav, ".", info.name], depth, info.prop.isOptional);
                }
                return exp;
            },
            mapType => this.exampleUse(mapType.values, [exp, safeNav, `["…"]`], depth),
            enumType => {
                let name: Name | undefined;
                // FIXME: This is a terrible way to get the first enum case name.
                this.forEachEnumCase(enumType, "none", theName => {
                    if (name === undefined) {
                        name = theName;
                    }
                });
                if (name !== undefined) {
                    return [exp, " == ", this.nameForNamedType(enumType), "::", name];
                }
                return exp;
            },
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (["class", "map", "array"].indexOf(nullable.kind) >= 0) {
                        return this.exampleUse(nullable, exp, depth, true);
                    }
                    return [exp, ".nil?"];
                }
                return exp;
            }
        );
    }

    private jsonSample(t: Type): Sourcelike {
        function inner() {
            if (t instanceof ArrayType) {
                return "[…]";
            } else if (t instanceof MapType) {
                return "{…}";
            } else if (t instanceof ClassType) {
                return "{…}";
            } else {
                return "…";
            }
        }
        return `"${inner()}"`;
    }

    private patternMatchClauseDecode(t: Type, attributeName: Name | string, suffix: string = ""): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => [],
            _nullType => ["def decode_", attributeName, suffix, "(value) when is_nil(value), do: value"],
            _boolType => ["def decode_", attributeName, suffix, "(value) when is_boolean(value), do: value"],
            _integerType => ["def decode_", attributeName, suffix, "(value) when is_integer(value), do: value"],
            _doubleType => [
                "def decode_",
                attributeName,
                suffix,
                "(value) when is_float(value), do: value\n",
                "def decode_",
                attributeName,
                suffix,
                "(value) when is_integer(value), do: value"
            ],
            _stringType => ["def decode_", attributeName, suffix, "(value) when is_binary(value), do: value"],
            _arrayType => ["def decode_", attributeName, suffix, "(value) when is_list(value), do: value"],
            classType => {
                let requiredAttributeArgs: Sourcelike[] = [];
                this.forEachClassProperty(classType, "none", (name, jsonName, p) => {
                    if (!p.isOptional) {
                        requiredAttributeArgs.push(['"', jsonName, '" => _,']);
                    }
                });
                return [
                    "def decode_",
                    attributeName,
                    suffix,
                    "(%{",
                    requiredAttributeArgs,
                    "} = value), do: ",
                    this.nameForNamedType(classType),
                    ".from_map(value)"
                ];
            },
            _mapType => ["def decode_", attributeName, suffix, "(value) when is_map(value), do: value"],
            enumType => {
                return [];
                // return [this.nameForNamedType(enumType), ".encode(struct.", e, ")", optional ? " || nil" : ""];
            },
            unionType => {
                return [];
                // const nullable = nullableFromUnion(unionType);
                // if (nullable !== null) {
                //     return ["(", e, " && encode_", e, "(struct.", e, ")) || nil"];
                // }
                // return ["encode_", e, "(struct.", e, ")"];
            }
        );
    }

    private patternMatchClauseEncode(t: Type, attributeName: Name | string, suffix: string = ""): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => [],
            _nullType => ["def encode_", attributeName, suffix, "(value) when is_nil(value), do: value"],
            _boolType => ["def encode_", attributeName, suffix, "(value) when is_boolean(value), do: value"],
            _integerType => ["def encode_", attributeName, suffix, "(value) when is_integer(value), do: value"],
            _doubleType => [
                "def encode_",
                attributeName,
                suffix,
                "(value) when is_float(value), do: value\n",
                "def encode_",
                attributeName,
                suffix,
                "(value) when is_integer(value), do: value"
            ],
            _stringType => ["def encode_", attributeName, suffix, "(value) when is_binary(value), do: value"],
            _arrayType => ["def encode_", attributeName, suffix, "(value) when is_list(value), do: value"],
            classType => {
                let requiredAttributeArgs: Sourcelike[] = [];
                this.forEachClassProperty(classType, "none", (name, jsonName, p) => {
                    if (!p.isOptional) {
                        requiredAttributeArgs.push(['"', jsonName, '" => _,']);
                    }
                });
                return [
                    "def encode_",
                    attributeName,
                    suffix,
                    "(%",
                    this.nameForNamedType(classType),
                    "{} = value), do: ",
                    this.nameForNamedType(classType),
                    ".to_map(value)"
                ];
            },
            _mapType => ["def encode_", attributeName, suffix, "(value) when is_map(value), do: value"],
            enumType => {
                return [];
                // return [this.nameForNamedType(enumType), ".encode(struct.", e, ")", optional ? " || nil" : ""];
            },
            unionType => {
                return [];
                // const nullable = nullableFromUnion(unionType);
                // if (nullable !== null) {
                //     return ["(", e, " && encode_", e, "(struct.", e, ")) || nil"];
                // }
                // return ["encode_", e, "(struct.", e, ")"];
            }
        );
    }

    private sortAndFilterPatternMatchTypes(types: Type[]): Type[] {
        return types
            .filter(
                type =>
                    !(
                        // type.kind === "null" ||
                        // type instanceof ArrayType ||
                        // type instanceof MapType ||
                        (type instanceof UnionType)
                    )
            )
            .sort((a, b) => {
                if (a instanceof ClassType && !(b instanceof ClassType)) {
                    return -1;
                } else if (b instanceof ClassType && !(a instanceof ClassType)) {
                    return 1;
                } else if (a instanceof EnumType && !(b instanceof EnumType)) {
                    return -1;
                } else if (b instanceof EnumType && !(a instanceof EnumType)) {
                    return 1;
                } else if (a.isPrimitive() && !b.isPrimitive()) {
                    return -1;
                } else if (b.isPrimitive() && !a.isPrimitive()) {
                    return 1;
                } else {
                    return 0;
                }
            });
    }

    private emitPatternMatches(types: Type[], name: Name | string, parentName: Name | string, suffix: string = "") {
        this.ensureBlankLine();

        let typesToMatch = this.sortAndFilterPatternMatchTypes(types);
        if (typesToMatch.length < 2) {
            return;
        }

        if (typesToMatch.find(type => type.kind === "double")) {
            typesToMatch = typesToMatch.filter(type => type.kind !== "integer");
        }

        typesToMatch.forEach(type => {
            this.emitLine(this.patternMatchClauseDecode(type, name, suffix));
        });
        this.emitLine(
            "def decode_",
            name,
            suffix,
            '(_), do: {:error, "Unexpected type when decoding ',
            parentName,
            ".",
            name,
            '"}'
        );

        this.ensureBlankLine();

        typesToMatch.forEach(type => {
            this.emitLine(this.patternMatchClauseEncode(type, name, suffix));
        });
        this.emitLine(
            "def encode_",
            name,
            suffix,
            '(_), do: {:error, "Unexpected type when encoding ',
            parentName,
            ".",
            name,
            '"}'
        );

        this.ensureBlankLine();
    }

    // protected implicitlyConvertsFromJSON(t: Type): boolean {
    //     if (t instanceof ClassType) {
    //         return false;
    //     } else if (t instanceof EnumType) {
    //         return false;
    //     } else if (t instanceof ArrayType) {
    //         return this.implicitlyConvertsFromJSON(t.items);
    //     } else if (t instanceof MapType) {
    //         return this.implicitlyConvertsFromJSON(t.values);
    //     } else if (t.isPrimitive()) {
    //         return true;
    //     } else if (t instanceof UnionType) {
    //         const nullable = nullableFromUnion(t);
    //         if (nullable !== null) {
    //             return this.implicitlyConvertsFromJSON(nullable);
    //         } else {
    //             return true;
    //         }
    //     } else {
    //         return false;
    //     }
    // }

    // protected implicitlyConvertsToJSON(t: Type): boolean {
    //     return this.implicitlyConvertsFromJSON(t) && "bool" !== t.kind;
    // }

    private nameOfTransformFunction(
        t: Type,
        name: Name | Sourcelike,
        encode: boolean = false,
        prefix: string = ""
    ): Sourcelike {
        let mode = "decode";
        if (encode) {
            mode = "encode";
        }
        return matchType<Sourcelike>(
            t,
            _anyType => [],
            _nullType => [],
            _boolType => [],
            _integerType => [],
            _doubleType => [],
            _stringType => [],
            _arrayType => [],
            classType => [this.nameForNamedType(classType), `.${encode ? "to" : "from"}_map`],
            _mapType => [],
            enumType => {
                return [this.nameForNamedType(enumType), `.${mode}`];
            },
            _unionType => {
                return [`${mode}_`, name, prefix];
            }
        );
    }

    private fromDynamic(t: Type, jsonName: string, name: Name, optional = false): Sourcelike {
        const primitive = ['m["', jsonName, '"]'];
        // const safeAccess = optional ? "&" : "";
        return matchType<Sourcelike>(
            t,
            _anyType => primitive,
            _nullType => primitive,
            _boolType => primitive,
            _integerType => primitive,
            _doubleType => primitive,
            _stringType => primitive,
            arrayType => {
                let arrayElement = arrayType.items;
                if (arrayElement instanceof ArrayType) {
                    return primitive;
                } else if (arrayElement.isPrimitive()) {
                    return primitive;
                } else if (arrayElement instanceof MapType) {
                    return primitive;
                } else {
                    // if (arrayElement instanceof UnionType) {
                    //     let arrayElementTypes = [...arrayElement.getChildren()];
                    //     let arrayElementTypesNotPrimitive = arrayElementTypes.filter(
                    //         type => !(type instanceof PrimitiveType)
                    //     );
                    //     if (arrayElementTypesNotPrimitive.length) {
                    //     }
                    // }
                    if (optional) {
                        return [
                            "m",
                            '["',
                            jsonName,
                            '"] && Enum.map(m["',
                            jsonName,
                            '"], &',
                            this.nameOfTransformFunction(arrayElement, name, false, "_element"),
                            "/1)"
                        ];
                    } else {
                        return [
                            'Enum.map(m["',
                            jsonName,
                            '"], &',
                            this.nameOfTransformFunction(arrayElement, name, false, "_element"),
                            "/1)"
                        ];
                    }

                    // return ["Enum.map(", primitive, ", ", "&", this.nameForNamedType(arrayType.items), ".from_map/1)"];
                }
                // list = [
                //     [0, "zero"],
                //     [1, "one"],
                //     [2, "two"]
                // ];

                // mapped = Enum.map(list, fn item_x ->
                // Enum.map(item_x, fn item_y ->
                //     # Apply mapping logic to each item here
                //     item_y
                // end)
                // end)
                // if (ans.kind === "array") {
                //     // console.log(ans);
                // }
                // const testPrim = arrayType.isPrimitive();
                // const testName = this.nameForNamedType(arrayType);

                // return [
                //     arrayType.isPrimitive()
                //         ? [primitive]
                //         : ["Enum.map(", primitive, ", ", "&", this.nameForNamedType(arrayType), ".from_map/1)"]
                // ];
            },
            classType => [
                optional ? [primitive, " && "] : "",
                this.nameForNamedType(classType),
                ".from_map(",
                primitive,
                ")"
            ],
            mapType => {
                let mapValueTypes = [...mapType.values.getChildren()];
                let mapValueTypesNotPrimitive = mapValueTypes.filter(type => !(type instanceof PrimitiveType));
                if (mapValueTypesNotPrimitive.length === 0) {
                    return [primitive];
                } else {
                    // 'm["',
                    // jsonName,
                    if (mapType.values.kind === "union") {
                        return [
                            'm["',
                            jsonName,
                            '"]\n|> Map.new(fn {key, value} -> {key, ',
                            this.nameOfTransformFunction(mapType.values, jsonName, false),
                            "_value(value)} end)"
                        ];
                    } else if (mapType.values instanceof EnumType || mapType.values instanceof ClassType) {
                        return [
                            'm["',
                            jsonName,
                            '"]\n|> Map.new(fn {key, value} -> {key, ',
                            this.nameOfTransformFunction(mapType.values, jsonName, false),
                            "(value)} end)"
                        ];
                    }
                    return [primitive];
                }
            },
            enumType => {
                return [
                    optional ? [primitive, " && "] : "",
                    this.nameOfTransformFunction(enumType, name),
                    "(",
                    primitive,
                    ")"
                ];
            },
            // unionType => {
            //     if (!this._tsFlowOptions.declareUnions || nullableFromUnion(unionType) !== null) {
            //         const children = Array.from(unionType.getChildren()).map(c => parenIfNeeded(this.sourceFor(c)));
            //         return multiWord(" | ", ...children);
            //     } else {
            //         return singleWord(this.nameForNamedType(unionType));
            //     }
            // },
            unionType => {
                let unionTypes = [...unionType.getChildren()];
                let unionPrimitiveTypes = unionTypes.filter(type => type.isPrimitive());
                if (unionTypes.length === unionPrimitiveTypes.length) {
                    return ['m["', jsonName, '"]'];
                }

                const nullable = nullableFromUnion(unionType);
                // return [];
                // return [""];
                if (nullable !== null) {
                    if (nullable instanceof ClassType) {
                        return this.fromDynamic(nullable, jsonName, name, true);
                    }

                    let nullableTypes = [...nullable.getChildren()];
                    if (nullableTypes.length < 2) {
                        return this.fromDynamic(nullable, jsonName, name, true);
                    }
                    return ['m["', jsonName, '"] && decode_', name, '(m["', jsonName, '"])'];
                    // return this.fromDynamic(nullable, jsonName, name);
                }
                return ["decode_", name, '(m["', jsonName, '"])'];
                // const expression = [this.nameForNamedType(unionType), ".from_dynamic!(", e, ")"];
                // return optional ? [e, " ? ", expression, " : nil"] : expression;
            }
        );
    }

    private toDynamic(t: Type, e: Sourcelike, optional = false): Sourcelike {
        // if (this.marshalsImplicitlyToDynamic(t)) {
        //     return e;
        // }

        const expression = ["struct.", e];
        return matchType<Sourcelike>(
            t,
            _anyType => expression,
            _nullType => expression,
            _boolType => expression,
            _integerType => expression,
            _doubleType => expression,
            _stringType => expression,
            arrayType => {
                let arrayElement = arrayType.items;
                if (arrayElement instanceof ArrayType) {
                    return expression;
                }
                if (arrayElement.isPrimitive()) {
                    return expression;
                } else if (arrayElement instanceof MapType) {
                    return expression;
                } else {
                    if (arrayElement.kind === "array") {
                        return expression;
                    } else if (arrayElement.kind === "enum") {
                        [this.nameOfTransformFunction(arrayElement, e, true, "_element"), "(", expression, ")"];
                    } else if (arrayElement.kind === "union") {
                        if (optional) {
                            return [
                                "struct.",
                                e,
                                '"] && Enum.map(struct.',
                                e,
                                ", &",
                                this.nameOfTransformFunction(arrayElement, e, true, "_element"),
                                "/1)"
                            ];
                        } else {
                            return [
                                "Enum.map(struct.",
                                e,
                                ", &",
                                this.nameOfTransformFunction(arrayElement, e, true, "_element"),
                                "/1)"
                            ];
                        }
                    } else if (arrayElement.kind === "class") {
                        if (optional) {
                            return [
                                "struct.",
                                e,
                                " && Enum.map(struct.",
                                e,
                                ", &",
                                this.nameOfTransformFunction(arrayElement, e, true, "_element"),
                                "/1)"
                            ];
                        } else {
                            return [
                                "Enum.map(struct.",
                                e,
                                ", &",
                                this.nameOfTransformFunction(arrayElement, e, true, "_element"),
                                "/1)"
                            ];
                        }
                    }
                    return [expression];
                }
            },
            classType => [
                optional ? ["struct.", e, " && "] : "",
                this.nameForNamedType(classType),
                ".to_map(",
                "struct.",
                e,
                ")"
            ],
            mapType => {
                let mapValueTypes = [...mapType.values.getChildren()];
                let mapValueTypesNotPrimitive = mapValueTypes.filter(type => !(type instanceof PrimitiveType));
                if (mapValueTypesNotPrimitive.length === 0) {
                    return [expression];
                } else {
                    if (mapType.values.kind === "union") {
                        return [
                            "struct.",
                            e,
                            "\n|> Map.new(fn {key, value} -> {key, ",
                            this.nameOfTransformFunction(mapType.values, e, true),
                            "_value(value)} end)"
                        ];
                    } else if (mapType.values instanceof EnumType || mapType.values instanceof ClassType) {
                        return [
                            "struct.",
                            e,
                            "\n|> Map.new(fn {key, value} -> {key, ",
                            this.nameOfTransformFunction(mapType.values, e, true),
                            "(value)} end)"
                        ];
                    }
                    return [expression];
                }
                // : [
                //       "Map.new(",
                //       "struct.",
                //       e,
                //       ", fn {key, value} -> {key,",
                //       this.nameForNamedType(mapType.values),
                //       ".to_map(value)} end)"
                //   ]
            },
            enumType => {
                return [
                    optional ? ["struct.", e, " && "] : "",
                    this.nameForNamedType(enumType),
                    ".encode(struct.",
                    e,
                    ")"
                ];
            },
            unionType => {
                let unionTypes = [...unionType.getChildren()];
                let unionPrimitiveTypes = unionTypes.filter(type => type.isPrimitive());
                if (unionTypes.length === unionPrimitiveTypes.length) {
                    return ["struct.", e];
                }

                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (nullable instanceof ClassType) {
                        return this.toDynamic(nullable, e, true);
                    }

                    let nullableTypes = [...nullable.getChildren()];
                    if (nullableTypes.length < 2) {
                        return this.toDynamic(nullable, e, true);
                    }

                    return ["struct.", e, " && encode_", e, "(struct.", e, ")"];
                }
                return ["encode_", e, "(struct.", e, ")"];
            }
        );
    }

    // private marshalsImplicitlyToDynamic(t: Type): boolean {
    //     return matchType<boolean>(
    //         t,
    //         _anyType => true,
    //         _nullType => true,
    //         _boolType => true,
    //         _integerType => true,
    //         _doubleType => true,
    //         _stringType => true,
    //         arrayType => this.marshalsImplicitlyToDynamic(arrayType.items),
    //         _classType => false,
    //         mapType => this.marshalsImplicitlyToDynamic(mapType.values),
    //         _enumType => true,
    //         unionType => {
    //             const nullable = nullableFromUnion(unionType);
    //             if (nullable !== null) {
    //                 return this.marshalsImplicitlyToDynamic(nullable);
    //             }
    //             return false;
    //         }
    //     );
    // }

    // // This is only to be used to allow class properties to possibly
    // // marshal implicitly. They are allowed to do this because they will
    // // be checked in Dry::Struct.new
    // private propertyTypeMarshalsImplicitlyFromDynamic(t: Type): boolean {
    //     return matchType<boolean>(
    //         t,
    //         _anyType => true,
    //         _nullType => true,
    //         _boolType => true,
    //         _integerType => true,
    //         _doubleType => true,
    //         _stringType => true,
    //         arrayType => this.propertyTypeMarshalsImplicitlyFromDynamic(arrayType.items),
    //         _classType => false,
    //         // Map properties must be checked because Dry:Types doesn't have a generic Map
    //         _mapType => false,
    //         _enumType => true,
    //         unionType => {
    //             const nullable = nullableFromUnion(unionType);
    //             if (nullable !== null) {
    //                 return this.propertyTypeMarshalsImplicitlyFromDynamic(nullable);
    //             }
    //             return false;
    //         }
    //     );
    // }

    private emitBlock(source: Sourcelike, emit: () => void) {
        this.emitLine(source);
        this.indent(emit);
        this.emitLine("end");
    }

    private emitTopLevelModule(emit: () => void) {
        emit();
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, {
            firstLineStart: '@moduledoc """\n',
            lineStart: "",
            afterComment: '"""'
        });
    }

    private emitModule(c: ClassType, moduleName: Name) {
        this.emitBlock(["defmodule ", moduleName, " do"], () => {
            const structDescription = this.descriptionForType(c) ?? [];
            const attributeDescriptions: Sourcelike[][] = [];
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const attributeDescription = this.descriptionForClassProperty(c, jsonName);
                if (attributeDescription) {
                    attributeDescriptions.push(["- `:", name, "` - ", attributeDescription]);
                }
            });
            if (structDescription.length || attributeDescriptions.length) {
                this.emitDescription([...structDescription, ...attributeDescriptions]);
                this.ensureBlankLine();
            }
            const requiredAttributes: Sourcelike[] = [];
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                if (!p.isOptional) {
                    if (requiredAttributes.length === 0) {
                        requiredAttributes.push([":", name]);
                    } else {
                        requiredAttributes.push([", :", name]);
                    }
                }
            });
            if (requiredAttributes.length) {
                this.emitLine(["@enforce_keys [", requiredAttributes, "]"]);
            }
            const attributeNames: Sourcelike[] = [];
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                if (attributeNames.length === 0) {
                    attributeNames.push([":", name]);
                } else {
                    attributeNames.push([", :", name]);
                }
            });
            // if (attributeNames.length) {
            this.emitLine(["defstruct [", attributeNames, "]"]);
            this.ensureBlankLine();
            // }
            let typeDefinitionTable: Sourcelike[][] = [[["@type "], ["t :: %__MODULE__{"]]];
            let count = c.getProperties().size;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const last = --count === 0;
                const attributeRow = [
                    [],
                    ["  ", name, ": ", this.elixirType(p.type), p.isOptional ? " | nil" : "", last ? "" : ","]
                ];
                typeDefinitionTable.push(attributeRow);
            });
            typeDefinitionTable.push([[], ["}"]]);
            this.emitTable(typeDefinitionTable);
            if (this._options.justTypes) {
                return;
            }
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                // const expression = this.fromDynamic(p.type, jsonName, name);
                // this.emitLine(name, ": ", expression, ",");
                if (p.type.kind === "union") {
                    let unionTypes = [...p.type.getChildren()];
                    let unionPrimitiveTypes = unionTypes.filter(type => type.isPrimitive());
                    if (unionTypes.length === unionPrimitiveTypes.length) {
                        return;
                    }
                    this.emitPatternMatches(unionTypes, name, this.nameForNamedType(c));
                } else if (p.type.kind === "array") {
                    let arrayType = p.type as ArrayType;
                    if (arrayType.items instanceof ArrayType) {
                        return;
                    } else if (arrayType.items instanceof ClassType) {
                        return;
                    } else if (arrayType.items instanceof UnionType) {
                        let unionType = arrayType.items;
                        let typesInUnion = [...unionType.getChildren()];
                        this.emitPatternMatches(typesInUnion, name, this.nameForNamedType(c), "_element");
                    } else {
                        // TODO: Do I need to do this stuff here
                        // let arrayElementTypes = [...arrayType.getChildren()];
                        // let arrayElementTypesNotPrimitive = arrayElementTypes.filter(
                        //     type => !(type instanceof PrimitiveType && type instanceof ArrayType)
                        // );
                        // if (arrayElementTypesNotPrimitive.length) {
                        //     this.emitPatternMatches(arrayElementTypes, name, this.nameForNamedType(c), "_element");
                        // }
                    }
                }
            });
            let propCount = 0;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                propCount++;
            });
            let isEmpty = propCount ? false : true;
            this.ensureBlankLine();
            this.emitBlock([`def from_map(${isEmpty ? "_" : ""}m) do`], () => {
                // this.emitLine("# TODO: Implement from_map");
                this.emitLine("%", moduleName, "{");
                this.indent(() => {
                    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                        jsonName = escapeDoubleQuotes(jsonName);
                        jsonName = escapeNewLines(jsonName);
                        const expression = this.fromDynamic(p.type, jsonName, name, p.isOptional);
                        this.emitLine(name, ": ", expression, ",");
                    });
                });
                this.emitLine("}");
            });
            this.ensureBlankLine();
            this.emitBlock("def from_json(json) do", () => {
                this.emitMultiline(`json
        # TODO: decide if this should be ! or not
        |> Jason.decode!()
        |> from_map()`);
            });
            this.ensureBlankLine();
            this.emitBlock([`def to_map(${isEmpty ? "_" : ""}struct) do`], () => {
                // return;
                this.emitLine("%{");
                this.indent(() => {
                    // const inits: Sourcelike[][] = [];
                    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                        const expression = this.toDynamic(p.type, name, p.isOptional);
                        this.emitLine([[`"${stringEscape(jsonName)}"`], [" => ", expression, ","]]);
                    });
                    // this.emitTable(inits);
                });
                this.emitLine("}");
            });
            this.ensureBlankLine();
            this.emitBlock("def to_json(struct) do", () => {
                this.emitMultiline(`struct
        |> to_map()
        # TODO: decide if this should be ! or not
        |> Jason.encode!()`);
            });
        });
    }

    private isValidAtom(str: string): boolean {
        function isLetter(char: string): boolean {
            return /^[A-Za-z_]$/.test(char);
        }

        function isLetterOrDigit(char: string): boolean {
            return /^[A-Za-z0-9_]$/.test(char);
        }

        if (str.length === 0) {
            return false;
        }

        const firstChar = str[0];
        if (!isLetter(firstChar)) {
            return false;
        }

        for (let i = 1; i < str.length; i++) {
            const char = str[i];

            if (!isLetterOrDigit(char) && char !== "@" && !(i === str.length - 1 && (char === "!" || char === "?"))) {
                return false;
            }
        }

        return true;
    }

    private emitEnum(e: EnumType, enumName: Name) {
        this.emitDescription(this.descriptionForType(e));
        this.emitBlock(["defmodule ", enumName, " do"], () => {
            this.emitLine("@valid_enum_members [");
            this.indent(() => {
                this.forEachEnumCase(e, "none", (name, json) => {
                    if (this.isValidAtom(json)) {
                        this.emitLine(":", json, ",");
                    } else {
                        this.emitLine(":", `"${json}"`, ",");
                    }

                    // table.push([[name], [` = "${stringEscape(json)}"`]]);
                });
            });

            this.emitLine("]");

            this.ensureBlankLine();

            this.emitMultiline(`def valid_atom?(value), do: value in @valid_enum_members

def valid_atom_string?(value) do
    try do
        atom = String.to_existing_atom(value)
        atom in @valid_enum_members
    rescue
        ArgumentError -> false
    end
end

def encode(value) do
    if valid_atom?(value), do: Atom.to_string(value), else: value
end

def decode(value) do
    if valid_atom_string?(value), do: String.to_existing_atom(value), else: value
end`);
            // this.emitTable(table);
        });
    }

    private emitUnion(u: UnionType, unionName: Name) {
        this.emitLine("# TODO");
        // this.emitDescription(this.descriptionForType(u));
        // this.emitBlock(["class ", unionName, " < Dry::Struct"], () => {
        //     const table: Sourcelike[][] = [];
        //     this.forEachUnionMember(u, u.getChildren(), "none", null, (name, t) => {
        //         table.push([["attribute :", name, ", "], [this.elixirType(t, true)]]);
        //     });
        //     this.emitTable(table);

        //     if (this._options.justTypes) {
        //         return;
        //     }

        //     this.ensureBlankLine();
        //     const [maybeNull, nonNulls] = removeNullFromUnion(u, false);
        //     this.emitBlock("def self.from_dynamic!(d)", () => {
        //         const memberNames = Array.from(u.getChildren()).map(member => this.nameForUnionMember(u, member));
        //         this.forEachUnionMember(u, u.getChildren(), "none", null, (name, t) => {
        //             const nilMembers = memberNames
        //                 .filter(n => n !== name)
        //                 .map(memberName => [", ", memberName, ": nil"]);
        //             if (this.propertyTypeMarshalsImplicitlyFromDynamic(t)) {
        //                 this.emitBlock(["if schema[:", name, "].right.valid? d"], () => {
        //                     this.emitLine("return new(", name, ": d", nilMembers, ")");
        //                 });
        //             } else {
        //                 this.emitLine("begin");
        //                 this.indent(() => {
        //                     this.emitLine("value = ", this.fromDynamic(t, "d"));
        //                     this.emitBlock(["if schema[:", name, "].right.valid? value"], () => {
        //                         this.emitLine("return new(", name, ": value", nilMembers, ")");
        //                     });
        //                 });
        //                 this.emitLine("rescue");
        //                 this.emitLine("end");
        //             }
        //         });
        //         this.emitLine(`raise "Invalid union"`);
        //     });

        //     this.ensureBlankLine();
        //     this.emitBlock("def self.from_json!(json)", () => {
        //         this.emitLine("from_dynamic!(JSON.parse(json))");
        //     });

        //     this.ensureBlankLine();
        //     this.emitBlock("def to_dynamic", () => {
        //         let first = true;
        //         this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
        //             this.emitLine(first ? "if" : "elsif", " ", name, " != nil");
        //             this.indent(() => {
        //                 this.emitLine(this.toDynamic(t, name));
        //             });
        //             first = false;
        //         });
        //         if (maybeNull !== null) {
        //             this.emitLine("else");
        //             this.indent(() => {
        //                 this.emitLine("nil");
        //             });
        //         }
        //         this.emitLine("end");
        //     });

        //     this.ensureBlankLine();
        //     this.emitBlock("def to_json(options = nil) do", () => {
        //         this.emitLine("JSON.generate(to_dynamic, options)");
        //     });
        // });
    }

    private emitTypesModule() {
        this.emitBlock(["module Types"], () => {
            this.emitLine("include Dry.Types(default: :nominal)");

            const declarations: Sourcelike[][] = [];

            if (this._options.strictness !== Strictness.None) {
                let has = { int: false, nil: false, bool: false, hash: false, string: false, double: false };
                this.forEachType(t => {
                    has = {
                        int: has.int || t.kind === "integer",
                        nil: has.nil || t.kind === "null",
                        bool: has.bool || t.kind === "bool",
                        hash: has.hash || t.kind === "map" || t.kind === "class",
                        string: has.string || t.kind === "string" || t.kind === "enum",
                        double: has.double || t.kind === "double"
                    };
                });
                if (has.int) declarations.push([["Integer"], [` = ${this._options.strictness}Integer`]]);
                if (this._options.strictness === Strictness.Strict) {
                    if (has.nil) declarations.push([["Nil"], [` = ${this._options.strictness}Nil`]]);
                }
                if (has.bool) declarations.push([["Bool"], [` = ${this._options.strictness}Bool`]]);
                if (has.hash) declarations.push([["Hash"], [` = ${this._options.strictness}Hash`]]);
                if (has.string) declarations.push([["String"], [` = ${this._options.strictness}String`]]);
                if (has.double)
                    declarations.push([
                        ["Double"],
                        [` = ${this._options.strictness}Float | ${this._options.strictness}Integer`]
                    ]);
            }

            this.forEachEnum("none", (enumType, enumName) => {
                const cases: Sourcelike[][] = [];
                this.forEachEnumCase(enumType, "none", (_name, json) => {
                    cases.push([cases.length === 0 ? "" : ", ", `"${stringEscape(json)}"`]);
                });
                declarations.push([[enumName], [" = ", this._options.strictness, "String.enum(", ...cases, ")"]]);
            });

            if (declarations.length > 0) {
                this.ensureBlankLine();
                this.emitTable(declarations);
            }
        });
    }

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitLine("# TODO: Add comments");
        }
        this.ensureBlankLine();

        this.ensureBlankLine();

        // this.emitModule2(() => {
        // this.emitTypesModule();

        // this.forEachDeclaration("leading-and-interposing", decl => {
        //     if (decl.kind === "forward") {
        //         this.emitCommentLines(["(forward declaration)"]);
        //         this.emitModule2(() => {
        //             this.emitLine("class ", this.nameForNamedType(decl.type), " < Dry::Struct; end");
        //         });
        //     }
        // });

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitModule(c, n),
            (e, n) => this.emitEnum(e, n),
            (u, n) => this.emitUnion(u, n)
        );

        if (!this._options.justTypes) {
            this.forEachTopLevel(
                "leading-and-interposing",
                (topLevel, name) => {
                    // The json gem defines to_json on maps and primitives, so we only need to supply
                    // it for arrays.
                    const isTopLevelArray = "array" === topLevel.kind;

                    // const moduleDeclaration = () => {

                    this.emitBlock(["defmodule ", name, " do"], () => {
                        if (isTopLevelArray) {
                            let arrayElement = (topLevel as ArrayType).items;

                            let isUnion = false;

                            if (arrayElement instanceof UnionType) {
                                this.emitPatternMatches([...arrayElement.getChildren()], "element", name);
                                isUnion = true;
                            }

                            this.emitBlock("def from_json(json) do", () => {
                                this.emitLine("json");
                                this.emitLine("# TODO: decide if this should be ! or not");
                                this.emitLine("|> Jason.decode!()");
                                this.emitLine(
                                    "|> Enum.map(&",
                                    isUnion ? ["decode_element/1)"] : [name, "Element.from_map/1)"]
                                );
                            });

                            this.ensureBlankLine();

                            this.emitBlock("def to_json(list) do", () => {
                                this.emitLine(
                                    "Enum.map(list, &",
                                    isUnion ? ["encode_element/1)"] : [name, "Element.to_map/1)"]
                                );
                                this.emitLine("# TODO: decide if this should be ! or not");
                                this.emitLine("|> Jason.encode!()");
                            });
                        } else {
                            this.emitBlock("def from_json(json) do", () => {
                                this.emitLine("# TODO: decide if this should be ! or not");
                                this.emitLine("Jason.decode!(json)");
                            });

                            this.ensureBlankLine();

                            this.emitBlock("def to_json(data) do", () => {
                                this.emitLine("# TODO: decide if this should be ! or not");
                                this.emitLine("Jason.encode!(data)");
                            });
                        }
                    });

                    // };

                    // this.emitTopLevelModule(() => {
                    //     moduleDeclaration();
                    // });
                },
                t => this.namedTypeToNameForTopLevel(t) === undefined
            );
        }
        // });
    }
}
