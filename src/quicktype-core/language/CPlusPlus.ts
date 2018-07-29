import { arrayIntercalate, toReadonlyArray, iterableFirst, iterableFind } from "collection-utils";

import { TargetLanguage } from "../TargetLanguage";
import { Type, ArrayType, ClassType, ClassProperty, EnumType, UnionType } from "../Type";
import { nullableFromUnion, matchType, removeNullFromUnion } from "../TypeUtils";
import { Name, Namer, funPrefixNamer, DependencyName } from "../Naming";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import {
    legalizeCharacters,
    isAscii,
    isLetterOrUnderscoreOrDigit,
    stringEscape,
    NamingStyle,
    makeNameStyle
} from "../support/Strings";
import { defined, assertNever, panic } from "../support/Support";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { StringOption, EnumOption, BooleanOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { assert } from "../support/Support";
import { Declaration } from "../DeclarationIR";
import { RenderContext } from "../Renderer";
import { getAccessorName } from "../AccessorNames";
import { enumCaseNames } from "../EnumValues";

const pascalValue: [string, NamingStyle] = ["pascal-case", "pascal"];
const underscoreValue: [string, NamingStyle] = ["underscore-case", "underscore"];
const camelValue: [string, NamingStyle] = ["camel-case", "camel"];
const upperUnderscoreValue: [string, NamingStyle] = ["upper-underscore-case", "upper-underscore"];
const pascalUpperAcronymsValue: [string, NamingStyle] = ["pascal-case-upper-acronyms", "pascal-upper-acronyms"];
const camelUpperAcronymsValue: [string, NamingStyle] = ["camel-case-upper-acronyms", "camel-upper-acronyms"];

export const cPlusPlusOptions = {
    typeSourceStyle: new EnumOption("source-style", "Source code generation type, ",
        [["single-source", true], ["multi-source", false]],
        "single-source",
        "secondary"
    ),
    withGetterSetter: new BooleanOption("with-getter-setter", "Whether to generate classes with getters/setters instead of structs", false),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption("namespace", "Name of the generated namespace(s)", "NAME", "quicktype"),
    typeNamingStyle: new EnumOption<NamingStyle>("type-style", "Naming style for types", [
        pascalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    memberNamingStyle: new EnumOption<NamingStyle>("member-style", "Naming style for members", [
        underscoreValue,
        pascalValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    enumeratorNamingStyle: new EnumOption<NamingStyle>("enumerator-style", "Naming style for enumerators", [
        upperUnderscoreValue,
        underscoreValue,
        pascalValue,
        camelValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ])
};

export class CPlusPlusTargetLanguage extends TargetLanguage {
    constructor(displayName: string = "C++", names: string[] = ["c++", "cpp", "cplusplus"], extension: string = "cpp") {
        super(displayName, names, extension);
    }

    protected getOptions(): Option<any>[] {
        return [
            cPlusPlusOptions.justTypes,
            cPlusPlusOptions.typeSourceStyle,
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

export type TypeContext = {
    needsForwardIndirection: boolean;
    needsOptionalIndirection: boolean;
    inJsonNamespace: boolean;
};

export class CPlusPlusRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name, Name]>();
    private readonly _namespaceNames: ReadonlyArray<string>;

    private readonly _memberNamingFunction: Namer;

    protected readonly typeNamingStyle: NamingStyle;
    protected readonly enumeratorNamingStyle: NamingStyle;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof cPlusPlusOptions>
    ) {
        super(targetLanguage, renderContext);

        this._namespaceNames = _options.namespace.split("::");

        this.typeNamingStyle = _options.typeNamingStyle;
        this.enumeratorNamingStyle = _options.enumeratorNamingStyle;

        this._memberNamingFunction = funPrefixNamer("members", makeNameStyle(_options.memberNamingStyle, legalizeName));
        this._gettersAndSettersForPropertyName = new Map();
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
        return funPrefixNamer("types", makeNameStyle(this.typeNamingStyle, legalizeName));
    }

    protected namerForObjectProperty(): Namer {
        return this._memberNamingFunction;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enumerators", makeNameStyle(this.enumeratorNamingStyle, legalizeName));
    }

    protected makeNamesForPropertyGetterAndSetter(
        _c: ClassType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        name: Name
    ): [Name, Name, Name] {
        const getterName = new DependencyName(this._memberNamingFunction, name.order, lookup => `get_${lookup(name)}`);
        const mutableGetterName = new DependencyName(this._memberNamingFunction, name.order, lookup => `getMutable_${lookup(name)}`);
        const setterName = new DependencyName(this._memberNamingFunction, name.order, lookup => `set_${lookup(name)}`);
        return [getterName, mutableGetterName, setterName];
    }

    protected makePropertyDependencyNames(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        name: Name
    ): Name[] {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(c, className, p, jsonName, name);
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }

    protected startFile(basename: Sourcelike): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        if (basename !== undefined) {
            this._currentFilename = `${this.sourcelikeToString(basename)}.h`;
        }

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

            if (this._options.typeSourceStyle) {
                this.forEachTopLevel("none", (_, topLevelName) => {
                    this.emitLine(
                        "//     ",
                        this.ourQualifier(false),
                        topLevelName,
                        " data = nlohmann::json::parse(jsonString);"
                    );
                });
            } else {
                this.emitLine(
                    "//     ",
                    this.ourQualifier(false),
                    basename,
                    " data = nlohmann::json::parse(jsonString);"
                );
            }
        }
        this.ensureBlankLine();

        this.emitLine("#pragma once");
        this.ensureBlankLine();

        const include = (name: string): void => {
            this.emitLine(`#include ${name}`);
        };
        if (this.haveNamedUnions) include("<boost/variant.hpp>");
        if (!this._options.justTypes) include("<nlohmann/json.hpp>");
        this.ensureBlankLine();
    }

    protected finishFile(): void {
        this.ensureBlankLine();
        this.emitLine("#endif");

        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
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

    protected emitBlock(line: Sourcelike, withSemicolon: boolean, f: () => void, withIndent: boolean = true): void {
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
    }

    protected emitNamespaces(namespaceNames: Iterable<string>, f: () => void): void {
        const namesArray = toReadonlyArray(namespaceNames);
        const first = namesArray[0];
        if (first === undefined) {
            f();
        } else {
            this.emitBlock(
                ["namespace ", first],
                false,
                () => this.emitNamespaces(namesArray.slice(1), f),
                namesArray.length === 1
            );
        }
    }

    protected cppTypeInOptional(nonNulls: ReadonlySet<Type>, ctx: TypeContext, withIssues: boolean): Sourcelike {
        if (nonNulls.size === 1) {
            return this.cppType(defined(iterableFirst(nonNulls)), ctx, withIssues);
        }
        const typeList: Sourcelike = [];
        for (const t of nonNulls) {
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
        }
        return ["boost::variant<", typeList, ">"];
    }

    protected variantType(u: UnionType, inJsonNamespace: boolean): Sourcelike {
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
    }

    protected ourQualifier(inJsonNamespace: boolean): Sourcelike {
        return inJsonNamespace ? [arrayIntercalate("::", this._namespaceNames), "::"] : [];
    }

    protected jsonQualifier(inJsonNamespace: boolean): Sourcelike {
        return inJsonNamespace ? [] : "nlohmann::";
    }

    protected variantIndirection(needIndirection: boolean, typeSrc: Sourcelike): Sourcelike {
        if (!needIndirection) return typeSrc;
        return ["std::unique_ptr<", typeSrc, ">"];
    }

    protected cppType(t: Type, ctx: TypeContext, withIssues: boolean): Sourcelike {
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
    }

    protected emitClassMembers(c: ClassType): void {
        if (this._options.withGetterSetter) {
            this.emitLine("private:");
            this.ensureBlankLine();

            this.forEachClassProperty(c, "none", (name, _jsonName, property) => {
                this.emitLine(this.cppType(property.type, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true), " ", name, ";");
            });

            this.emitLine("public:");
            this.ensureBlankLine();
        }

        this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, property) => {
            this.emitDescription(this.descriptionForClassProperty(c, jsonName));
            if (!this._options.withGetterSetter) {
                this.emitLine(this.cppType(property.type, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true), " ", name, ";");
            } else {
                const [getterName, mutableGetterName, setterName] = defined(this._gettersAndSettersForPropertyName.get(name));
                const rendered = this.cppType(property.type, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true);
                this.emitLine("const ", rendered, " & ", getterName, "() const { return ", name, "; }");
                this.emitLine(rendered, " & ", mutableGetterName, "() { return ", name, "; }");
                this.emitLine("void ", setterName, "( const ", rendered, "& value) { ", name, " = value; }");   
            }
        });
    }

    protected emitClass(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock([ this._options.withGetterSetter ? "class " : "struct ", className], true, () => {
            if (this._options.withGetterSetter) {
                this.emitLine("public:");
                this.ensureBlankLine();
                this.emitLine(className, "() = default;");
                this.emitLine("virtual ~", className, "() = default;");
                this.ensureBlankLine();

                this.emitLine("friend std::ostream& operator<<(std::ostream& os, ", className, " const& ms){");
                this.forEachClassProperty(c, "none", (name, _jsonName, property) => {
                    const [getterName, , ] = defined(this._gettersAndSettersForPropertyName.get(name));
                    if (property.type.kind == "array") {
                        this.emitLine("    os << \"", name, " : \" << stringify(ms.", getterName, "()) << std::endl;");
                    } else {
                        this.emitLine("    os << \"", name, " : \" << ms.", getterName, "() << std::endl;");
                    }
                });

                this.emitLine("    return os;");
                this.emitLine("}");
                this.ensureBlankLine();
            }

            this.emitClassMembers(c);
        });
    }

    protected emitClassFunctions(c: ClassType, className: Name): void {
        const ourQualifier = this.ourQualifier(true);
        this.emitBlock(
            ["inline void from_json(const json& _j, ", ourQualifier, className, "& _x)"],
            false,
            () => {
                this.forEachClassProperty(c, "none", (name, json, p) => {
                    const [getterName, , setterName] = defined(this._gettersAndSettersForPropertyName.get(name));
                    const t = p.type;
                    if (t instanceof UnionType) {
                        const [maybeNull, nonNulls] = removeNullFromUnion(t, true);
                        if (maybeNull !== null) {
                            if (this._options.withGetterSetter) {
                                this.emitLine(
                                    "_x.",
                                    getterName,
                                    "( ",
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
                                    '") );'
                                );
                            } else {
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
                            }
                            return;
                        }
                    }
                    if (t.kind === "null" || t.kind === "any") {
                        if (this._options.withGetterSetter) {
                            this.emitLine("_x.", setterName, "( ", ourQualifier, 'get_untyped(_j, "', stringEscape(json), '") );');
                        } else {
                            this.emitLine("_x.", name, " = ", ourQualifier, 'get_untyped(_j, "', stringEscape(json), '");');
                        }
                        return;
                    }
                    const cppType = this.cppType(
                        t,
                        { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true },
                        false
                    );
                    if (this._options.withGetterSetter) {
                        this.emitLine("_x.", setterName, '( _j.at("', stringEscape(json), '").get<', cppType, ">() );");
                    } else {
                        this.emitLine("_x.", name, ' = _j.at("', stringEscape(json), '").get<', cppType, ">();");
                    }
                });
            }
        );
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json& _j, const ", ourQualifier, className, "& _x)"], false, () => {
            this.emitLine("_j = json::object();");
            this.forEachClassProperty(c, "none", (name, json, _) => {
                const [getterName, , ] = defined(this._gettersAndSettersForPropertyName.get(name));
                if (this._options.withGetterSetter) {
                    this.emitLine('_j["', stringEscape(json), '"] = _x.', getterName, "();");
                } else {
                    this.emitLine('_j["', stringEscape(json), '"] = _x.', name, ";");
                }
            });
        });
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        const caseNames: Sourcelike[] = [];
        const enumValues = enumCaseNames(e, this.targetLanguage.name );

        this.forEachEnumCase(e, "none", (name, jsonName) => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);

            if (enumValues !== undefined) {
                const [ enumvalue, isFixed ] = getAccessorName(enumValues, jsonName);
                if (enumvalue !== undefined && isFixed !== undefined) {
                    caseNames.push(" = " + enumvalue);
                }
            }
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum ", enumName, " { ", caseNames, " };");
    }

    protected emitUnionTypedefs(u: UnionType, unionName: Name): void {
        this.emitLine("typedef ", this.variantType(u, false), " ", unionName, ";");
    }

    protected emitUnionFunctions(u: UnionType): void {
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
                const typeForKind = iterableFind(nonNulls, t => t.kind === kind);
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
                for (const t of nonNulls) {
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
                }
                this.emitLine('default: throw "Input JSON does not conform to schema";');
            });
        });
    }

    protected emitEnumFunctions(e: EnumType, enumName: Name): void {
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
    }

    protected emitTopLevelTypedef(t: Type, name: Name): void {
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
    }

    protected emitAllUnionFunctions(): void {
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
            (u: UnionType) => this.emitUnionFunctions(u)
        );
    }

    protected emitOptionalHelpers(): void {
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
    }

    protected emitDeclaration(decl: Declaration): void {
        if (decl.kind === "forward") {
            this.emitLine("class ", this.nameForNamedType(decl.type), ";");
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

    protected emitTypes(): void {
        if (!this._options.justTypes) {
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();

            this.emitLine("template <typename T>");
            this.emitLine("std::string stringify(const T &t)");
            this.emitLine("{");
            this.emitLine("    std::stringstream ss;");
            this.emitLine("    for (auto e : t) ss << e << \", \";");
            this.emitLine("    ss << std::endl;");
            this.emitLine("    return ss.str();");
            this.emitLine("}");
            this.ensureBlankLine();
        }
        this.forEachDeclaration("interposing", decl => this.emitDeclaration(decl));
        if (this._options.justTypes) return;
        this.forEachTopLevel(
            "leading",
            (t: Type, name: Name) => this.emitTopLevelTypedef(t, name),
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
    }

    protected emitSingleSourceStructure(proposedFilename: string): void {
        this.startFile(proposedFilename);

        if (this._options.justTypes) {
            this.emitTypes();
        } else {
            this.emitNamespaces(this._namespaceNames, () => this.emitTypes());
        }

        if (!this._options.justTypes && this.haveNamedTypes) {
            this.ensureBlankLine();
            this.emitNamespaces(["nlohmann"], () => {
                if (this.haveUnions) {
                    this.emitOptionalHelpers();
                }
                this.forEachObject("leading-and-interposing", (c: ClassType, className: Name) =>
                    this.emitClassFunctions(c, className)
                );
                this.forEachEnum("leading-and-interposing", (e: EnumType, enumName: Name) =>
                    this.emitEnumFunctions(e, enumName)
                );
                if (this.haveUnions) {
                    this.ensureBlankLine();
                    this.emitAllUnionFunctions();
                }
            });
        }

        this.finishFile();
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.startFile(className);
        /** 
         * Need to generate "imports", in terms 'c' has members, which
         * are defined by others
         */
        var included : boolean = false;
        this.forEachClassProperty(c, "none", (_name, _jsonName, property) => {

            var p = property.type;

            if (p instanceof ArrayType) {
                p = p.items;
            }

            const propertytype = this.sourcelikeToString(this.cppType(p, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true));
            if (p instanceof ClassType ||
                p instanceof EnumType ||
                p instanceof UnionType) {

                this.forEachDeclaration("none", decl => {
                    const t = decl.type;
                    const decltype = this.sourcelikeToString(this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true));
                    if (t instanceof ClassType ||
                        t instanceof EnumType ||
                        t instanceof UnionType) {
                        if (propertytype == decltype) {
                            const include = (name: string): void => {
                                this.emitLine(`#include ${name}`);
                            };
                            include("\""+decltype+".h\"");
                            included = true;
                        }
                    }
                });
            }
        });

        if (included) {
            this.ensureBlankLine();
        }

        this.emitNamespaces(this._namespaceNames, () => {
            this.ensureBlankLine();
            this.emitDescription(this.descriptionForType(c));
            this.ensureBlankLine();
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitClass(c, className);
            this.ensureBlankLine();
            this.emitClassFunctions(c, className);
        });
        this.finishFile();
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.startFile(enumName);
        this.emitNamespaces(this._namespaceNames, () => {
            this.ensureBlankLine();
            this.emitDescription(this.descriptionForType(e));
            this.ensureBlankLine();
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitEnum(e, enumName);
            this.ensureBlankLine();
            this.emitEnumFunctions(e, enumName);
        });
        this.finishFile();
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        this.startFile(unionName);
        this.emitNamespaces(this._namespaceNames, () => {
            this.ensureBlankLine();
            this.emitDescription(this.descriptionForType(u));
            this.ensureBlankLine();
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitUnionTypedefs(u, unionName);
            this.ensureBlankLine();
            this.emitUnionFunctions(u);
        });
        this.finishFile();
    }

    protected emitMultiSourceStructure(_proposedFilename: string): void {
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n)
        );

/*
        if (this._options.justTypes) {
            this.emitTypes();
        } else {
            this.emitNamespaces(this._namespaceNames, () => this.emitTypes());
        }

--> helper.h
                if (this.haveUnions) {
                    this.emitOptionalHelpers();
                }

*/
    }

    protected emitSourceStructure(proposedFilename: string): void {
        if (this._options.typeSourceStyle) {
            this.emitSingleSourceStructure(proposedFilename);
        } else {
            this.emitMultiSourceStructure(proposedFilename);
        }
    }
}
