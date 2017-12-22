"use strict";

import { OrderedSet } from "immutable";

import { TargetLanguage } from "../TargetLanguage";
import {
    Type,
    NamedType,
    ClassType,
    EnumType,
    UnionType,
    nullableFromUnion,
    matchType,
    removeNullFromUnion
} from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Namespace, Name, Namer, funPrefixNamer } from "../Naming";
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
} from "../Strings";
import { defined, assertNever } from "../Support";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { StringOption, EnumOption, BooleanOption } from "../RendererOptions";
import { assert } from "../Support";

type NamingStyle = "pascal" | "camel" | "underscore" | "upper-underscore";

const pascalValue: [string, NamingStyle] = ["pascal-case", "pascal"];
const underscoreValue: [string, NamingStyle] = ["underscore-case", "underscore"];
const camelValue: [string, NamingStyle] = ["camel-case", "camel"];
const upperUnderscoreValue: [string, NamingStyle] = ["upper-underscore-case", "upper-underscore"];

export default class CPlusPlusTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);
    private readonly _namespaceOption = new StringOption(
        "namespace",
        "Name of the generated namespace",
        "NAME",
        "quicktype"
    );
    private readonly _typeNamingStyleOption = new EnumOption<NamingStyle>("type-style", "Naming style for types", [
        pascalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue
    ]);
    private readonly _memberNamingStyleOption = new EnumOption<NamingStyle>(
        "member-style",
        "Naming style for members",
        [underscoreValue, pascalValue, camelValue, upperUnderscoreValue]
    );
    private readonly _enumeratorNamingStyleOption = new EnumOption<NamingStyle>(
        "enumerator-style",
        "Naming style for enumerators",
        [upperUnderscoreValue, underscoreValue, pascalValue, camelValue]
    );
    private readonly _uniquePtrOption = new EnumOption("unions", "Use containment or indirection for unions", [
        ["containment", false],
        ["indirection", true]
    ]);

    constructor() {
        super("C++", ["c++", "cpp", "cplusplus"], "cpp");
        this.setOptions([
            this._justTypesOption,
            this._namespaceOption,
            this._typeNamingStyleOption,
            this._memberNamingStyleOption,
            this._enumeratorNamingStyleOption,
            this._uniquePtrOption
        ]);
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return CPlusPlusRenderer;
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
    "transaction_safe_dynamic"
];

class CPlusPlusRenderer extends ConvenienceRenderer {
    private readonly _typeNameStyle: (rawName: string) => string;
    private readonly _typeNamingFunction: Namer;
    private readonly _memberNamingFunction: Namer;
    private readonly _caseNamingFunction: Namer;
    private readonly _optionalType: string;

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        private readonly _namespaceName: string,
        _typeNamingStyle: NamingStyle,
        _memberNamingStyle: NamingStyle,
        _enumeratorNamingStyle: NamingStyle,
        private readonly _uniquePtr: boolean
    ) {
        super(graph, leadingComments);

        this._typeNameStyle = cppNameStyle(_typeNamingStyle);
        this._typeNamingFunction = funPrefixNamer(this._typeNameStyle);
        this._memberNamingFunction = funPrefixNamer(cppNameStyle(_memberNamingStyle));
        this._caseNamingFunction = funPrefixNamer(cppNameStyle(_enumeratorNamingStyle));
        this._optionalType = _uniquePtr ? "std::unique_ptr" : "boost::optional";
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForClassProperties(
        _c: ClassType,
        _classNamed: Name
    ): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected topLevelNameStyle(rawName: string): string {
        return this._typeNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return this._typeNamingFunction;
    }

    protected get classPropertyNamer(): Namer {
        return this._memberNamingFunction;
    }

    protected get unionMemberNamer(): null {
        return null;
    }

    protected get enumCaseNamer(): Namer {
        return this._caseNamingFunction;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    private emitBlock = (line: Sourcelike, withSemicolon: boolean, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        if (withSemicolon) {
            this.emitLine("};");
        } else {
            this.emitLine("}");
        }
    };

    private emitNamespace = (namespaceName: string, f: () => void): void => {
        this.emitBlock(["namespace ", namespaceName], false, f);
    };

    private cppTypeInOptional = (
        nonNulls: OrderedSet<Type>,
        inJsonNamespace: boolean,
        withIssues: boolean
    ): Sourcelike => {
        if (nonNulls.size === 1) {
            return this.cppType(defined(nonNulls.first()), false, inJsonNamespace, withIssues);
        }
        const typeList: Sourcelike = [];
        nonNulls.forEach((t: Type) => {
            if (typeList.length !== 0) {
                typeList.push(", ");
            }
            typeList.push(this.cppType(t, true, inJsonNamespace, withIssues));
        });
        return ["boost::variant<", typeList, ">"];
    };

    private variantType = (u: UnionType, inJsonNamespace: boolean): Sourcelike => {
        const [hasNull, nonNulls] = removeNullFromUnion(u);
        assert(nonNulls.size >= 2, "Variant not needed for less than two types.");
        const variant = this.cppTypeInOptional(nonNulls, inJsonNamespace, true);
        if (!hasNull) {
            return variant;
        }
        return [this._optionalType, "<", variant, ">"];
    };

    private ourQualifier = (inJsonNamespace: boolean): Sourcelike => {
        return inJsonNamespace ? [this._namespaceName, "::"] : [];
    };

    private jsonQualifier = (inJsonNamespace: boolean): Sourcelike => {
        return inJsonNamespace ? [] : "nlohmann::";
    };

    private variantIndirection = (inVariant: boolean, typeSrc: Sourcelike): Sourcelike => {
        if (!inVariant || !this._uniquePtr) return typeSrc;
        return ["std::unique_ptr<", typeSrc, ">"];
    };

    private cppType = (t: Type, inVariant: boolean, inJsonNamespace: boolean, withIssues: boolean): Sourcelike => {
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
            arrayType => ["std::vector<", this.cppType(arrayType.items, false, inJsonNamespace, withIssues), ">"],
            classType =>
                this.variantIndirection(inVariant, [
                    "struct ",
                    this.ourQualifier(inJsonNamespace),
                    this.nameForNamedType(classType)
                ]),
            mapType => [
                "std::map<std::string, ",
                this.cppType(mapType.values, false, inJsonNamespace, withIssues),
                ">"
            ],
            enumType => [this.ourQualifier(inJsonNamespace), this.nameForNamedType(enumType)],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (!nullable) return [this.ourQualifier(inJsonNamespace), this.nameForNamedType(unionType)];
                return [this._optionalType, "<", this.cppType(nullable, false, inJsonNamespace, withIssues), ">"];
            }
        );
    };

    private emitClass = (c: ClassType, className: Name): void => {
        this.emitBlock(["struct ", className], true, () => {
            this.forEachClassProperty(c, "none", (name, _json, propertyType) => {
                this.emitLine(this.cppType(propertyType, false, false, true), " ", name, ";");
            });
        });
    };

    private emitClassFunctions = (c: ClassType, className: Name): void => {
        const ourQualifier = this.ourQualifier(true);
        this.emitBlock(
            ["inline void from_json(const json& _j, struct ", ourQualifier, className, "& _x)"],
            false,
            () => {
                this.forEachClassProperty(c, "none", (name, json, t) => {
                    if (t instanceof UnionType) {
                        const [hasNull, nonNulls] = removeNullFromUnion(t);
                        if (hasNull) {
                            this.emitLine(
                                "_x.",
                                name,
                                " = ",
                                ourQualifier,
                                "get_optional<",
                                this.cppTypeInOptional(nonNulls, true, false),
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
                    const cppType = this.cppType(t, false, true, false);
                    this.emitLine("_x.", name, ' = _j.at("', stringEscape(json), '").get<', cppType, ">();");
                });
            }
        );
        this.emitNewline();
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
        const nonNulls = removeNullFromUnion(u)[1];
        const variantType = this.cppTypeInOptional(nonNulls, true, false);
        this.emitBlock(["inline void from_json(const json& _j, ", variantType, "& _x)"], false, () => {
            let onFirst = true;
            for (const [kind, func] of functionForKind) {
                const typeForKind = nonNulls.find((t: Type) => t.kind === kind);
                if (typeForKind === undefined) continue;
                this.emitLine(onFirst ? "if" : "else if", " (_j.", func, "())");
                this.indent(() => {
                    this.emitLine("_x = _j.get<", this.cppType(typeForKind, true, true, false), ">();");
                });
                onFirst = false;
            }
            this.emitLine('else throw "Could not deserialize";');
        });
        this.emitNewline();
        this.emitBlock(["inline void to_json(json& _j, const ", variantType, "& _x)"], false, () => {
            this.emitBlock("switch (_x.which())", false, () => {
                let i = 0;
                nonNulls.forEach((t: Type) => {
                    this.emitLine("case ", i.toString(), ":");
                    this.indent(() => {
                        this.emitLine("_j = boost::get<", this.cppType(t, true, true, false), ">(_x);");
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
        this.emitNewline();
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
        this.emitLine("typedef ", this.cppType(t, false, false, true), " ", name, ";");
    };

    private emitAllUnionFunctions = (): void => {
        this.forEachUniqueUnion(
            "interposing",
            u => this.sourcelikeToString(this.cppTypeInOptional(removeNullFromUnion(u)[1], true, false)),
            this.emitUnionFunctions
        );
    };

    private emitOptionalHelpers = (): void => {
        this.emitLine("template <typename T>");
        if (this._uniquePtr) {
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
        } else {
            this.emitMultiline(`struct adl_serializer<boost::optional<T>> {
    static void to_json(json& j, const boost::optional<T>& opt) {
        if (opt == boost::none)
            j = nullptr;
        else
            j = *opt;
    }
    
    static void from_json(const json& j, boost::optional<T>& opt) {
        if (j.is_null())
            opt = boost::none;
        else
            opt = j.get<T>();
    }
};`);
        }
    };

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines("// ", this.leadingComments);
        } else if (!this._justTypes) {
            this.emitCommentLines("// ", [
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
        this.emitNewline();
        if (this.haveUnions && !this._uniquePtr) {
            this.emitLine("#include <boost/optional.hpp>");
        }
        if (this.haveNamedUnions) {
            this.emitLine("#include <boost/variant.hpp>");
        }
        if (!this._justTypes) {
            this.emitLine('#include "json.hpp"');
        }
        this.emitNewline();
        this.emitNamespace(this._namespaceName, () => {
            if (!this._justTypes) {
                this.emitLine("using nlohmann::json;");
                this.emitNewline();
            }
            this.forEachNamedType("interposing", true, this.emitClass, this.emitEnum, this.emitUnionTypedefs);
            if (this._justTypes) return;
            this.forEachTopLevel("leading", this.emitTopLevelTypedef, t => !this.namedTypeToNameForTopLevel(t));
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
    inline ${this._optionalType}<T> get_optional(const json &j, const char *property) {
        if (j.find(property) != j.end())
            return j.at(property).get<${this._optionalType}<T>>();
        return ${this._optionalType}<T>();
    }`);
            }
        });
        if (this._justTypes) return;
        this.emitNewline();
        this.emitNamespace("nlohmann", () => {
            if (this.haveUnions) {
                this.emitOptionalHelpers();
            }
            this.forEachClass("leading-and-interposing", this.emitClassFunctions);
            this.forEachEnum("leading-and-interposing", this.emitEnumFunctions);
            if (this.haveUnions) {
                this.emitNewline();
                this.emitAllUnionFunctions();
            }
        });
    }
}
