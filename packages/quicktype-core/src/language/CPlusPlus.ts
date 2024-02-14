import {
    setUnion,
    arrayIntercalate,
    toReadonlyArray,
    iterableFirst,
    iterableFind,
    iterableSome,
    withDefault
} from "collection-utils";

import { TargetLanguage } from "../TargetLanguage";
import { Type, TypeKind, ClassType, ClassProperty, ArrayType, MapType, EnumType, UnionType } from "../Type";
import { nullableFromUnion, matchType, removeNullFromUnion, isNamedType, directlyReachableTypes } from "../TypeUtils";
import { NameStyle, Name, Namer, funPrefixNamer, DependencyName } from "../Naming";
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
import { defined, assertNever, panic, numberEnumValues } from "../support/Support";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { StringOption, EnumOption, BooleanOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { assert } from "../support/Support";
import { Declaration } from "../DeclarationIR";
import { RenderContext } from "../Renderer";
import { getAccessorName } from "../attributes/AccessorNames";
import { enumCaseValues } from "../attributes/EnumValues";
import { minMaxValueForType, minMaxLengthForType, patternForType, MinMaxConstraint } from "../attributes/Constraints";

const pascalValue: [string, NamingStyle] = ["pascal-case", "pascal"];
const underscoreValue: [string, NamingStyle] = ["underscore-case", "underscore"];
const camelValue: [string, NamingStyle] = ["camel-case", "camel"];
const upperUnderscoreValue: [string, NamingStyle] = ["upper-underscore-case", "upper-underscore"];
const pascalUpperAcronymsValue: [string, NamingStyle] = ["pascal-case-upper-acronyms", "pascal-upper-acronyms"];
const camelUpperAcronymsValue: [string, NamingStyle] = ["camel-case-upper-acronyms", "camel-upper-acronyms"];

export const cPlusPlusOptions = {
    typeSourceStyle: new EnumOption(
        "source-style",
        "Source code generation type,  whether to generate single or multiple source files",
        [
            ["single-source", true],
            ["multi-source", false]
        ],
        "single-source",
        "secondary"
    ),
    includeLocation: new EnumOption(
        "include-location",
        "Whether json.hpp is to be located globally or locally",
        [
            ["local-include", true],
            ["global-include", false]
        ],
        "local-include",
        "secondary"
    ),
    codeFormat: new EnumOption(
        "code-format",
        "Generate classes with getters/setters, instead of structs",
        [
            ["with-struct", false],
            ["with-getter-setter", true]
        ],
        "with-getter-setter"
    ),
    wstring: new EnumOption(
        "wstring",
        "Store strings using Utf-16 std::wstring, rather than Utf-8 std::string",
        [
            ["use-string", false],
            ["use-wstring", true]
        ],
        "use-string"
    ),
    westConst: new EnumOption(
        "const-style",
        "Put const to the left/west (const T) or right/east (T const)",
        [
            ["west-const", true],
            ["east-const", false]
        ],
        "west-const"
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption("namespace", "Name of the generated namespace(s)", "NAME", "quicktype"),
    enumType: new StringOption("enum-type", "Type of enum class", "NAME", "int", "secondary"),
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
    ]),
    boost: new BooleanOption("boost", "Require a dependency on boost. Without boost, C++17 is required", true),
    hideNullOptional: new BooleanOption("hide-null-optional", "Hide null value for optional field", false)
};

export class CPlusPlusTargetLanguage extends TargetLanguage {
    constructor(displayName = "C++", names: string[] = ["c++", "cpp", "cplusplus"], extension = "cpp") {
        super(displayName, names, extension);
    }

    protected getOptions(): Option<any>[] {
        return [
            cPlusPlusOptions.justTypes,
            cPlusPlusOptions.namespace,
            cPlusPlusOptions.codeFormat,
            cPlusPlusOptions.wstring,
            cPlusPlusOptions.westConst,
            cPlusPlusOptions.typeSourceStyle,
            cPlusPlusOptions.includeLocation,
            cPlusPlusOptions.typeNamingStyle,
            cPlusPlusOptions.memberNamingStyle,
            cPlusPlusOptions.enumeratorNamingStyle,
            cPlusPlusOptions.enumType,
            cPlusPlusOptions.boost,
            cPlusPlusOptions.hideNullOptional
        ];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): CPlusPlusRenderer {
        return new CPlusPlusRenderer(this, renderContext, getOptionValues(cPlusPlusOptions, untypedOptionValues));
    }
}

function constraintsForType(t: Type):
    | {
          minMax?: MinMaxConstraint;
          minMaxLength?: MinMaxConstraint;
          pattern?: string;
      }
    | undefined {
    const minMax = minMaxValueForType(t);
    const minMaxLength = minMaxLengthForType(t);
    const pattern = patternForType(t);
    if (minMax === undefined && minMaxLength === undefined && pattern === undefined) return undefined;
    return { minMax, minMaxLength, pattern };
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

/// Type to use as an optional if cycle breaking is required
const optionalAsSharedType = "std::shared_ptr";
/// Factory to use when creating an optional if cycle breaking is required
const optionalFactoryAsSharedType = "std::make_shared";

/**
 * To be able to support circles in multiple files -
 * e.g. class#A using class#B using class#A (obviously not directly,
 * but in vector or in variant) we can forward declare them;
 */
export enum IncludeKind {
    ForwardDeclare,
    Include
}

export enum GlobalNames {
    ClassMemberConstraints,
    ClassMemberConstraintException,
    ValueTooLowException,
    ValueTooHighException,
    ValueTooShortException,
    ValueTooLongException,
    InvalidPatternException,
    CheckConstraint
}

export enum MemberNames {
    MinIntValue,
    GetMinIntValue,
    SetMinIntValue,
    MaxIntValue,
    GetMaxIntValue,
    SetMaxIntValue,
    MinDoubleValue,
    GetMinDoubleValue,
    SetMinDoubleValue,
    MaxDoubleValue,
    GetMaxDoubleValue,
    SetMaxDoubleValue,
    MinLength,
    GetMinLength,
    SetMinLength,
    MaxLength,
    GetMaxLength,
    SetMaxLength,
    Pattern,
    GetPattern,
    SetPattern
}

type ConstraintMember = {
    name: MemberNames;
    getter: MemberNames;
    setter: MemberNames;
    cppType: string;
    cppConstType?: string;
};

export type IncludeRecord = {
    kind: IncludeKind | undefined /** How to include that */;
    typeKind: TypeKind | undefined /** What exactly to include */;
};

export type TypeRecord = {
    name: Name;
    type: Type;
    level: number;
    variant: boolean;
    forceInclude: boolean;
};

/**
 * We map each and every unique type to a include kind, e.g. how
 * to include the given type
 */
export type IncludeMap = Map<string, IncludeRecord>;

export type TypeContext = {
    needsForwardIndirection: boolean;
    needsOptionalIndirection: boolean;
    inJsonNamespace: boolean;
};

interface StringType {
    getType(): string;
    getConstType(): string;
    getSMatch(): string;
    getRegex(): string;
    createStringLiteral(inner: Sourcelike): Sourcelike;
    wrapToString(inner: Sourcelike): Sourcelike;
    wrapEncodingChange(
        qualifier: Sourcelike[],
        fromType: Sourcelike,
        toType: Sourcelike,
        inner: Sourcelike
    ): Sourcelike;
    emitHelperFunctions(): void;
}

function addQualifier(qualifier: Sourcelike, qualified: Sourcelike[]): Sourcelike[] {
    if (qualified.length === 0) {
        return [];
    }
    return [qualifier, qualified];
}

class WrappingCode {
    constructor(private readonly start: Sourcelike[], private readonly end: Sourcelike[]) {}

    wrap(qualifier: Sourcelike, inner: Sourcelike): Sourcelike {
        return [addQualifier(qualifier, this.start), inner, this.end];
    }
}

class BaseString {
    public _stringType: string;
    public _constStringType: string;
    public _smatch: string;
    public _regex: string;
    public _stringLiteralPrefix: string;
    public _toString: WrappingCode;
    public _encodingClass: Sourcelike;
    public _encodingFunction: Sourcelike;

    constructor(
        stringType: string,
        constStringType: string,
        smatch: string,
        regex: string,
        stringLiteralPrefix: string,
        toString: WrappingCode,
        encodingClass: string,
        encodingFunction: string
    ) {
        this._stringType = stringType;
        this._constStringType = constStringType;
        this._smatch = smatch;
        this._regex = regex;
        this._stringLiteralPrefix = stringLiteralPrefix;
        this._toString = toString;
        this._encodingClass = encodingClass;
        this._encodingFunction = encodingFunction;
    }

    public getType(): string {
        return this._stringType;
    }

    public getConstType(): string {
        return this._constStringType;
    }

    public getSMatch(): string {
        return this._smatch;
    }

    public getRegex(): string {
        return this._regex;
    }

    public createStringLiteral(inner: Sourcelike): Sourcelike {
        return [this._stringLiteralPrefix, '"', inner, '"'];
    }

    public wrapToString(inner: Sourcelike): Sourcelike {
        return this._toString.wrap([], inner);
    }
}

export class CPlusPlusRenderer extends ConvenienceRenderer {
    /**
     * For forward declaration practically
     */
    private readonly _enumType: string;

    private readonly _generatedFiles: Set<string>;
    private _currentFilename: string | undefined;
    private _allTypeNames: Set<string>;
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name, Name]>();
    private readonly _namespaceNames: ReadonlyArray<string>;
    private readonly _memberNameStyle: NameStyle;
    private readonly _namedTypeNameStyle: NameStyle;
    private readonly _generatedGlobalNames: Map<GlobalNames, string>;
    private readonly _generatedMemberNames: Map<MemberNames, string>;
    private readonly _forbiddenGlobalNames: string[];
    private readonly _memberNamingFunction: Namer;
    private readonly _stringType: StringType;
    /// The type to use as an optional  (std::optional or std::shared)
    private readonly _optionalType: string;
    private readonly _optionalFactory: string;
    private readonly _nulloptType: string;
    private readonly _variantType: string;
    private readonly _variantIndexMethodName: string;

    protected readonly typeNamingStyle: NamingStyle;
    protected readonly enumeratorNamingStyle: NamingStyle;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof cPlusPlusOptions>
    ) {
        super(targetLanguage, renderContext);

        this._enumType = _options.enumType;
        this._namespaceNames = _options.namespace.split("::");

        this.typeNamingStyle = _options.typeNamingStyle;
        this._namedTypeNameStyle = makeNameStyle(this.typeNamingStyle, legalizeName);
        this.enumeratorNamingStyle = _options.enumeratorNamingStyle;

        this._memberNameStyle = makeNameStyle(_options.memberNamingStyle, legalizeName);
        this._memberNamingFunction = funPrefixNamer("members", this._memberNameStyle);
        this._gettersAndSettersForPropertyName = new Map();

        this._allTypeNames = new Set<string>();
        this._generatedFiles = new Set<string>();
        this._generatedGlobalNames = new Map();
        this._generatedMemberNames = new Map();
        this._forbiddenGlobalNames = [];

        if (_options.wstring) {
            this._stringType = this.WideString;
        } else {
            this._stringType = this.NarrowString;
        }

        if (_options.boost) {
            this._optionalType = "boost::optional";
            this._optionalFactory = "boost::optional";
            this._nulloptType = "boost::none";
            this._variantType = "boost::variant";
            this._variantIndexMethodName = "which";
        } else {
            this._optionalType = "std::optional";
            this._optionalFactory = "std::make_optional";
            this._nulloptType = "std::nullopt";
            this._variantType = "std::variant";
            this._variantIndexMethodName = "index";
        }

        this.setupGlobalNames();
    }

    // union typeguard
    isUnion(t: Type | UnionType): t is UnionType {
        return t.kind === "union";
    }

    // Returns true if the type can be stored in
    // a stack based optional type. This requires
    // that the type does not require forward declaration.
    isOptionalAsValuePossible(t: Type): boolean {
        if (this.isForwardDeclaredType(t)) return false;

        if (this.isUnion(t)) {
            // There is something stinky about this test.
            // There is special handling somewhere that if you
            // have the following schema
            // {
            //     "$schema": "http://json-schema.org/draft-06/schema#",
            //     "$ref": "#/definitions/List",
            //     "definitions": {
            //         "List": {
            //             "type": "object",
            //             "additionalProperties": false,
            //             "properties": {
            //                 "data": {
            //                     "type": "string"
            //                 },
            //                 "next": {
            //                     "anyOf": [
            //                         {
            //                             "$ref": "#/definitions/List"
            //                         }
            //                         {
            //                             "type": "null"
            //                         }
            //                     ]
            //                 }
            //             },
            //             "required": [],
            //             "title": "List"
            //         }
            //     }
            // }
            // Then a variant is not output but the single item inlined
            //
            //     struct TopLevel {
            //       std::optional<std::string> data;
            //       std::optional<TopLevel> next;
            //     };
            //
            // instead of
            //     struct TopLevel {
            //       std::optional<std::string> data;
            //       std::shared_ptr<TopLevel> next;
            //     };
            //
            // checking to see if the collapse of the variant has
            // occured and then doing the isCycleBreakerType check
            // on the single type the variant would contain seems
            // to solve the problem. But does this point to a problem
            // with the core library or with the CPlusPlus package
            const [, nonNulls] = removeNullFromUnion(t);
            if (nonNulls.size === 1) {
                const tt = defined(iterableFirst(nonNulls));
                return !this.isCycleBreakerType(tt);
            }
        }
        return !this.isCycleBreakerType(t);
    }

    isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    // Is likely to return std::optional or boost::optional
    optionalTypeStack(): string {
        return this._optionalType;
    }

    // Is likely to return std::make_optional or boost::optional
    optionalFactoryStack(): string {
        return this._optionalFactory;
    }

    // Is likely to return std::shared_ptr
    optionalTypeHeap(): string {
        return optionalAsSharedType;
    }

    // Is likely to return std::make_shared
    optionalFactoryHeap(): string {
        return optionalFactoryAsSharedType;
    }

    // Returns the optional type most suitable for the given type.
    // Classes that don't require forward declarations can be stored
    // in std::optional ( or boost::optional )
    optionalType(t: Type): string {
        if (this.isOptionalAsValuePossible(t)) return this.optionalTypeStack();
        else return this.optionalTypeHeap();
    }

    // Returns a label that can be used to distinguish between
    // heap and stack based optional handling methods
    optionalTypeLabel(t: Type): string {
        if (this.isOptionalAsValuePossible(t)) return "stack";
        else return "heap";
    }

    protected getConstraintMembers(): ConstraintMember[] {
        return [
            {
                name: MemberNames.MinIntValue,
                getter: MemberNames.GetMinIntValue,
                setter: MemberNames.SetMinIntValue,
                cppType: "int64_t"
            },
            {
                name: MemberNames.MaxIntValue,
                getter: MemberNames.GetMaxIntValue,
                setter: MemberNames.SetMaxIntValue,
                cppType: "int64_t"
            },
            {
                name: MemberNames.MinDoubleValue,
                getter: MemberNames.GetMinDoubleValue,
                setter: MemberNames.SetMinDoubleValue,
                cppType: "double"
            },
            {
                name: MemberNames.MaxDoubleValue,
                getter: MemberNames.GetMaxDoubleValue,
                setter: MemberNames.SetMaxDoubleValue,
                cppType: "double"
            },
            {
                name: MemberNames.MinLength,
                getter: MemberNames.GetMinLength,
                setter: MemberNames.SetMinLength,
                cppType: "size_t"
            },
            {
                name: MemberNames.MaxLength,
                getter: MemberNames.GetMaxLength,
                setter: MemberNames.SetMaxLength,
                cppType: "size_t"
            },
            {
                name: MemberNames.Pattern,
                getter: MemberNames.GetPattern,
                setter: MemberNames.SetPattern,
                cppType: this._stringType.getType(),
                cppConstType: this._stringType.getConstType()
            }
        ];
    }

    protected lookupGlobalName(type: GlobalNames): string {
        return defined(this._generatedGlobalNames.get(type));
    }

    protected lookupMemberName(type: MemberNames): string {
        return defined(this._generatedMemberNames.get(type));
    }

    protected addGlobalName(type: GlobalNames): void {
        const genName = this._namedTypeNameStyle(GlobalNames[type]);
        this._generatedGlobalNames.set(type, genName);
        this._forbiddenGlobalNames.push(genName);
    }

    protected addMemberName(type: MemberNames): void {
        this._generatedMemberNames.set(type, this._memberNameStyle(MemberNames[type]));
    }

    protected setupGlobalNames(): void {
        for (const v of numberEnumValues(GlobalNames)) {
            this.addGlobalName(v);
        }
        for (const v of numberEnumValues(MemberNames)) {
            this.addMemberName(v);
        }
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [...keywords, ...this._forbiddenGlobalNames];
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", this._namedTypeNameStyle);
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
        const mutableGetterName = new DependencyName(
            this._memberNamingFunction,
            name.order,
            lookup => `getMutable_${lookup(name)}`
        );
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

    protected withConst(s: Sourcelike): Sourcelike {
        if (this._options.westConst) {
            return ["const ", s];
        } else {
            return [s, " const"];
        }
    }

    protected emitInclude(global: boolean, name: Sourcelike): void {
        this.emitLine("#include ", global ? "<" : '"', name, global ? ">" : '"');
    }

    protected startFile(basename: Sourcelike, includeHelper = true): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        if (basename !== undefined) {
            this._currentFilename = this.sourcelikeToString(basename);
        }

        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitCommentLines([" To parse this JSON data, first install", ""]);
            if (this._options.boost) {
                this.emitCommentLines(["     Boost     http://www.boost.org"]);
            }
            this.emitCommentLines([
                "     json.hpp  https://github.com/nlohmann/json",
                "",
                " Then include this file, and then do",
                ""
            ]);

            if (this._options.typeSourceStyle) {
                this.forEachTopLevel("none", (_, topLevelName) => {
                    this.emitLine("//     ", topLevelName, " data = nlohmann::json::parse(jsonString);");
                });
            } else {
                this.emitLine("//     ", basename, " data = nlohmann::json::parse(jsonString);");
            }
            if (this._options.wstring) {
                this.emitLine("//");
                this.emitLine("//  You can get std::wstring data back out using");
                this.emitLine("//");
                this.forEachTopLevel("none", (_, topLevelName) => {
                    this.emitLine("//     std::wcout << ", "wdump((nlohmann::json) ", topLevelName, ");");
                });
            }
        }
        this.ensureBlankLine();

        this.emitLine("#pragma once");
        this.ensureBlankLine();

        if (this.haveOptionalProperties) {
            if (this._options.boost) {
                this.emitInclude(true, "boost/optional.hpp");
            } else {
                this.emitInclude(true, "optional");
            }
        }
        if (this.haveNamedUnions) {
            if (this._options.boost) {
                this.emitInclude(true, "boost/variant.hpp");
            } else {
                this.emitInclude(true, "variant");
            }
        }
        if (!this._options.justTypes) {
            if (!this._options.includeLocation) {
                this.emitInclude(true, "nlohmann/json.hpp");
            } else {
                this.emitInclude(false, "json.hpp");
            }

            if (includeHelper && !this._options.typeSourceStyle) {
                this.emitInclude(false, "helper.hpp");
            }
        }
        this.ensureBlankLine();
    }

    protected finishFile(): void {
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

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, withSemicolon: boolean, f: () => void, withIndent = true): void {
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

    protected cppTypeInOptional(
        nonNulls: ReadonlySet<Type>,
        ctx: TypeContext,
        withIssues: boolean,
        forceNarrowString: boolean
    ): Sourcelike {
        if (nonNulls.size === 1) {
            return this.cppType(defined(iterableFirst(nonNulls)), ctx, withIssues, forceNarrowString, false);
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
                    withIssues,
                    false,
                    false
                )
            );
        }
        return [this._variantType, "<", typeList, ">"];
    }

    protected variantType(u: UnionType, inJsonNamespace: boolean): Sourcelike {
        const [maybeNull, nonNulls] = removeNullFromUnion(u, true);
        assert(nonNulls.size >= 2, "Variant not needed for less than two types.");
        const indirection = maybeNull !== null;
        const variant = this.cppTypeInOptional(
            nonNulls,
            {
                needsForwardIndirection: !indirection,
                needsOptionalIndirection: !indirection,
                inJsonNamespace
            },
            true,
            false
        );
        if (!indirection) {
            return variant;
        }
        return [this.optionalType(u), "<", variant, ">"];
    }

    protected ourQualifier(inJsonNamespace: boolean): Sourcelike {
        return inJsonNamespace ? [arrayIntercalate("::", this._namespaceNames), "::"] : [];
    }

    protected jsonQualifier(inJsonNamespace: boolean): Sourcelike {
        return inJsonNamespace ? [] : "nlohmann::";
    }

    protected variantIndirection(type: Type, needIndirection: boolean, typeSrc: Sourcelike): Sourcelike {
        if (!needIndirection) return typeSrc;
        return [this.optionalType(type), "<", typeSrc, ">"];
    }

    protected cppType(
        t: Type,
        ctx: TypeContext,
        withIssues: boolean,
        forceNarrowString: boolean,
        isOptional: boolean
    ): Sourcelike {
        const inJsonNamespace = ctx.inJsonNamespace;
        if (isOptional && t instanceof UnionType) {
            // avoid have optionalType<optionalType<Type>>
            for (const tChild of t.getChildren()) {
                if (tChild.isNullable) {
                    isOptional = false;
                    break;
                }
            }
        }
        const typeSource = matchType<Sourcelike>(
            t,
            _anyType => {
                isOptional = false;
                return maybeAnnotated(withIssues, anyTypeIssueAnnotation, [
                    this.jsonQualifier(inJsonNamespace),
                    "json"
                ]);
            },
            _nullType => {
                isOptional = false;
                return maybeAnnotated(withIssues, nullTypeIssueAnnotation, [
                    this.jsonQualifier(inJsonNamespace),
                    "json"
                ]);
            },
            _boolType => "bool",
            _integerType => "int64_t",
            _doubleType => "double",
            _stringType => {
                if (forceNarrowString) {
                    return "std::string";
                } else {
                    return this._stringType.getType();
                }
            },
            arrayType => [
                "std::vector<",
                this.cppType(
                    arrayType.items,
                    {
                        needsForwardIndirection: false,
                        needsOptionalIndirection: true,
                        inJsonNamespace
                    },
                    withIssues,
                    forceNarrowString,
                    false
                ),
                ">"
            ],
            classType =>
                this.variantIndirection(
                    classType,
                    ctx.needsForwardIndirection && this.isForwardDeclaredType(classType) && !isOptional,
                    [this.ourQualifier(inJsonNamespace), this.nameForNamedType(classType)]
                ),
            mapType => {
                let keyType = this._stringType.getType();
                if (forceNarrowString) {
                    keyType = "std::string";
                }
                return [
                    "std::map<",
                    keyType,
                    ", ",
                    this.cppType(
                        mapType.values,
                        {
                            needsForwardIndirection: false,
                            needsOptionalIndirection: true,
                            inJsonNamespace
                        },
                        withIssues,
                        forceNarrowString,
                        false
                    ),
                    ">"
                ];
            },
            enumType => [this.ourQualifier(inJsonNamespace), this.nameForNamedType(enumType)],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    isOptional = true;
                    return this.cppType(
                        nullable,
                        {
                            needsForwardIndirection: false,
                            needsOptionalIndirection: false,
                            inJsonNamespace
                        },
                        withIssues,
                        forceNarrowString,
                        false
                    );
                } else {
                    return [this.ourQualifier(inJsonNamespace), this.nameForNamedType(unionType)];
                }
            }
        );
        if (!isOptional) return typeSource;
        return [this.optionalType(t), "<", typeSource, ">"];
    }

    /**
     * similar to cppType, it practically gathers all the generated types within
     * 't'. It also records, whether a given sub-type is part of a variant or not.
     */
    protected generatedTypes(isClassMember: boolean, theType: Type): TypeRecord[] {
        const result: TypeRecord[] = [];
        const recur = (forceInclude: boolean, isVariant: boolean, l: number, t: Type) => {
            if (t instanceof ArrayType) {
                recur(forceInclude, isVariant, l + 1, t.items);
            } else if (t instanceof ClassType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude
                });
            } else if (t instanceof MapType) {
                recur(forceInclude, isVariant, l + 1, t.values);
            } else if (t instanceof EnumType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude: false
                });
            } else if (t instanceof UnionType) {
                /**
                 * If we have a union as a class member and we see it as a "named union",
                 * we can safely include it as-is.
                 * HOWEVER if we define a union on its own, we must recurse into the
                 * typedefinition and include all subtypes.
                 */
                if (this.unionNeedsName(t) && isClassMember) {
                    /**
                     * This is NOT ENOUGH.
                     * We have a variant member in a class, e.g. defined with a boost::variant.
                     * The compiler can only compile the class if IT KNOWS THE SIZES
                     * OF ALL MEMBERS OF THE VARIANT.
                     * So it means that you must include ALL SUBTYPES (practically classes only)
                     * AS WELL
                     */
                    forceInclude = true;
                    result.push({
                        name: this.nameForNamedType(t),
                        type: t,
                        level: l,
                        variant: true,
                        forceInclude
                    });
                    /** intentional "fall-through", add all subtypes as well - but forced include */
                }

                const [hasNull, nonNulls] = removeNullFromUnion(t);
                isVariant = hasNull !== null;
                /** we need to collect all the subtypes of the union */
                for (const tt of nonNulls) {
                    recur(forceInclude, isVariant, l + 1, tt);
                }
            }
        };
        recur(false, false, 0, theType);
        return result;
    }

    protected constraintMember(jsonName: string): string {
        return this._memberNameStyle(`${jsonName}Constraint`);
    }

    protected emitMember(cppType: Sourcelike, name: Sourcelike): void {
        this.emitLine(cppType, " ", name, ";");
    }

    protected emitClassMembers(c: ClassType, constraints: Map<string, Sourcelike> | undefined): void {
        if (this._options.codeFormat) {
            this.emitLine("private:");

            this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                this.emitMember(
                    this.cppType(
                        property.type,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: false
                        },
                        true,
                        false,
                        property.isOptional
                    ),
                    name
                );
                if (constraints?.has(jsonName)) {
                    /** FIXME!!! NameStyle will/can collide with other Names */
                    const cnst = this.lookupGlobalName(GlobalNames.ClassMemberConstraints);
                    this.emitMember(cnst, this.constraintMember(jsonName));
                }
            });

            this.ensureBlankLine();
            this.emitLine("public:");
        }

        this.forEachClassProperty(c, "none", (name, jsonName, property) => {
            this.emitDescription(this.descriptionForClassProperty(c, jsonName));
            if (!this._options.codeFormat) {
                this.emitMember(
                    this.cppType(
                        property.type,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: false
                        },
                        true,
                        false,
                        property.isOptional
                    ),
                    name
                );
            } else {
                const [getterName, mutableGetterName, setterName] = defined(
                    this._gettersAndSettersForPropertyName.get(name)
                );
                const rendered = this.cppType(
                    property.type,
                    {
                        needsForwardIndirection: true,
                        needsOptionalIndirection: true,
                        inJsonNamespace: false
                    },
                    true,
                    false,
                    property.isOptional
                );

                /**
                 * fix for optional type -> e.g. unique_ptrs can't be copied
                 * One might as why the "this->xxx = value". Simple if we have
                 * a member called 'value' value = value will screw up the compiler
                 */
                const checkConst = this.lookupGlobalName(GlobalNames.CheckConstraint);
                if (
                    (property.type instanceof UnionType && property.type.findMember("null") !== undefined) ||
                    (property.isOptional && property.type.kind !== "null" && property.type.kind !== "any")
                ) {
                    this.emitLine(rendered, " ", getterName, "() const { return ", name, "; }");
                    if (constraints?.has(jsonName)) {
                        this.emitLine(
                            "void ",
                            setterName,
                            "(",
                            rendered,
                            " value) { if (value) ",
                            checkConst,
                            "(",
                            this._stringType.createStringLiteral([name]),
                            ", ",
                            this.constraintMember(jsonName),
                            ", *value); this->",
                            name,
                            " = value; }"
                        );
                    } else {
                        this.emitLine("void ", setterName, "(", rendered, " value) { this->", name, " = value; }");
                    }
                } else {
                    this.emitLine(this.withConst(rendered), " & ", getterName, "() const { return ", name, "; }");
                    this.emitLine(rendered, " & ", mutableGetterName, "() { return ", name, "; }");
                    if (constraints?.has(jsonName)) {
                        this.emitLine(
                            "void ",
                            setterName,
                            "(",
                            this.withConst(rendered),
                            " & value) { ",
                            checkConst,
                            "(",
                            this._stringType.createStringLiteral([name]),
                            ", ",
                            this.constraintMember(jsonName),
                            ", value); this->",
                            name,
                            " = value; }"
                        );
                    } else {
                        this.emitLine(
                            "void ",
                            setterName,
                            "(",
                            this.withConst(rendered),
                            " & value) { this->",
                            name,
                            " = value; }"
                        );
                    }
                }
                this.ensureBlankLine();
            }
        });
    }

    protected generateClassConstraints(c: ClassType): Map<string, Sourcelike> | undefined {
        const res: Map<string, Sourcelike> = new Map<string, Sourcelike>();
        this.forEachClassProperty(c, "none", (_name, jsonName, property) => {
            const constraints = constraintsForType(property.type);
            if (constraints === undefined) return;
            const { minMax, minMaxLength, pattern } = constraints;

            // TODO is there a better way to check if property.type is an interger or a number?
            const cppType = this.cppType(
                property.type,
                {
                    needsForwardIndirection: true,
                    needsOptionalIndirection: true,
                    inJsonNamespace: false
                },
                true,
                false,
                property.isOptional
            );

            res.set(jsonName, [
                this.constraintMember(jsonName),
                "(",
                minMax?.[0] && cppType === "int64_t" ? String(minMax[0]) : this._nulloptType,
                ", ",
                minMax?.[1] && cppType === "int64_t" ? String(minMax[1]) : this._nulloptType,
                ", ",
                minMax?.[0] && cppType === "double" ? String(minMax[0]) : this._nulloptType,
                ", ",
                minMax?.[1] && cppType === "double" ? String(minMax[1]) : this._nulloptType,
                ", ",
                minMaxLength?.[0] ? String(minMaxLength[0]) : this._nulloptType,
                ", ",
                minMaxLength?.[1] ? String(minMaxLength[1]) : this._nulloptType,
                ", ",
                pattern === undefined
                    ? this._nulloptType
                    : [
                          this._stringType.getType(),
                          "(",
                          this._stringType.createStringLiteral([stringEscape(pattern)]),
                          ")"
                      ],
                ")"
            ]);
        });

        return res.size === 0 ? undefined : res;
    }

    protected emitClass(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock([this._options.codeFormat ? "class " : "struct ", className], true, () => {
            const constraints = this.generateClassConstraints(c);
            if (this._options.codeFormat) {
                this.emitLine("public:");
                if (constraints === undefined) {
                    this.emitLine(className, "() = default;");
                } else {
                    this.emitLine(className, "() :");
                    let numEmits = 0;
                    constraints.forEach((initializer: Sourcelike, _propName: string) => {
                        numEmits++;
                        this.indent(() => {
                            if (numEmits === constraints.size) {
                                this.emitLine(initializer);
                            } else {
                                this.emitLine(initializer, ",");
                            }
                        });
                    });
                    this.emitLine("{}");
                }

                this.emitLine("virtual ~", className, "() = default;");
                this.ensureBlankLine();
            }

            this.emitClassMembers(c, constraints);
        });
    }

    protected emitTopLevelHeaders(t: Type, className: Name): void {
        // Forward declarations for std::map<std::wstring, Key> (need to convert UTF16 <-> UTF8)
        if (t instanceof MapType && this._stringType !== this.NarrowString) {
            const ourQualifier = this.ourQualifier(true);

            this.emitBlock(["struct adl_serializer<", ourQualifier, className, ">"], true, () => {
                this.emitLine("template <>");
                this.emitLine(
                    "static void from_json(",
                    this.withConst("json"),
                    " & j, ",
                    ourQualifier,
                    className,
                    " & x);"
                );
                this.emitLine("static void to_json(json & j, ", this.withConst([ourQualifier, className]), " & x);");
            });
        }
    }

    protected emitClassHeaders(className: Name): void {
        const ourQualifier = this.ourQualifier(false);

        this.emitLine("void from_json(", this.withConst("json"), " & j, ", ourQualifier, className, " & x);");
        this.emitLine("void to_json(json & j, ", this.withConst([ourQualifier, className]), " & x);");
    }

    protected emitTopLevelFunction(t: Type, className: Name): void {
        // Function definitions for std::map<std::wstring, Key> (need to convert UTF16 <-> UTF8)
        if (t instanceof MapType && this._stringType !== this.NarrowString) {
            const ourQualifier = this.ourQualifier(true);
            let cppType: Sourcelike;
            let toType: Sourcelike;

            this.emitBlock(
                [
                    "inline void adl_serializer<",
                    ourQualifier,
                    className,
                    ">::from_json(",
                    this.withConst("json"),
                    " & j, ",
                    ourQualifier,
                    className,
                    "& x)"
                ],
                false,
                () => {
                    cppType = this.cppType(
                        t,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: true
                        },
                        false,
                        true,
                        false
                    );
                    toType = this.cppType(
                        t,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: true
                        },
                        false,
                        false,
                        false
                    );

                    this.emitLine([
                        "x = ",
                        this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, [
                            "j.get<",
                            cppType,
                            ">()"
                        ]),
                        ";"
                    ]);
                }
            );

            this.emitBlock(
                [
                    "inline void adl_serializer<",
                    ourQualifier,
                    className,
                    ">::to_json(json & j, ",
                    this.withConst([ourQualifier, className]),
                    " & x)"
                ],
                false,
                () => {
                    cppType = this.cppType(
                        t,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: true
                        },
                        false,
                        false,
                        false
                    );
                    toType = this.cppType(
                        t,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: true
                        },
                        false,
                        true,
                        false
                    );

                    this.emitLine([
                        "j = ",
                        this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, "x"),
                        ";"
                    ]);
                }
            );
        }
    }

    protected emitClassFunctions(c: ClassType, className: Name): void {
        const ourQualifier = this.ourQualifier(false);
        let cppType: Sourcelike;
        let toType: Sourcelike;

        this.emitBlock(
            ["inline void from_json(", this.withConst("json"), " & j, ", ourQualifier, className, "& x)"],
            false,
            () => {
                this.forEachClassProperty(c, "none", (name, json, p) => {
                    const [, , setterName] = defined(this._gettersAndSettersForPropertyName.get(name));
                    const propType = p.type;

                    let assignment: WrappingCode;
                    if (this._options.codeFormat) {
                        assignment = new WrappingCode(["x.", setterName, "("], [")"]);
                    } else {
                        assignment = new WrappingCode(["x.", name, " = "], []);
                    }

                    if (propType.kind === "null" || propType.kind === "any") {
                        this.emitLine(
                            assignment.wrap(
                                [],
                                [
                                    ourQualifier,
                                    "get_untyped(j, ",
                                    this._stringType.wrapEncodingChange(
                                        [ourQualifier],
                                        this._stringType.getType(),
                                        this.NarrowString.getType(),
                                        [this._stringType.createStringLiteral([stringEscape(json)])]
                                    ),
                                    ")"
                                ]
                            ),
                            ";"
                        );
                        return;
                    }
                    if (p.isOptional || propType instanceof UnionType) {
                        const [nullOrOptional, typeSet] = (function (): [boolean, ReadonlySet<Type>] {
                            if (propType instanceof UnionType) {
                                const [maybeNull, nonNulls] = removeNullFromUnion(propType, true);
                                return [maybeNull !== null || p.isOptional, nonNulls];
                            } else {
                                const set = new Set<Type>();
                                set.add(propType);
                                return [true, set];
                            }
                        })();
                        if (nullOrOptional) {
                            cppType = this.cppTypeInOptional(
                                typeSet,
                                {
                                    needsForwardIndirection: false,
                                    needsOptionalIndirection: false,
                                    inJsonNamespace: false
                                },
                                false,
                                true
                            );
                            toType = this.cppTypeInOptional(
                                typeSet,
                                {
                                    needsForwardIndirection: false,
                                    needsOptionalIndirection: false,
                                    inJsonNamespace: false
                                },
                                false,
                                false
                            );
                            this.emitLine(
                                assignment.wrap(
                                    [],
                                    [
                                        this._stringType.wrapEncodingChange(
                                            [ourQualifier],
                                            [this.optionalType(propType), "<", cppType, ">"],
                                            [this.optionalType(propType), "<", toType, ">"],
                                            [
                                                ourQualifier,
                                                `get_${this.optionalTypeLabel(propType)}_optional<`,
                                                cppType,
                                                ">(j, ",
                                                this._stringType.wrapEncodingChange(
                                                    [ourQualifier],
                                                    this._stringType.getType(),
                                                    this.NarrowString.getType(),
                                                    [this._stringType.createStringLiteral([stringEscape(json)])]
                                                ),
                                                ")"
                                            ]
                                        )
                                    ]
                                ),
                                ";"
                            );
                            return;
                        }
                    }
                    cppType = this.cppType(
                        propType,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: false
                        },
                        false,
                        true,
                        p.isOptional
                    );
                    toType = this.cppType(
                        propType,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: false
                        },
                        false,
                        false,
                        p.isOptional
                    );
                    this.emitLine(
                        assignment.wrap(
                            [],
                            this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, [
                                "j.at(",
                                this._stringType.wrapEncodingChange(
                                    [ourQualifier],
                                    this._stringType.getType(),
                                    this.NarrowString.getType(),
                                    this._stringType.createStringLiteral([stringEscape(json)])
                                ),
                                ").get<",
                                cppType,
                                ">()"
                            ])
                        ),
                        ";"
                    );
                });
            }
        );
        this.ensureBlankLine();

        this.emitBlock(
            ["inline void to_json(json & j, ", this.withConst([ourQualifier, className]), " & x)"],
            false,
            () => {
                this.emitLine("j = json::object();");
                this.forEachClassProperty(c, "none", (name, json, p) => {
                    const propType = p.type;
                    cppType = this.cppType(
                        propType,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: false
                        },
                        false,
                        false,
                        p.isOptional
                    );
                    toType = this.cppType(
                        propType,
                        {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: false
                        },
                        false,
                        true,
                        p.isOptional
                    );
                    const [getterName, ,] = defined(this._gettersAndSettersForPropertyName.get(name));
                    let getter: Sourcelike[];
                    if (this._options.codeFormat) {
                        getter = [getterName, "()"];
                    } else {
                        getter = [name];
                    }
                    const assignment: Sourcelike[] = [
                        "j[",
                        this._stringType.wrapEncodingChange(
                            [ourQualifier],
                            this._stringType.getType(),
                            this.NarrowString.getType(),
                            this._stringType.createStringLiteral([stringEscape(json)])
                        ),
                        "] = ",
                        this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, ["x.", getter]),
                        ";"
                    ];
                    if (p.isOptional && this._options.hideNullOptional) {
                        this.emitBlock(
                            [
                                "if (",
                                this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, ["x.", getter]),
                                ")"
                            ],
                            false,
                            () => {
                                this.emitLine(assignment);
                            }
                        );
                    } else {
                        this.emitLine(assignment);
                    }
                });
            }
        );
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        const caseNames: Sourcelike[] = [];
        const enumValues = enumCaseValues(e, this.targetLanguage.name);

        this.forEachEnumCase(e, "none", (name, jsonName) => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);

            if (enumValues !== undefined) {
                const [enumValue] = getAccessorName(enumValues, jsonName);
                if (enumValue !== undefined) {
                    caseNames.push(" = ", enumValue.toString());
                }
            }
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum class ", enumName, " : ", this._enumType, " { ", caseNames, " };");
    }

    protected emitUnionTypedefs(u: UnionType, unionName: Name): void {
        this.emitLine("using ", unionName, " = ", this.variantType(u, false), ";");
    }

    protected emitUnionHeaders(u: UnionType): void {
        // Forward declarations for boost::variant<Ts...>. If none of the Ts were defined by us (e.g. if we have
        // boost::variant<int32_t, std::string>) then we need to specialize nlohmann::adl_serializer for our
        // variant type. If at least one of the Ts is our type then we could get away with regular adl definitions,
        // but it's nontrivial to detect that (consider variant<string, variant<map<string, string>, int>> which
        // does need an adl_serializer specialization) so we'll just specialize every time.

        const nonNulls = removeNullFromUnion(u, true)[1];
        const variantType = this.cppTypeInOptional(
            nonNulls,
            {
                needsForwardIndirection: false,
                needsOptionalIndirection: false,
                inJsonNamespace: true
            },
            false,
            false
        );

        this.emitLine("template <>");
        this.emitBlock(["struct adl_serializer<", variantType, ">"], true, () => {
            this.emitLine("static void from_json(", this.withConst("json"), " & j, ", variantType, " & x);");
            this.emitLine("static void to_json(json & j, ", this.withConst(variantType), " & x);");
        });
    }

    protected emitUnionFunctions(u: UnionType): void {
        // Function definitions for boost::variant<Ts...>.

        const ourQualifier = this.ourQualifier(true) as string;

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
            {
                needsForwardIndirection: false,
                needsOptionalIndirection: false,
                inJsonNamespace: true
            },
            false,
            false
        );

        this.emitBlock(
            [
                "inline void adl_serializer<",
                variantType,
                ">::from_json(",
                this.withConst("json"),
                " & j, ",
                variantType,
                " & x)"
            ],
            false,
            () => {
                let onFirst = true;
                for (const [kind, func] of functionForKind) {
                    const typeForKind = iterableFind(nonNulls, t => t.kind === kind);
                    if (typeForKind === undefined) continue;
                    this.emitLine(onFirst ? "if" : "else if", " (j.", func, "())");
                    this.indent(() => {
                        const cppType = this.cppType(
                            typeForKind,
                            {
                                needsForwardIndirection: true,
                                needsOptionalIndirection: true,
                                inJsonNamespace: true
                            },
                            false,
                            true,
                            false
                        );
                        const toType = this.cppType(
                            typeForKind,
                            {
                                needsForwardIndirection: true,
                                needsOptionalIndirection: true,
                                inJsonNamespace: true
                            },
                            false,
                            false,
                            false
                        );
                        this.emitLine(
                            "x = ",
                            this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, [
                                "j.get<",
                                cppType,
                                ">()"
                            ]),
                            ";"
                        );
                    });
                    onFirst = false;
                }
                this.emitLine('else throw std::runtime_error("Could not deserialise!");');
            }
        );
        this.ensureBlankLine();

        this.emitBlock(
            ["inline void adl_serializer<", variantType, ">::to_json(json & j, ", this.withConst(variantType), " & x)"],
            false,
            () => {
                this.emitBlock(["switch (x.", this._variantIndexMethodName, "())"], false, () => {
                    let i = 0;
                    for (const t of nonNulls) {
                        this.emitLine("case ", i.toString(), ":");
                        this.indent(() => {
                            const cppType = this.cppType(
                                t,
                                {
                                    needsForwardIndirection: true,
                                    needsOptionalIndirection: true,
                                    inJsonNamespace: true
                                },
                                false,
                                false,
                                false
                            );
                            const toType = this.cppType(
                                t,
                                {
                                    needsForwardIndirection: true,
                                    needsOptionalIndirection: true,
                                    inJsonNamespace: true
                                },
                                false,
                                true,
                                false
                            );
                            this.emitLine(
                                "j = ",
                                this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, [
                                    this._options.boost ? "boost::get<" : "std::get<",
                                    cppType,
                                    ">(x)"
                                ]),
                                ";"
                            );
                            this.emitLine("break;");
                        });
                        i++;
                    }
                    this.emitLine('default: throw std::runtime_error("Input JSON does not conform to schema!");');
                });
            }
        );
    }

    protected emitEnumHeaders(enumName: Name): void {
        const ourQualifier = this.ourQualifier(false);

        this.emitLine("void from_json(", this.withConst("json"), " & j, ", ourQualifier, enumName, " & x);");
        this.emitLine("void to_json(json & j, ", this.withConst([ourQualifier, enumName]), " & x);");
    }

    private isLargeEnum(e: EnumType) {
        // This is just an estimation. Someone might want to do some
        // benchmarks to find the optimum value here
        return e.cases.size > 15;
    }

    protected emitEnumFunctions(e: EnumType, enumName: Name): void {
        const ourQualifier = this.ourQualifier(false);

        this.emitBlock(
            ["inline void from_json(", this.withConst("json"), " & j, ", ourQualifier, enumName, " & x)"],
            false,
            () => {
                if (this.isLargeEnum(e)) {
                    this.emitBlock(
                        [
                            "static std::unordered_map<",
                            this._stringType.getType(),
                            ", ",
                            ourQualifier,
                            enumName,
                            "> enumValues"
                        ],
                        true,
                        () => {
                            this.forEachEnumCase(e, "none", (name, jsonName) => {
                                this.emitLine(
                                    "{",
                                    this._stringType.wrapEncodingChange(
                                        [ourQualifier],
                                        this._stringType.getType(),
                                        this.NarrowString.getType(),
                                        [this._stringType.createStringLiteral([stringEscape(jsonName)])]
                                    ),
                                    ", ",
                                    ourQualifier,
                                    enumName,
                                    "::",
                                    name,
                                    "},"
                                );
                            });
                        }
                    );

                    this.emitLine(`auto iter = enumValues.find(j.get<${this._stringType.getType()}>());`);
                    this.emitBlock("if (iter != enumValues.end())", false, () => {
                        this.emitLine("x = iter->second;");
                    });
                } else {
                    let onFirst = true;
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        const maybeElse = onFirst ? "" : "else ";
                        this.emitLine(
                            maybeElse,
                            "if (j == ",
                            this._stringType.wrapEncodingChange(
                                [ourQualifier],
                                this._stringType.getType(),
                                this.NarrowString.getType(),
                                [this._stringType.createStringLiteral([stringEscape(jsonName)])]
                            ),
                            ") x = ",
                            ourQualifier,
                            enumName,
                            "::",
                            name,
                            ";"
                        );
                        onFirst = false;
                    });
                    this.emitLine('else { throw std::runtime_error("Input JSON does not conform to schema!"); }');
                }
            }
        );
        this.ensureBlankLine();

        this.emitBlock(
            ["inline void to_json(json & j, ", this.withConst([ourQualifier, enumName]), " & x)"],
            false,
            () => {
                this.emitBlock("switch (x)", false, () => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        this.emitLine(
                            "case ",
                            ourQualifier,
                            enumName,
                            "::",
                            name,
                            ": j = ",
                            this._stringType.wrapEncodingChange(
                                [ourQualifier],
                                this._stringType.getType(),
                                this.NarrowString.getType(),
                                [this._stringType.createStringLiteral([stringEscape(jsonName)])]
                            ),
                            "; break;"
                        );
                    });
                    this.emitLine(`default: throw std::runtime_error("Unexpected value in enumeration \\"${enumName}\\": " + std::to_string(static_cast<int>(x)));`);
                });
            }
        );
    }

    protected emitTopLevelTypedef(t: Type, name: Name): void {
        this.emitLine(
            "using ",
            name,
            " = ",
            this.cppType(
                t,
                {
                    needsForwardIndirection: true,
                    needsOptionalIndirection: true,
                    inJsonNamespace: false
                },
                true,
                false,
                false
            ),
            ";"
        );
    }

    protected emitAllUnionFunctions(): void {
        this.forEachUniqueUnion(
            "leading-and-interposing",
            u =>
                this.sourcelikeToString(
                    this.cppTypeInOptional(
                        removeNullFromUnion(u, true)[1],
                        {
                            needsForwardIndirection: false,
                            needsOptionalIndirection: false,
                            inJsonNamespace: true
                        },
                        false,
                        false
                    )
                ),
            (u: UnionType) => this.emitUnionFunctions(u)
        );
    }

    protected emitAllUnionHeaders(): void {
        this.forEachUniqueUnion(
            "interposing",
            u =>
                this.sourcelikeToString(
                    this.cppTypeInOptional(
                        removeNullFromUnion(u, true)[1],
                        {
                            needsForwardIndirection: false,
                            needsOptionalIndirection: false,
                            inJsonNamespace: true
                        },
                        false,
                        false
                    )
                ),
            (u: UnionType) => this.emitUnionHeaders(u)
        );
    }

    protected emitOptionalHelpers(): void {
        this.emitLine("#ifndef NLOHMANN_OPT_HELPER");
        this.emitLine("#define NLOHMANN_OPT_HELPER");

        this.emitNamespaces(["nlohmann"], () => {
            const emitAdlStruct = (optType: string, factory: string) => {
                this.emitLine("template <typename T>");
                this.emitBlock(["struct adl_serializer<", optType, "<T>>"], true, () => {
                    this.emitBlock(
                        ["static void to_json(json & j, ", this.withConst([optType, "<T>"]), " & opt)"],
                        false,
                        () => {
                            this.emitLine("if (!opt) j = nullptr; else j = *opt;");
                        }
                    );

                    this.ensureBlankLine();

                    this.emitBlock(
                        ["static ", optType, "<T> from_json(", this.withConst("json"), " & j)"],
                        false,
                        () => {
                            this.emitLine(
                                `if (j.is_null()) return ${factory}<T>(); else return ${factory}<T>(j.get<T>());`
                            );
                        }
                    );
                });
            };
            emitAdlStruct(this.optionalTypeHeap(), this.optionalFactoryHeap());
            emitAdlStruct(this.optionalTypeStack(), this.optionalFactoryStack());
        });

        this.emitLine("#endif");
    }

    protected emitDeclaration(decl: Declaration): void {
        if (decl.kind === "forward") {
            if (this._options.codeFormat) {
                this.emitLine("class ", this.nameForNamedType(decl.type), ";");
            } else {
                this.emitLine("struct ", this.nameForNamedType(decl.type), ";");
            }
        } else if (decl.kind === "define") {
            const type = decl.type;
            const name = this.nameForNamedType(type);
            if (type instanceof ClassType) {
                this.emitClass(type, name);
            } else if (type instanceof EnumType) {
                this.emitEnum(type, name);
            } else if (type instanceof UnionType) {
                this.emitUnionTypedefs(type, name);
            } else {
                panic(`Cannot declare type ${type.kind}`);
            }
        } else {
            assertNever(decl.kind);
        }
    }

    protected emitGetterSetter(t: string, getterName: string, setterName: string, memberName: string): void {
        this.emitLine("void ", setterName, "(", t, " ", memberName, ") { this->", memberName, " = ", memberName, "; }");
        this.emitLine("auto ", getterName, "() const { return ", memberName, "; }");
    }

    protected emitNumericCheckConstraints(
        checkConst: string,
        classConstraint: string,
        getterMinValue: string,
        getterMaxValue: string,
        cppType: string
    ): void {
        this.emitBlock(
            [
                "inline void ",
                checkConst,
                "(",
                this._stringType.getConstType(),
                " name, ",
                this.withConst(classConstraint),
                " & c, ",
                cppType,
                " value)"
            ],
            false,
            () => {
                this.emitBlock(
                    ["if (c.", getterMinValue, "() != ", this._nulloptType, " && value < *c.", getterMinValue, "())"],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooLowException),
                            " (",
                            this._stringType.createStringLiteral(["Value too low for "]),
                            " + name + ",
                            this._stringType.createStringLiteral([" ("]),
                            " + ",
                            this._stringType.wrapToString(["value"]),
                            " + ",
                            this._stringType.createStringLiteral(["<"]),
                            " + ",
                            this._stringType.wrapToString(["*c.", getterMinValue, "()"]),
                            " + ",
                            this._stringType.createStringLiteral([")"]),
                            ");"
                        );
                    }
                );
                this.ensureBlankLine();

                this.emitBlock(
                    ["if (c.", getterMaxValue, "() != ", this._nulloptType, " && value > *c.", getterMaxValue, "())"],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooHighException),
                            " (",
                            this._stringType.createStringLiteral(["Value too high for "]),
                            " + name + ",
                            this._stringType.createStringLiteral([" ("]),
                            " + ",
                            this._stringType.wrapToString(["value"]),
                            " + ",
                            this._stringType.createStringLiteral([">"]),
                            " + ",
                            this._stringType.wrapToString(["*c.", getterMaxValue, "()"]),
                            " + ",
                            this._stringType.createStringLiteral([")"]),
                            ");"
                        );
                    }
                );
                this.ensureBlankLine();
            }
        );
        this.ensureBlankLine();
    }

    protected emitConstraintClasses(): void {
        const ourQualifier = this.ourQualifier(false) as string;

        const getterMinIntValue = this.lookupMemberName(MemberNames.GetMinIntValue);
        const getterMaxIntValue = this.lookupMemberName(MemberNames.GetMaxIntValue);
        const getterMinDoubleValue = this.lookupMemberName(MemberNames.GetMinDoubleValue);
        const getterMaxDoubleValue = this.lookupMemberName(MemberNames.GetMaxDoubleValue);
        const getterMinLength = this.lookupMemberName(MemberNames.GetMinLength);
        const getterMaxLength = this.lookupMemberName(MemberNames.GetMaxLength);
        const getterPattern = this.lookupMemberName(MemberNames.GetPattern);
        const classConstraint = this.lookupGlobalName(GlobalNames.ClassMemberConstraints);

        this.emitBlock(["class ", classConstraint], true, () => {
            this.emitLine("private:");
            const constraintMembers: ConstraintMember[] = this.getConstraintMembers();
            for (const member of constraintMembers) {
                this.emitMember([this._optionalType, "<", member.cppType, ">"], this.lookupMemberName(member.name));
            }
            this.ensureBlankLine();
            this.emitLine("public:");
            this.emitLine(classConstraint, "(");
            this.indent(() => {
                this.iterableForEach(constraintMembers, ({ name, cppType }, pos) => {
                    const comma = pos === "first" || pos === "middle" ? "," : [];
                    this.emitLine(this._optionalType, "<", cppType, "> ", this.lookupMemberName(name), comma);
                });
            });

            const args = constraintMembers.map(({ name }) => {
                const member = this.lookupMemberName(name);
                return [member, "(", member, ")"];
            });
            this.emitLine(") : ", arrayIntercalate([", "], args), " {}");

            this.emitLine(classConstraint, "() = default;");
            this.emitLine("virtual ~", classConstraint, "() = default;");
            for (const member of constraintMembers) {
                this.ensureBlankLine();
                this.emitGetterSetter(
                    withDefault(member.cppConstType, member.cppType),
                    this.lookupMemberName(member.getter),
                    this.lookupMemberName(member.setter),
                    this.lookupMemberName(member.name)
                );
            }
        });
        this.ensureBlankLine();

        const classConstEx = this.lookupGlobalName(GlobalNames.ClassMemberConstraintException);
        this.emitBlock(["class ", classConstEx, " : public std::runtime_error"], true, () => {
            this.emitLine("public:");
            this.emitLine(
                classConstEx,
                "(",
                this._stringType.getConstType(),
                " msg) : std::runtime_error(",
                this._stringType.wrapEncodingChange(
                    [ourQualifier],
                    this._stringType.getType(),
                    this.NarrowString.getType(),
                    ["msg"]
                ),
                ") {}"
            );
        });
        this.ensureBlankLine();

        const exceptions: GlobalNames[] = [
            GlobalNames.ValueTooLowException,
            GlobalNames.ValueTooHighException,
            GlobalNames.ValueTooShortException,
            GlobalNames.ValueTooLongException,
            GlobalNames.InvalidPatternException
        ];

        for (const ex of exceptions) {
            const name = this.lookupGlobalName(ex);
            this.emitBlock(["class ", name, " : public ", classConstEx], true, () => {
                this.emitLine("public:");
                this.emitLine(name, "(", this._stringType.getConstType(), " msg) : ", classConstEx, "(msg) {}");
            });
            this.ensureBlankLine();
        }

        const checkConst = this.lookupGlobalName(GlobalNames.CheckConstraint);
        this.emitNumericCheckConstraints(checkConst, classConstraint, getterMinIntValue, getterMaxIntValue, "int64_t");
        this.emitNumericCheckConstraints(
            checkConst,
            classConstraint,
            getterMinDoubleValue,
            getterMaxDoubleValue,
            "double"
        );

        this.emitBlock(
            [
                "inline void ",
                checkConst,
                "(",
                this._stringType.getConstType(),
                " name, ",
                this.withConst(classConstraint),
                " & c, ",
                this._stringType.getConstType(),
                " value)"
            ],
            false,
            () => {
                this.emitBlock(
                    [
                        "if (c.",
                        getterMinLength,
                        "() != ",
                        this._nulloptType,
                        " && value.length() < *c.",
                        getterMinLength,
                        "())"
                    ],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooShortException),
                            " (",
                            this._stringType.createStringLiteral(["Value too short for "]),
                            " + name + ",
                            this._stringType.createStringLiteral([" ("]),
                            " + ",
                            this._stringType.wrapToString(["value.length()"]),
                            " + ",
                            this._stringType.createStringLiteral(["<"]),
                            " + ",
                            this._stringType.wrapToString(["*c.", getterMinLength, "()"]),
                            " + ",
                            this._stringType.createStringLiteral([")"]),
                            ");"
                        );
                    }
                );
                this.ensureBlankLine();

                this.emitBlock(
                    [
                        "if (c.",
                        getterMaxLength,
                        "() != ",
                        this._nulloptType,
                        " && value.length() > *c.",
                        getterMaxLength,
                        "())"
                    ],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooLongException),
                            " (",
                            this._stringType.createStringLiteral(["Value too long for "]),
                            " + name + ",
                            this._stringType.createStringLiteral([" ("]),
                            " + ",
                            this._stringType.wrapToString(["value.length()"]),
                            " + ",
                            this._stringType.createStringLiteral([">"]),
                            " + ",
                            this._stringType.wrapToString(["*c.", getterMaxLength, "()"]),
                            " + ",
                            this._stringType.createStringLiteral([")"]),
                            ");"
                        );
                    }
                );
                this.ensureBlankLine();

                this.emitBlock(["if (c.", getterPattern, "() != ", this._nulloptType, ")"], false, () => {
                    this.emitLine(this._stringType.getSMatch(), " result;");
                    this.emitLine(
                        "std::regex_search(value, result, ",
                        this._stringType.getRegex(),
                        "( *c.",
                        getterPattern,
                        "() ));"
                    );
                    this.emitBlock(["if (result.empty())"], false, () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.InvalidPatternException),
                            " (",
                            this._stringType.createStringLiteral(["Value doesn't match pattern for "]),
                            " + name + ",
                            this._stringType.createStringLiteral([" ("]),
                            " + value +",
                            this._stringType.createStringLiteral([" != "]),
                            " + *c.",
                            getterPattern,
                            "() + ",
                            this._stringType.createStringLiteral([")"]),
                            ");"
                        );
                    });
                });
                this.ensureBlankLine();
            }
        );
    }

    protected emitHelperFunctions(): void {
        this._stringType.emitHelperFunctions();

        if (
            this._options.codeFormat &&
            iterableSome(this.typeGraph.allTypesUnordered(), t => constraintsForType(t) !== undefined)
        ) {
            this.emitConstraintClasses();
            this.ensureBlankLine();
        }

        this.ensureBlankLine();

        let untypedMacroName = "NLOHMANN_UNTYPED_";
        let optionalMacroName = "NLOHMANN_OPTIONAL_";
        this._namespaceNames.forEach(value => {
            // We can't use upper name, because namespaces are case sensitive
            untypedMacroName += value;
            untypedMacroName += "_";

            optionalMacroName += value;
            optionalMacroName += "_";
        });

        untypedMacroName += "HELPER";
        optionalMacroName += "HELPER";

        this.emitLine(`#ifndef ${untypedMacroName}`);
        this.emitLine(`#define ${untypedMacroName}`);

        this.emitBlock(
            ["inline json get_untyped(", this.withConst("json"), " & j, ", this.withConst("char"), " * property)"],
            false,
            () => {
                this.emitBlock(["if (j.find(property) != j.end())"], false, () => {
                    this.emitLine("return j.at(property).get<json>();");
                });
                this.emitLine("return json();");
            }
        );

        this.ensureBlankLine();

        this.emitBlock(
            ["inline json get_untyped(", this.withConst("json"), " & j, std::string property)"],
            false,
            () => {
                this.emitLine("return get_untyped(j, property.data());");
            }
        );

        this.emitLine("#endif");

        this.ensureBlankLine();

        if (this.haveUnions || this.haveOptionalProperties) {
            this.ensureBlankLine();

            this.emitLine(`#ifndef ${optionalMacroName}`);
            this.emitLine(`#define ${optionalMacroName}`);

            const emitGetOptional = (optionalType: string, label: string): void => {
                this.emitLine("template <typename T>");
                this.emitBlock(
                    [
                        "inline ",
                        optionalType,
                        `<T> get_${label}_optional(`,
                        this.withConst("json"),
                        " & j, ",
                        this.withConst("char"),
                        " * property)"
                    ],
                    false,
                    () => {
                        this.emitLine(["auto it = j.find(property);"]);
                        this.emitBlock(["if (it != j.end() && !it->is_null())"], false, () => {
                            this.emitLine("return j.at(property).get<", optionalType, "<T>>();");
                        });
                        this.emitLine("return ", optionalType, "<T>();");
                    }
                );

                this.ensureBlankLine();

                this.emitLine("template <typename T>");
                this.emitBlock(
                    [
                        "inline ",
                        optionalType,
                        `<T> get_${label}_optional(`,
                        this.withConst("json"),
                        " & j, std::string property)"
                    ],
                    false,
                    () => {
                        this.emitLine(`return get_${label}_optional<T>(j, property.data());`);
                    }
                );
            };
            emitGetOptional(this.optionalTypeHeap(), "heap");
            emitGetOptional(this.optionalTypeStack(), "stack");

            this.emitLine("#endif");

            this.ensureBlankLine();
        }
    }

    protected emitExtraIncludes(): void {
        this.ensureBlankLine();

        if (this._options.codeFormat) {
            if (this._options.boost) {
                this.emitInclude(true, "boost/optional.hpp");
            } else {
                this.emitInclude(true, "optional");
            }
            this.emitInclude(true, "stdexcept");
            this.emitInclude(true, "regex");
        }

        if (this._options.wstring) {
            this.emitInclude(true, "codecvt");
            this.emitInclude(true, "locale");
        }

        // Include unordered_map if contains large enums
        if (Array.from(this.enums).some(enumType => this.isLargeEnum(enumType))) {
            this.emitInclude(true, "unordered_map");
        }

        this.ensureBlankLine();
    }

    protected emitHelper(): void {
        this.startFile("helper.hpp", false);

        this.emitExtraIncludes();

        this.emitInclude(true, "sstream");
        this.ensureBlankLine();
        this.emitNamespaces(this._namespaceNames, () => {
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitHelperFunctions();
        });

        if (this.haveUnions || this.haveOptionalProperties) {
            this.ensureBlankLine();
            this.emitOptionalHelpers();
        }

        this.finishFile();
    }

    protected emitTypes(): void {
        if (!this._options.justTypes) {
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitHelperFunctions();
        }
        this.forEachDeclaration("interposing", decl => this.emitDeclaration(decl));
        if (this._options.justTypes) return;
        this.forEachTopLevel(
            "leading",
            (t: Type, name: Name) => this.emitTopLevelTypedef(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );
    }

    protected gatherUserNamespaceForwardDecls(): Sourcelike[] {
        return this.gatherSource(() => {
            this.forEachObject("leading-and-interposing", (_: any, className: Name) =>
                this.emitClassHeaders(className)
            );

            this.forEachEnum("leading-and-interposing", (_: any, enumName: Name) => this.emitEnumHeaders(enumName));
        });
    }

    protected gatherNlohmannNamespaceForwardDecls(): Sourcelike[] {
        return this.gatherSource(() => {
            this.forEachTopLevel("leading-and-interposing", (t: Type, className: Name) =>
                this.emitTopLevelHeaders(t, className)
            );

            this.ensureBlankLine();

            this.emitAllUnionHeaders();
        });
    }

    protected emitUserNamespaceImpls(): void {
        this.forEachObject("leading-and-interposing", (c: ClassType, className: Name) =>
            this.emitClassFunctions(c, className)
        );

        this.forEachEnum("leading-and-interposing", (e: EnumType, enumName: Name) =>
            this.emitEnumFunctions(e, enumName)
        );
    }

    protected emitNlohmannNamespaceImpls(): void {
        this.forEachTopLevel(
            "leading-and-interposing",
            (t: Type, name: Name) => this.emitTopLevelFunction(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        this.ensureBlankLine();

        this.emitAllUnionFunctions();
    }

    protected emitGenerators(): void {
        if (this._options.justTypes) {
            let didEmit = false;
            const gathered = this.gatherSource(() =>
                this.emitNamespaces(this._namespaceNames, () => {
                    didEmit = this.forEachTopLevel(
                        "none",
                        (t: Type, name: Name) => this.emitTopLevelTypedef(t, name),
                        t => this.namedTypeToNameForTopLevel(t) === undefined
                    );
                })
            );
            if (didEmit) {
                this.emitGatheredSource(gathered);
                this.ensureBlankLine();
            }
        } else {
            const userNamespaceForwardDecls = this.gatherUserNamespaceForwardDecls();
            const nlohmannNamespaceForwardDecls = this.gatherNlohmannNamespaceForwardDecls();

            if (userNamespaceForwardDecls.length === 0 && nlohmannNamespaceForwardDecls.length > 0) {
                this.emitNamespaces(["nlohmann"], () => {
                    this.emitGatheredSource(nlohmannNamespaceForwardDecls);
                    this.emitNlohmannNamespaceImpls();
                });
            } else if (userNamespaceForwardDecls.length > 0 && nlohmannNamespaceForwardDecls.length === 0) {
                this.emitNamespaces(this._namespaceNames, () => {
                    this.emitGatheredSource(userNamespaceForwardDecls);
                    this.emitUserNamespaceImpls();
                });
            } else if (userNamespaceForwardDecls.length > 0 && nlohmannNamespaceForwardDecls.length > 0) {
                this.emitNamespaces(this._namespaceNames, () => {
                    this.emitGatheredSource(userNamespaceForwardDecls);
                });
                this.emitNamespaces(["nlohmann"], () => {
                    this.emitGatheredSource(nlohmannNamespaceForwardDecls);
                });
                this.emitNamespaces(this._namespaceNames, () => {
                    this.emitUserNamespaceImpls();
                });
                this.emitNamespaces(["nlohmann"], () => {
                    this.emitNlohmannNamespaceImpls();
                });
            }
        }
    }

    protected emitSingleSourceStructure(proposedFilename: string): void {
        this.startFile(proposedFilename);
        this._generatedFiles.add(proposedFilename);

        this.emitExtraIncludes();

        if (this._options.justTypes) {
            this.emitTypes();
        } else {
            if (!this._options.justTypes && this.haveNamedTypes && (this.haveUnions || this.haveOptionalProperties)) {
                this.emitOptionalHelpers();
                this.ensureBlankLine();
            }
            this.emitNamespaces(this._namespaceNames, () => this.emitTypes());
        }

        this.ensureBlankLine();

        this.emitGenerators();

        this.finishFile();
    }

    protected updateIncludes(isClassMember: boolean, includes: IncludeMap, propertyType: Type, _defName: string): void {
        const propTypes = this.generatedTypes(isClassMember, propertyType);

        for (const t of propTypes) {
            const typeName = this.sourcelikeToString(t.name);

            const propRecord: IncludeRecord = { kind: undefined, typeKind: undefined };

            if (t.type instanceof ClassType) {
                /**
                 * Ok. We can NOT forward declare direct class members, e.g. a class type is included
                 * at level#0. HOWEVER if it is not a direct class member (e.g. std::shared_ptr<Class>),
                 * - level > 0 - then we can SURELY forward declare it.
                 */
                propRecord.typeKind = "class";
                propRecord.kind = t.level === 0 ? IncludeKind.Include : IncludeKind.ForwardDeclare;
                if (t.forceInclude) {
                    propRecord.kind = IncludeKind.Include;
                }
            } else if (t.type instanceof EnumType) {
                propRecord.typeKind = "enum";
                propRecord.kind = IncludeKind.ForwardDeclare;
            } else if (t.type instanceof UnionType) {
                propRecord.typeKind = "union";
                /** Recurse into the union */
                const [maybeNull] = removeNullFromUnion(t.type, true);
                if (maybeNull !== undefined) {
                    /** Houston this is a variant, include it */
                    propRecord.kind = IncludeKind.Include;
                } else {
                    if (t.forceInclude) {
                        propRecord.kind = IncludeKind.Include;
                    } else {
                        propRecord.kind = IncludeKind.ForwardDeclare;
                    }
                }
            }

            if (includes.has(typeName)) {
                const incKind = includes.get(typeName);
                /**
                 * If we already include the type as typed include,
                 * do not write it over with forward declare
                 */
                if (incKind !== undefined && incKind.kind === IncludeKind.ForwardDeclare) {
                    includes.set(typeName, propRecord);
                }
            } else {
                includes.set(typeName, propRecord);
            }
        }
    }

    protected emitIncludes(c: ClassType | UnionType | EnumType, defName: string): void {
        /**
         * Need to generate "includes", in terms 'c' has members, which
         * are defined by others
         */
        const includes: IncludeMap = new Map();

        if (c instanceof UnionType) {
            this.updateIncludes(false, includes, c, defName);
        } else if (c instanceof ClassType) {
            this.forEachClassProperty(c, "none", (_name, _jsonName, property) => {
                this.updateIncludes(true, includes, property.type, defName);
            });
        }

        if (includes.size !== 0) {
            let numForwards = 0;
            let numIncludes = 0;
            includes.forEach((rec: IncludeRecord, name: string) => {
                /** Don't bother including the one we are defining */
                if (name === defName) {
                    return;
                }

                if (rec.kind !== IncludeKind.ForwardDeclare) {
                    this.emitInclude(false, [name, ".hpp"]);
                    numIncludes++;
                } else {
                    numForwards++;
                }
            });

            if (numIncludes > 0) {
                this.ensureBlankLine();
            }

            if (numForwards > 0) {
                this.emitNamespaces(this._namespaceNames, () => {
                    includes.forEach((rec: IncludeRecord, name: string) => {
                        /** Don't bother including the one we are defining */
                        if (name === defName) {
                            return;
                        }

                        if (rec.kind !== IncludeKind.ForwardDeclare) {
                            return;
                        }

                        if (rec.typeKind === "class" || rec.typeKind === "union") {
                            if (this._options.codeFormat) {
                                this.emitLine("class ", name, ";");
                            } else {
                                this.emitLine("struct ", name, ";");
                            }
                        } else if (rec.typeKind === "enum") {
                            this.emitLine("enum class ", name, " : ", this._enumType, ";");
                        } else {
                            panic(`Invalid type "${rec.typeKind}" to forward declare`);
                        }
                    });
                });
            }

            this.ensureBlankLine();
        }
    }

    protected emitDefinition(d: ClassType | EnumType | UnionType, defName: Name): void {
        const name = `${this.sourcelikeToString(defName)}.hpp`;
        this.startFile(name, true);
        this._generatedFiles.add(name);

        this.emitIncludes(d, this.sourcelikeToString(defName));

        this.emitNamespaces(this._namespaceNames, () => {
            this.emitDescription(this.descriptionForType(d));
            this.ensureBlankLine();
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            if (d instanceof ClassType) {
                this.emitClass(d, defName);
            } else if (d instanceof EnumType) {
                this.emitEnum(d, defName);
            } else if (d instanceof UnionType) {
                this.emitUnionTypedefs(d, defName);
            }
        });

        this.finishFile();
    }

    protected emitMultiSourceStructure(proposedFilename: string): void {
        if (!this._options.justTypes && this.haveNamedTypes) {
            this.emitHelper();

            this.startFile("Generators.hpp", true);

            this._allTypeNames.forEach(t => {
                this.emitInclude(false, [t, ".hpp"]);
            });

            this.ensureBlankLine();
            this.emitGenerators();

            this.finishFile();
        }

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => {
                this.emitDefinition(c, n);
            },
            (e, n) => {
                this.emitDefinition(e, n);
            },
            (u, n) => {
                this.emitDefinition(u, n);
            }
        );

        /**
         * If for some reason we have not generated anything,
         * it means that a unnamed type has been generated - or nothing.
         */
        if (!this._generatedFiles.has(proposedFilename)) {
            if (!this.haveNamedTypes) {
                this.emitHelper();
            }

            this.startFile(proposedFilename);

            this._generatedFiles.forEach(f => {
                this.emitInclude(false, f);
            });

            this.emitNamespaces(this._namespaceNames, () => {
                this.forEachTopLevel(
                    "leading",
                    (t: Type, name: Name) => this.emitTopLevelTypedef(t, name),
                    t => this.namedTypeToNameForTopLevel(t) === undefined
                );
            });

            this.finishFile();
        }
    }

    protected emitSourceStructure(proposedFilename: string): void {
        this._generatedFiles.clear();

        /** Gather all the unique/custom types used by the schema */
        this._allTypeNames.clear();
        this.forEachDeclaration("none", decl => {
            const definedTypes = directlyReachableTypes<string>(decl.type, t => {
                if (isNamedType(t) && (t instanceof ClassType || t instanceof EnumType || t instanceof UnionType)) {
                    return new Set([
                        this.sourcelikeToString(
                            this.cppType(
                                t,
                                {
                                    needsForwardIndirection: false,
                                    needsOptionalIndirection: false,
                                    inJsonNamespace: false
                                },
                                true,
                                false,
                                false
                            )
                        )
                    ]);
                }

                return null;
            });

            this._allTypeNames = setUnion(definedTypes, this._allTypeNames);
        });

        if (this._options.typeSourceStyle) {
            this.emitSingleSourceStructure(proposedFilename);
        } else {
            this.emitMultiSourceStructure(proposedFilename);
        }
    }

    protected isConversionRequired(t: Type) {
        const originalType = this.cppType(
            t,
            {
                needsForwardIndirection: true,
                needsOptionalIndirection: true,
                inJsonNamespace: true
            },
            false,
            false,
            false
        );

        const newType = this.cppType(
            t,
            {
                needsForwardIndirection: true,
                needsOptionalIndirection: true,
                inJsonNamespace: true
            },
            false,
            true,
            false
        );

        return originalType !== newType;
    }

    public NarrowString = new (class extends BaseString implements StringType {
        constructor() {
            super(
                "std::string",
                "const std::string & ",
                "std::smatch",
                "std::regex",
                "",
                new WrappingCode(["std::to_string("], [")"]),
                "",
                ""
            );
        }

        public wrapEncodingChange(
            _qualifier: Sourcelike[],
            _fromType: Sourcelike,
            _toType: Sourcelike,
            inner: Sourcelike
        ): Sourcelike {
            return inner;
        }

        public emitHelperFunctions(): void {
            return;
        }
    })();

    public WideString = new (class extends BaseString implements StringType {
        constructor(public superThis: CPlusPlusRenderer) {
            super(
                "std::wstring",
                "const std::wstring & ",
                "std::wsmatch",
                "std::wregex",
                "L",
                new WrappingCode(["std::to_wstring("], [")"]),
                "Utf16_Utf8",
                "convert"
            );
        }

        public wrapEncodingChange(
            qualifier: Sourcelike[],
            fromType: Sourcelike,
            toType: Sourcelike,
            inner: Sourcelike
        ): Sourcelike {
            if (this.superThis.sourcelikeToString(fromType) === this.superThis.sourcelikeToString(toType)) {
                return inner;
            }

            return [
                addQualifier(qualifier, [this._encodingClass]),
                "<",
                fromType,
                ", ",
                toType,
                ">::",
                this._encodingFunction,
                "(",
                inner,
                ")"
            ];
        }

        public emitHelperFunctions(): void {
            this.superThis.emitLine("template<typename T>");
            this.superThis.emitLine("struct tag {};");
            this.superThis.ensureBlankLine();

            this.superThis.emitLine("template<typename fromType, typename toType>");
            this.superThis.emitBlock(["class Utf16_Utf8"], true, () => {
                this.superThis.emitLine("private:");
                this.superThis.emitLine("template<typename TF, typename TT>");
                this.superThis.emitBlock(
                    ["static toType convert(tag<std::shared_ptr<TF> >, tag<std::shared_ptr<TT> >, fromType ptr)"],
                    false,
                    () => {
                        this.superThis.emitLine(
                            "if (ptr == nullptr) return std::unique_ptr<TT>(); else return std::unique_ptr<TT>(new TT(Utf16_Utf8<TF,TT>::convert(*ptr)));"
                        );
                    }
                );
                this.superThis.ensureBlankLine();

                this.superThis.emitLine("template<typename TF, typename TT>");
                this.superThis.emitBlock(
                    ["static toType convert(tag<std::vector<TF> >, tag<std::vector<TT> >, fromType v)"],
                    false,
                    () => {
                        this.superThis.emitLine("auto it = v.begin();");
                        this.superThis.emitLine("auto newVector = std::vector<TT>();");
                        this.superThis.emitBlock(["while (it != v.end())"], false, () => {
                            this.superThis.emitLine("newVector.push_back(Utf16_Utf8<TF,TT>::convert(*it));");
                            this.superThis.emitLine("it++;");
                        });
                        this.superThis.emitLine("return newVector;");
                    }
                );
                this.superThis.ensureBlankLine();

                this.superThis.emitLine("template<typename KF, typename VF, typename KT, typename VT>");
                this.superThis.emitBlock(
                    ["static toType convert(tag<std::map<KF,VF> >, tag<std::map<KT,VT> >, fromType m)"],
                    false,
                    () => {
                        this.superThis.emitLine("auto it = m.begin();");
                        this.superThis.emitLine("auto newMap = std::map<KT, VT>();");
                        this.superThis.emitBlock(["while (it != m.end())"], false, () => {
                            this.superThis.emitLine(
                                "newMap.insert(std::pair<KT, VT>(Utf16_Utf8<KF, KT>::convert(it->first), Utf16_Utf8<VF, VT>::convert(it->second)));"
                            );
                            this.superThis.emitLine("it++;");
                        });
                        this.superThis.emitLine("return newMap;");
                    }
                );
                this.superThis.ensureBlankLine();

                this.superThis.emitLine("template<typename TF, typename TT>");
                this.superThis.emitBlock(["static fromType convert(tag<TF>, tag<TT>, fromType from)"], false, () => {
                    this.superThis.emitLine("return from;");
                });
                this.superThis.ensureBlankLine();

                this.superThis.emitBlock(
                    ["static std::wstring convert(tag<std::string>, tag<std::wstring>, std::string str)"],
                    false,
                    () => {
                        this.superThis.emitLine(
                            "return std::wstring_convert<std::codecvt_utf8_utf16<wchar_t, 0x10ffff, std::little_endian>, wchar_t>{}.from_bytes(str.data());"
                        );
                    }
                );
                this.superThis.ensureBlankLine();

                this.superThis.emitBlock(
                    ["static std::string convert(tag<std::wstring>, tag<std::string>, std::wstring str)"],
                    false,
                    () => {
                        this.superThis.emitLine(
                            "return std::wstring_convert<std::codecvt_utf8_utf16<wchar_t, 0x10ffff, std::little_endian>, wchar_t>{}.to_bytes(str.data());"
                        );
                    }
                );
                this.superThis.ensureBlankLine();

                this.superThis.emitLine("public:");
                this.superThis.emitBlock(["static toType convert(fromType in)"], false, () => {
                    this.superThis.emitLine("return convert(tag<fromType>(), tag<toType>(), in);");
                });
            });
            this.superThis.ensureBlankLine();

            this.superThis.emitLine("template<typename T>");
            this.superThis.emitBlock(["std::wstring wdump(const T& j)"], false, () => {
                this.superThis.emitLine("std::ostringstream s;");
                this.superThis.emitLine("s << j;");
                this.superThis.emitLine(
                    "return ",
                    this.superThis.ourQualifier(false),
                    "Utf16_Utf8<std::string, std::wstring>::convert(s.str()); "
                );
            });
            this.superThis.ensureBlankLine();
        }
    })(this);
}
