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
            _enumType => [],
            _unionType => []
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
            _enumType => [],
            _unionType => []
        );
    }

    private sortAndFilterPatternMatchTypes(types: Type[]): Type[] {
        return types
            .filter(type => !(type instanceof UnionType))
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
                }
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
            unionType => {
                let unionTypes = [...unionType.getChildren()];
                let unionPrimitiveTypes = unionTypes.filter(type => type.isPrimitive());
                if (unionTypes.length === unionPrimitiveTypes.length) {
                    return ['m["', jsonName, '"]'];
                }

                const nullable = nullableFromUnion(unionType);

                if (nullable !== null) {
                    if (nullable instanceof ClassType) {
                        return this.fromDynamic(nullable, jsonName, name, true);
                    }

                    let nullableTypes = [...nullable.getChildren()];
                    if (nullableTypes.length < 2) {
                        return this.fromDynamic(nullable, jsonName, name, true);
                    }
                    return ['m["', jsonName, '"] && decode_', name, '(m["', jsonName, '"])'];
                }
                return ["decode_", name, '(m["', jsonName, '"])'];
            }
        );
    }

    private toDynamic(t: Type, e: Sourcelike, optional = false): Sourcelike {
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

            this.emitLine(["defstruct [", attributeNames, "]"]);
            this.ensureBlankLine();

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
                this.emitLine("%{");
                this.indent(() => {
                    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                        const expression = this.toDynamic(p.type, name, p.isOptional);
                        this.emitLine([[`"${stringEscape(jsonName)}"`], [" => ", expression, ","]]);
                    });
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
        });
    }

    private emitUnion(u: UnionType, unionName: Name) {
        return;
    }

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitLine("# TODO: Add comments");
        }
        this.ensureBlankLine();

        this.ensureBlankLine();

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
                    const isTopLevelArray = "array" === topLevel.kind;

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
                },
                t => this.namedTypeToNameForTopLevel(t) === undefined
            );
        }
    }
}
