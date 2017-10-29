"use strict";

import { Map, OrderedMap, OrderedSet } from "immutable";

import { TypeScriptTargetLanguage } from "../TargetLanguage";
import {
    Type,
    TopLevels,
    PrimitiveType,
    NamedType,
    ClassType,
    UnionType,
    allClassesAndUnions,
    nullableFromUnion,
    matchType,
    removeNullFromUnion
} from "../Type";
import { Namespace, Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import {
    legalizeCharacters,
    camelCase,
    startWithLetter,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    stringEscape,
    defined
} from "../Support";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";

export default class CPlusPlusTargetLanguage extends TypeScriptTargetLanguage {
    constructor() {
        super("C++", ["c++", "cpp", "cplusplus"], "cpp", []);
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new CPlusPlusRenderer(topLevels);
        return renderer.render();
    }
}

const namingFunction = funPrefixNamer(cppNameStyle);

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);

function cppNameStyle(original: string): string {
    const legalized = legalizeName(original);
    const cameled = camelCase(legalized);
    return startWithLetter(isLetterOrUnderscore, false, cameled);
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
    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForProperties(
        c: ClassType,
        classNamed: Name
    ): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected topLevelNameStyle(rawName: string): string {
        return cppNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return namingFunction;
    }

    protected get propertyNamer(): Namer {
        return namingFunction;
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

    private cppTypeInOptional = (
        nonNulls: OrderedSet<Type>,
        withIssues: boolean = false
    ): Sourcelike => {
        if (nonNulls.size === 1) {
            return this.cppType(defined(nonNulls.first()));
        }
        const typeList: Sourcelike = [];
        nonNulls.forEach((t: Type) => {
            if (typeList.length !== 0) {
                typeList.push(", ");
            }
            typeList.push(this.cppType(t, withIssues));
        });
        return ["boost::variant<", typeList, ">"];
    };

    private variantType = (u: UnionType): Sourcelike => {
        const [hasNull, nonNulls] = removeNullFromUnion(u);
        if (nonNulls.size < 2) throw "Variant not needed for less than two types.";
        const variant = this.cppTypeInOptional(nonNulls, true);
        if (!hasNull) {
            return variant;
        }
        return ["boost::optional<", variant, ">"];
    };

    private cppType = (t: Type, withIssues: boolean = false): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "json"),
            nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "json"),
            boolType => "bool",
            integerType => "int64_t",
            doubleType => "double",
            stringType => "std::string",
            arrayType => ["std::vector<", this.cppType(arrayType.items, withIssues), ">"],
            classType => ["struct ", this.nameForNamedType(classType)],
            mapType => ["std::map<std::string, ", this.cppType(mapType.values, withIssues), ">"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (!nullable) return this.nameForNamedType(unionType);
                return ["boost::optional<", this.cppType(nullable, withIssues), ">"];
            }
        );
    };

    private emitClass = (c: ClassType, className: Name): void => {
        this.emitBlock(["struct ", className], true, () => {
            this.forEachProperty(c, "none", (name, json, propertyType) => {
                this.emitLine(this.cppType(propertyType, true), " ", name, ";");
            });
        });
    };

    private emitClassFunctions = (c: ClassType, className: Name): void => {
        this.emitBlock(
            ["void from_json(const json& _j, struct ", className, "& _x)"],
            false,
            () => {
                this.forEachProperty(c, "none", (name, json, t) => {
                    if (t instanceof UnionType) {
                        const [hasNull, nonNulls] = removeNullFromUnion(t);
                        if (hasNull) {
                            this.emitLine(
                                "_x.",
                                name,
                                " = get_optional<",
                                this.cppTypeInOptional(nonNulls),
                                '>(_j, "',
                                stringEscape(json),
                                '");'
                            );
                            return;
                        }
                    }
                    if (t.kind === "null" || t.kind === "any") {
                        this.emitLine(
                            "_x.",
                            name,
                            ' = get_untyped(_j, "',
                            stringEscape(json),
                            '");'
                        );
                        return;
                    }
                    const cppType = this.cppType(t);
                    this.emitLine(
                        "_x.",
                        name,
                        ' = _j.at("',
                        stringEscape(json),
                        '").get<',
                        cppType,
                        ">();"
                    );
                });
            }
        );
        this.emitNewline();
        this.emitBlock(["void to_json(json& _j, const struct ", className, "& _x)"], false, () => {
            if (c.properties.isEmpty()) {
                this.emitLine("_j = json::object();");
                return;
            }
            const args: Sourcelike = [];
            this.forEachProperty(c, "none", (name, json, _) => {
                if (args.length !== 0) {
                    args.push(", ");
                }
                args.push('{"', stringEscape(json), '", _x.', name, "}");
            });
            this.emitLine("_j = json{", args, "};");
        });
    };

    private emitUnionTypedefs = (u: UnionType, unionName: Name): void => {
        this.emitLine("typedef ", this.variantType(u), " ", unionName, ";");
    };

    private emitUnionFunctions = (u: UnionType): void => {
        const functionForKind: [string, string][] = [
            ["bool", "is_boolean"],
            ["integer", "is_number_integer"],
            ["double", "is_number"],
            ["string", "is_string"],
            ["class", "is_object"],
            ["map", "is_object"],
            ["array", "is_array"]
        ];
        const [_, nonNulls] = removeNullFromUnion(u);
        const variantType = this.cppTypeInOptional(nonNulls);
        this.emitBlock(["void from_json(const json& _j, ", variantType, "& _x)"], false, () => {
            let onFirst = true;
            for (const [kind, func] of functionForKind) {
                const t = nonNulls.find((t: Type) => t.kind === kind);
                if (t === undefined) continue;
                this.emitLine(onFirst ? "if" : "else if", " (_j.", func, "())");
                this.indent(() => {
                    this.emitLine("_x = _j.get<", this.cppType(t), ">();");
                });
                onFirst = false;
            }
            this.emitLine('else throw "Could not deserialize";');
        });
        this.emitNewline();
        this.emitBlock(["void to_json(json& _j, const ", variantType, "& _x)"], false, () => {
            this.emitBlock("switch (_x.which())", false, () => {
                let i = 0;
                nonNulls.forEach((t: Type) => {
                    this.emitLine("case ", i.toString(), ":");
                    this.indent(() => {
                        this.emitLine("_j = boost::get<", this.cppType(t), ">(_x);");
                        this.emitLine("break;");
                    });
                    i++;
                });
                this.emitLine('default: throw "This should not happen";');
            });
        });
    };

    private emitTopLevelTypedef = (t: Type, name: Name): void => {
        if (!this.namedTypeToNameForTopLevel(t)) {
            this.emitLine("typedef ", this.cppType(t, true), " ", name, ";");
        }
    };

    private emitAllUnionFunctions = (): void => {
        this.emitBlock(["namespace nlohmann"], false, () => {
            this.forEachUniqueUnion(
                "interposing",
                u => this.sourcelikeToString(this.cppTypeInOptional(removeNullFromUnion(u)[1])),
                this.emitUnionFunctions
            );
        });
    };

    private emitOptionalHelpers = (): void => {
        this.emitMultiline(`
template <typename T>
static boost::optional<T> get_optional(const json &j, const char *property) {
    if (j.find(property) != j.end()) {
        return j.at(property).get<boost::optional<T>>();
    }
    return boost::optional<T>();
}`);
        this.emitNewline();
        this.emitBlock(["namespace nlohmann"], false, () => {
            this.emitMultiline(`
template <typename T>
struct adl_serializer<boost::optional<T>> {
    static void to_json(json& j, const boost::optional<T>& opt) {
        if (opt == boost::none) {
            j = nullptr;
        } else {
            j = *opt; // this will call adl_serializer<T>::to_json which will
            // find the free function to_json in T's namespace!
        }
    }
    
    static void from_json(const json& j, boost::optional<T>& opt) {
        if (j.is_null()) {
            opt = boost::none;
        } else {
            opt = j.get<T>(); // same as above, but with
            // adl_serializer<T>::from_json
        }
    }
};`);
        });
    };

    protected emitSourceStructure(): void {
        this.emitLine("// To parse this JSON data, first install");
        this.emitLine("//");
        this.emitLine("//     Boost     http://www.boost.org");
        this.emitLine("//     json.hpp  https://github.com/nlohmann/json");
        this.emitLine("//");
        this.emitLine("// Then include this file, and then do");
        this.emitLine("//");
        this.forEachTopLevel("none", (_, topLevelName) => {
            this.emitLine("//     ", topLevelName, " data = json::parse(jsonString);");
        });
        this.emitNewline();
        if (this.haveUnions) {
            this.emitLine("#include <boost/optional.hpp>");
        }
        if (this.haveNamedUnions) {
            this.emitLine("#include <boost/variant.hpp>");
        }
        this.emitLine('#include "json.hpp"');
        this.emitNewline();
        this.emitLine("using nlohmann::json;");
        this.forEachNamedType(
            "leading-and-interposing",
            true,
            this.emitClass,
            this.emitUnionTypedefs
        );
        this.forEachTopLevel("leading", this.emitTopLevelTypedef);
        if (this.haveUnions) {
            this.emitOptionalHelpers();
        }
        this.emitMultiline(`
static json get_untyped(const json &j, const char *property) {
    if (j.find(property) != j.end()) {
        return j.at(property).get<json>();
    }
    return json();
}`);
        this.forEachClass("leading-and-interposing", this.emitClassFunctions);
        if (this.haveUnions) {
            this.emitNewline();
            this.emitAllUnionFunctions();
        }
    }
}
