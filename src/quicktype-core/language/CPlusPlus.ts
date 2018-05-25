import { OrderedSet, List } from "immutable";

import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, UnionType } from "../Type";
import { nullableFromUnion, matchType, removeNullFromUnion } from "../TypeUtils";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import {
    legalizeCharacters,
    isAscii,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    stringEscape,
    splitIntoWords,
    combineWords,
    WordStyle,
    firstUpperWordStyle,
    allUpperWordStyle,
    allLowerWordStyle
} from "../support/Strings";
import { defined, assertNever, panic, intercalate } from "../support/Support";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { StringOption, EnumOption, BooleanOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { assert } from "../support/Support";
import { Declaration } from "../DeclarationIR";
import { RenderContext } from "../Renderer";

export type NamingStyle = "pascal" | "camel" | "underscore" | "upper-underscore";

const pascalValue: [string, NamingStyle] = ["pascal-case", "pascal"];
const underscoreValue: [string, NamingStyle] = ["underscore-case", "underscore"];
const camelValue: [string, NamingStyle] = ["camel-case", "camel"];
const upperUnderscoreValue: [string, NamingStyle] = ["upper-underscore-case", "upper-underscore"];

export const cPlusPlusOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption("namespace", "Name of the generated namespace(s)", "NAME", "quicktype"),
    typeNamingStyle: new EnumOption<NamingStyle>("type-style", "Naming style for types", [
        pascalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue
    ]),
    memberNamingStyle: new EnumOption<NamingStyle>("member-style", "Naming style for members", [
        underscoreValue,
        pascalValue,
        camelValue,
        upperUnderscoreValue
    ]),
    enumeratorNamingStyle: new EnumOption<NamingStyle>("enumerator-style", "Naming style for enumerators", [
        upperUnderscoreValue,
        underscoreValue,
        pascalValue,
        camelValue
    ])
};

export class CPlusPlusTargetLanguage extends TargetLanguage {
    constructor() {
        super("C++", ["c++", "cpp", "cplusplus"], "cpp");
    }

    protected getOptions(): Option<any>[] {
        return [
            cPlusPlusOptions.justTypes,
            cPlusPlusOptions.namespace,
            cPlusPlusOptions.typeNamingStyle,
            cPlusPlusOptions.memberNamingStyle,
            cPlusPlusOptions.enumeratorNamingStyle
        ];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): CPlusPlusRenderer {
        return new CPlusPlusRenderer(this, renderContext, getOptionValues(cPlusPlusOptions, untypedOptionValues));
    }
}

const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

function cppNameStyle(namingStyle: NamingStyle): (rawName: string) => string {
    let separator: string;
    let firstWordStyle: WordStyle;
    let restWordStyle: WordStyle;
    let firstWordAcronymStyle: WordStyle;
    let restAcronymStyle: WordStyle;

    if (namingStyle === "pascal" || namingStyle === "camel") {
        separator = "";
        restWordStyle = firstUpperWordStyle;
        restAcronymStyle = allUpperWordStyle;
    } else {
        separator = "_";
    }
    switch (namingStyle) {
        case "pascal":
            firstWordStyle = firstWordAcronymStyle = firstUpperWordStyle;
            break;
        case "camel":
            firstWordStyle = firstWordAcronymStyle = allLowerWordStyle;
            break;
        case "underscore":
            firstWordStyle = restWordStyle = firstWordAcronymStyle = restAcronymStyle = allLowerWordStyle;
            break;
        case "upper-underscore":
            firstWordStyle = restWordStyle = firstWordAcronymStyle = restAcronymStyle = allUpperWordStyle;
            break;
        default:
            return assertNever(namingStyle);
    }

    return (original: string) => {
        const words = splitIntoWords(original);
        return combineWords(
            words,
            legalizeName,
            firstWordStyle,
            restWordStyle,
            firstWordAcronymStyle,
            restAcronymStyle,
            separator,
            isLetterOrUnderscore
        );
    };
}

const keywords = [
    "alignas",
    "alignof",
    "and",
    "and_eq",
    "asm",
    "atomic_cancel",
    "atomic_commit",
    "atomic_noexcept",
    "auto",
    "bitand",
    "bitor",
    "bool",
    "break",
    "case",
    "catch",
    "char",
    "char16_t",
    "char32_t",
    "class",
    "compl",
    "concept",
    "const",
    "constexpr",
    "const_cast",
    "continue",
    "co_await",
    "co_return",
    "co_yield",
    "decltype",
    "default",
    "delete",
    "do",
    "double",
    "dynamic_cast",
    "else",
    "enum",
    "explicit",
    "export",
    "extern",
    "false",
    "float",
    "for",
    "friend",
    "goto",
    "if",
    "import",
    "inline",
    "int",
    "long",
    "module",
    "mutable",
    "namespace",
    "new",
    "noexcept",
    "not",
    "not_eq",
    "nullptr",
    "operator",
    "or",
    "or_eq",
    "private",
    "protected",
    "public",
    "register",
    "reinterpret_cast",
    "requires",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "static_assert",
    "static_cast",
    "struct",
    "switch",
    "synchronized",
    "template",
    "this",
    "thread_local",
    "throw",
    "true",
    "try",
    "typedef",
    "typeid",
    "typename",
    "union",
    "unsigned",
    "using",
    "virtual",
    "void",
    "volatile",
    "wchar_t",
    "while",
    "xor",
    "xor_eq",
    "override",
    "final",
    "transaction_safe",
    "transaction_safe_dynamic",
    "NULL"
];

const optionalType = "std::unique_ptr";

type TypeContext = {
    needsForwardIndirection: boolean;
    needsOptionalIndirection: boolean;
    inJsonNamespace: boolean;
};

export class CPlusPlusRenderer extends ConvenienceRenderer {
    private readonly _namespaceNames: List<string>;

    private readonly _typeNameStyle: (rawName: string) => string;
    private readonly _typeNamingFunction: Namer;
    private readonly _memberNamingFunction: Namer;
    private readonly _caseNamingFunction: Namer;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof cPlusPlusOptions>
    ) {
        super(targetLanguage, renderContext);

        this._namespaceNames = List(_options.namespace.split("::"));

        this._typeNameStyle = cppNameStyle(_options.typeNamingStyle);
        this._typeNamingFunction = funPrefixNamer("types", this._typeNameStyle);
        this._memberNamingFunction = funPrefixNamer("members", cppNameStyle(_options.memberNamingStyle));
        this._caseNamingFunction = funPrefixNamer("enumerators", cppNameStyle(_options.enumeratorNamingStyle));
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return this._typeNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return this._memberNamingFunction;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return this._caseNamingFunction;
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    protected canBeForwardDeclared(t: Type): boolean {
        const kind = t.kind;
        return kind === "class";
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    private emitBlock = (line: Sourcelike, withSemicolon: boolean, f: () => void, withIndent: boolean = true): void => {
        this.emitLine(line, " {");
        this.preventBlankLine();
        if (withIndent) {
            this.indent(f);
        } else {
            f();
        }
        this.preventBlankLine();
        if (withSemicolon) {
            this.emitLine("};");
        } else {
            this.emitLine("}");
        }
    };

    private emitNamespaces = (namespaceNames: List<string>, f: () => void): void => {
        const first = namespaceNames.first();
        if (first === undefined) {
            f();
        } else {
            this.emitBlock(
                ["namespace ", first],
                false,
                () => this.emitNamespaces(namespaceNames.rest(), f),
                namespaceNames.size === 1
            );
        }
    };

    private cppTypeInOptional = (nonNulls: OrderedSet<Type>, ctx: TypeContext, withIssues: boolean): Sourcelike => {
        if (nonNulls.size === 1) {
            return this.cppType(defined(nonNulls.first()), ctx, withIssues);
        }
        const typeList: Sourcelike = [];
        nonNulls.forEach((t: Type) => {
            if (typeList.length !== 0) {
                typeList.push(", ");
            }
            typeList.push(
                this.cppType(
                    t,
                    {
                        needsForwardIndirection: true,
                        needsOptionalIndirection: false,
                        inJsonNamespace: ctx.inJsonNamespace
                    },
                    withIssues
                )
            );
        });
        return ["boost::variant<", typeList, ">"];
    };

    private variantType = (u: UnionType, inJsonNamespace: boolean): Sourcelike => {
        const [maybeNull, nonNulls] = removeNullFromUnion(u, true);
        assert(nonNulls.size >= 2, "Variant not needed for less than two types.");
        const indirection = maybeNull !== null;
        const variant = this.cppTypeInOptional(
            nonNulls,
            { needsForwardIndirection: !indirection, needsOptionalIndirection: !indirection, inJsonNamespace },
            true
        );
        if (!indirection) {
            return variant;
        }
        return [optionalType, "<", variant, ">"];
    };

    private ourQualifier = (inJsonNamespace: boolean): Sourcelike => {
        return inJsonNamespace ? [intercalate("::", this._namespaceNames).toArray(), "::"] : [];
    };

    private jsonQualifier = (inJsonNamespace: boolean): Sourcelike => {
        return inJsonNamespace ? [] : "nlohmann::";
    };

    private variantIndirection = (needIndirection: boolean, typeSrc: Sourcelike): Sourcelike => {
        if (!needIndirection) return typeSrc;
        return ["std::unique_ptr<", typeSrc, ">"];
    };

    private cppType = (t: Type, ctx: TypeContext, withIssues: boolean): Sourcelike => {
        const inJsonNamespace = ctx.inJsonNamespace;
        return matchType<Sourcelike>(
            t,
            _anyType =>
                maybeAnnotated(withIssues, anyTypeIssueAnnotation, [this.jsonQualifier(inJsonNamespace), "json"]),
            _nullType =>
                maybeAnnotated(withIssues, nullTypeIssueAnnotation, [this.jsonQualifier(inJsonNamespace), "json"]),
            _boolType => "bool",
            _integerType => "int64_t",
            _doubleType => "double",
            _stringType => "std::string",
            arrayType => [
                "std::vector<",
                this.cppType(
                    arrayType.items,
                    { needsForwardIndirection: false, needsOptionalIndirection: true, inJsonNamespace },
                    withIssues
                ),
                ">"
            ],
            classType =>
                this.variantIndirection(ctx.needsForwardIndirection && this.isForwardDeclaredType(classType), [
                    "struct ",
                    this.ourQualifier(inJsonNamespace),
                    this.nameForNamedType(classType)
                ]),
            mapType => [
                "std::map<std::string, ",
                this.cppType(
                    mapType.values,
                    { needsForwardIndirection: false, needsOptionalIndirection: true, inJsonNamespace },
                    withIssues
                ),
                ">"
            ],
            enumType => [this.ourQualifier(inJsonNamespace), this.nameForNamedType(enumType)],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable === null) return [this.ourQualifier(inJsonNamespace), this.nameForNamedType(unionType)];
                return [
                    optionalType,
                    "<",
                    this.cppType(
                        nullable,
                        { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace },
                        withIssues
                    ),
                    ">"
                ];
            }
        );
    };

    private emitClass = (c: ClassType, className: Name): void => {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock(["struct ", className], true, () => {
            this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                this.emitLine(
                    this.cppType(
                        property.type,
                        { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false },
                        true
                    ),
                    " ",
                    name,
                    ";"
                );
            });
        });
    };

    private emitClassFunctions = (c: ClassType, className: Name): void => {
        const ourQualifier = this.ourQualifier(true);
        this.emitBlock(
            ["inline void from_json(const json& _j, struct ", ourQualifier, className, "& _x)"],
            false,
            () => {
                this.forEachClassProperty(c, "none", (name, json, p) => {
                    const t = p.type;
                    if (t instanceof UnionType) {
                        const [maybeNull, nonNulls] = removeNullFromUnion(t, true);
                        if (maybeNull !== null) {
                            this.emitLine(
                                "_x.",
                                name,
                                " = ",
                                ourQualifier,
                                "get_optional<",
                                this.cppTypeInOptional(
                                    nonNulls,
                                    {
                                        needsForwardIndirection: false,
                                        needsOptionalIndirection: false,
                                        inJsonNamespace: true
                                    },
                                    false
                                ),
                                '>(_j, "',
                                stringEscape(json),
                                '");'
                            );
                            return;
                        }
                    }
                    if (t.kind === "null" || t.kind === "any") {
                        this.emitLine("_x.", name, " = ", ourQualifier, 'get_untyped(_j, "', stringEscape(json), '");');
                        return;
                    }
                    const cppType = this.cppType(
                        t,
                        { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true },
                        false
                    );
                    this.emitLine("_x.", name, ' = _j.at("', stringEscape(json), '").get<', cppType, ">();");
                });
            }
        );
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json& _j, const struct ", ourQualifier, className, "& _x)"], false, () => {
            this.emitLine("_j = json::object();");
            this.forEachClassProperty(c, "none", (name, json, _) => {
                this.emitLine('_j["', stringEscape(json), '"] = _x.', name, ";");
            });
        });
    };

    private emitEnum = (e: EnumType, enumName: Name): void => {
        const caseNames: Sourcelike[] = [];
        this.forEachEnumCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum class ", enumName, " { ", caseNames, " };");
    };

    private emitUnionTypedefs = (u: UnionType, unionName: Name): void => {
        this.emitLine("typedef ", this.variantType(u, false), " ", unionName, ";");
    };

    private emitUnionFunctions = (u: UnionType): void => {
        const functionForKind: [string, string][] = [
            ["bool", "is_boolean"],
            ["integer", "is_number_integer"],
            ["double", "is_number"],
            ["string", "is_string"],
            ["class", "is_object"],
            ["map", "is_object"],
            ["array", "is_array"],
            ["enum", "is_string"]
        ];
        const nonNulls = removeNullFromUnion(u, true)[1];
        const variantType = this.cppTypeInOptional(
            nonNulls,
            { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true },
            false
        );
        this.emitBlock(["inline void from_json(const json& _j, ", variantType, "& _x)"], false, () => {
            let onFirst = true;
            for (const [kind, func] of functionForKind) {
                const typeForKind = nonNulls.find((t: Type) => t.kind === kind);
                if (typeForKind === undefined) continue;
                this.emitLine(onFirst ? "if" : "else if", " (_j.", func, "())");
                this.indent(() => {
                    this.emitLine(
                        "_x = _j.get<",
                        this.cppType(
                            typeForKind,
                            { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true },
                            false
                        ),
                        ">();"
                    );
                });
                onFirst = false;
            }
            this.emitLine('else throw "Could not deserialize";');
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json& _j, const ", variantType, "& _x)"], false, () => {
            this.emitBlock("switch (_x.which())", false, () => {
                let i = 0;
                nonNulls.forEach((t: Type) => {
                    this.emitLine("case ", i.toString(), ":");
                    this.indent(() => {
                        this.emitLine(
                            "_j = boost::get<",
                            this.cppType(
                                t,
                                {
                                    needsForwardIndirection: true,
                                    needsOptionalIndirection: true,
                                    inJsonNamespace: true
                                },
                                false
                            ),
                            ">(_x);"
                        );
                        this.emitLine("break;");
                    });
                    i++;
                });
                this.emitLine('default: throw "Input JSON does not conform to schema";');
            });
        });
    };

    private emitEnumFunctions = (e: EnumType, enumName: Name): void => {
        const ourQualifier = this.ourQualifier(true);
        this.emitBlock(["inline void from_json(const json& _j, ", ourQualifier, enumName, "& _x)"], false, () => {
            let onFirst = true;
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                const maybeElse = onFirst ? "" : "else ";
                this.emitLine(
                    maybeElse,
                    'if (_j == "',
                    stringEscape(jsonName),
                    '") _x = ',
                    ourQualifier,
                    enumName,
                    "::",
                    name,
                    ";"
                );
                onFirst = false;
            });
            this.emitLine('else throw "Input JSON does not conform to schema";');
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json& _j, const ", ourQualifier, enumName, "& _x)"], false, () => {
            this.emitBlock("switch (_x)", false, () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine(
                        "case ",
                        ourQualifier,
                        enumName,
                        "::",
                        name,
                        ': _j = "',
                        stringEscape(jsonName),
                        '"; break;'
                    );
                });
                this.emitLine('default: throw "This should not happen";');
            });
        });
    };

    private emitTopLevelTypedef = (t: Type, name: Name): void => {
        this.emitLine(
            "typedef ",
            this.cppType(
                t,
                { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false },
                true
            ),
            " ",
            name,
            ";"
        );
    };

    private emitAllUnionFunctions = (): void => {
        this.forEachUniqueUnion(
            "interposing",
            u =>
                this.sourcelikeToString(
                    this.cppTypeInOptional(
                        removeNullFromUnion(u, true)[1],
                        { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true },
                        false
                    )
                ),
            this.emitUnionFunctions
        );
    };

    private emitOptionalHelpers = (): void => {
        this.emitLine("template <typename T>");
        this.emitMultiline(`struct adl_serializer<std::unique_ptr<T>> {
    static void to_json(json& j, const std::unique_ptr<T>& opt) {
        if (!opt)
            j = nullptr;
        else
            j = *opt;
    }

    static std::unique_ptr<T> from_json(const json& j) {
        if (j.is_null())
            return std::unique_ptr<T>();
        else
            return std::unique_ptr<T>(new T(j.get<T>()));
    }
};`);
    };

    private emitDeclaration(decl: Declaration): void {
        if (decl.kind === "forward") {
            this.emitLine("struct ", this.nameForNamedType(decl.type), ";");
        } else if (decl.kind === "define") {
            const t = decl.type;
            const name = this.nameForNamedType(t);
            if (t instanceof ClassType) {
                this.emitClass(t, name);
            } else if (t instanceof EnumType) {
                this.emitEnum(t, name);
            } else if (t instanceof UnionType) {
                this.emitUnionTypedefs(t, name);
            } else {
                return panic(`Cannot declare type ${t.kind}`);
            }
        } else {
            return assertNever(decl.kind);
        }
    }

    private emitTypes = (): void => {
        if (!this._options.justTypes) {
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
        }
        this.forEachDeclaration("interposing", decl => this.emitDeclaration(decl));
        if (this._options.justTypes) return;
        this.forEachTopLevel(
            "leading",
            this.emitTopLevelTypedef,
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );
        this.emitMultiline(`
inline json get_untyped(const json &j, const char *property) {
    if (j.find(property) != j.end()) {
        return j.at(property).get<json>();
    }
    return json();
}`);
        if (this.haveUnions) {
            this.emitMultiline(`
template <typename T>
inline ${optionalType}<T> get_optional(const json &j, const char *property) {
    if (j.find(property) != j.end())
        return j.at(property).get<${optionalType}<T>>();
    return ${optionalType}<T>();
}`);
        }
    };

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitCommentLines([
                " To parse this JSON data, first install",
                "",
                "     Boost     http://www.boost.org",
                "     json.hpp  https://github.com/nlohmann/json",
                "",
                " Then include this file, and then do",
                ""
            ]);
            this.forEachTopLevel("none", (_, topLevelName) => {
                this.emitLine(
                    "//     ",
                    this.ourQualifier(false),
                    topLevelName,
                    " data = nlohmann::json::parse(jsonString);"
                );
            });
        }
        this.ensureBlankLine();

        const guardName: Sourcelike = [
            "__QUICKTYPE_",
            intercalate("_", this.topLevels.keySeq().map(n => legalizeName(allUpperWordStyle(n)))).toArray(),
            "_HPP__"
        ];
        this.emitLine("#ifndef ", guardName);
        this.emitLine("#define ", guardName);
        this.ensureBlankLine();

        const include = (name: string): void => {
            this.emitLine(`#include ${name}`);
        };
        if (this.haveNamedUnions) include("<boost/variant.hpp>");
        if (!this._options.justTypes) include('"json.hpp"');
        this.ensureBlankLine();

        if (this._options.justTypes) {
            this.emitTypes();
        } else {
            this.emitNamespaces(this._namespaceNames, this.emitTypes);
        }

        if (!this._options.justTypes && this.haveNamedTypes) {
            this.ensureBlankLine();
            this.emitNamespaces(List(["nlohmann"]), () => {
                if (this.haveUnions) {
                    this.emitOptionalHelpers();
                }
                this.forEachObject("leading-and-interposing", this.emitClassFunctions);
                this.forEachEnum("leading-and-interposing", this.emitEnumFunctions);
                if (this.haveUnions) {
                    this.ensureBlankLine();
                    this.emitAllUnionFunctions();
                }
            });
        }

        this.ensureBlankLine();
        this.emitLine("#endif");
    }
}
