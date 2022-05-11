"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TargetLanguage_1 = require("../TargetLanguage");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Naming_1 = require("../Naming");
const Source_1 = require("../Source");
const Annotation_1 = require("../Annotation");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const RendererOptions_1 = require("../RendererOptions");
const Support_2 = require("../support/Support");
const AccessorNames_1 = require("../attributes/AccessorNames");
const EnumValues_1 = require("../attributes/EnumValues");
const Constraints_1 = require("../attributes/Constraints");
const pascalValue = ["pascal-case", "pascal"];
const underscoreValue = ["underscore-case", "underscore"];
const camelValue = ["camel-case", "camel"];
const upperUnderscoreValue = ["upper-underscore-case", "upper-underscore"];
const pascalUpperAcronymsValue = ["pascal-case-upper-acronyms", "pascal-upper-acronyms"];
const camelUpperAcronymsValue = ["camel-case-upper-acronyms", "camel-upper-acronyms"];
exports.cPlusPlusOptions = {
    typeSourceStyle: new RendererOptions_1.EnumOption("source-style", "Source code generation type,  whether to generate single or multiple source files", [["single-source", true], ["multi-source", false]], "single-source", "secondary"),
    includeLocation: new RendererOptions_1.EnumOption("include-location", "Whether json.hpp is to be located globally or locally", [["local-include", true], ["global-include", false]], "local-include", "secondary"),
    codeFormat: new RendererOptions_1.EnumOption("code-format", "Generate classes with getters/setters, instead of structs", [["with-struct", false], ["with-getter-setter", true]], "with-getter-setter"),
    wstring: new RendererOptions_1.EnumOption("wstring", "Store strings using Utf-16 std::wstring, rather than Utf-8 std::string", [["use-string", false], ["use-wstring", true]], "use-string"),
    msbuildPermissive: new RendererOptions_1.EnumOption("msbuildPermissive", "Moves to_json and from_json types into the nlohmann::details namespace, so that msbuild can build it with conformance mode disabled", [["not-permissive", false], ["use-permissive", true]], "not-permissive", "secondary"),
    westConst: new RendererOptions_1.EnumOption("const-style", "Put const to the left/west (const T) or right/east (T const)", [["west-const", true], ["east-const", false]], "west-const"),
    justTypes: new RendererOptions_1.BooleanOption("just-types", "Plain types only", false),
    namespace: new RendererOptions_1.StringOption("namespace", "Name of the generated namespace(s)", "NAME", "quicktype"),
    enumType: new RendererOptions_1.StringOption("enum-type", "Type of enum class", "NAME", "int", "secondary"),
    typeNamingStyle: new RendererOptions_1.EnumOption("type-style", "Naming style for types", [
        pascalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    memberNamingStyle: new RendererOptions_1.EnumOption("member-style", "Naming style for members", [
        underscoreValue,
        pascalValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    enumeratorNamingStyle: new RendererOptions_1.EnumOption("enumerator-style", "Naming style for enumerators", [
        upperUnderscoreValue,
        underscoreValue,
        pascalValue,
        camelValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    boost: new RendererOptions_1.BooleanOption("boost", "Require a dependency on boost. Without boost, C++17 is required", true),
    hideNullOptional: new RendererOptions_1.BooleanOption("hide-null-optional", "Hide null value for optional field", false),
};
class CPlusPlusTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor(displayName = "C++", names = ["c++", "cpp", "cplusplus"], extension = "cpp") {
        super(displayName, names, extension);
    }
    getOptions() {
        return [
            exports.cPlusPlusOptions.justTypes,
            exports.cPlusPlusOptions.namespace,
            exports.cPlusPlusOptions.codeFormat,
            exports.cPlusPlusOptions.wstring,
            exports.cPlusPlusOptions.msbuildPermissive,
            exports.cPlusPlusOptions.westConst,
            exports.cPlusPlusOptions.typeSourceStyle,
            exports.cPlusPlusOptions.includeLocation,
            exports.cPlusPlusOptions.typeNamingStyle,
            exports.cPlusPlusOptions.memberNamingStyle,
            exports.cPlusPlusOptions.enumeratorNamingStyle,
            exports.cPlusPlusOptions.enumType,
            exports.cPlusPlusOptions.boost,
            exports.cPlusPlusOptions.hideNullOptional,
        ];
    }
    get supportsUnionsWithBothNumberTypes() {
        return true;
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new CPlusPlusRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.cPlusPlusOptions, untypedOptionValues));
    }
}
exports.CPlusPlusTargetLanguage = CPlusPlusTargetLanguage;
function constraintsForType(t) {
    const minMax = Constraints_1.minMaxValueForType(t);
    const minMaxLength = Constraints_1.minMaxLengthForType(t);
    const pattern = Constraints_1.patternForType(t);
    if (minMax === undefined && minMaxLength === undefined && pattern === undefined)
        return undefined;
    return { minMax, minMaxLength, pattern };
}
const legalizeName = Strings_1.legalizeCharacters(cp => Strings_1.isAscii(cp) && Strings_1.isLetterOrUnderscoreOrDigit(cp));
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
/**
 * We can't use boost/std optional. They MUST have the declaration of
 * the given structure available, meaning we can't forward declare anything.
 * Which is bad as we have circles in Json schema, which require at least
 * forward declarability.
 * The next question, why isn't unique_ptr is enough here?
 * That problem relates to getter/setter. If using getter/setters we
 * can't/mustn't return a unique_ptr out of the class -> as that is the
 * sole reason why we have declared that as unique_ptr, so that only
 * the class owns it. We COULD return unique_ptr references, which practically
 * kills the uniqueness of the smart pointer -> hence we use shared_ptrs.
 */
const optionalType = "std::shared_ptr";
/**
 * To be able to support circles in multiple files -
 * e.g. class#A using class#B using class#A (obviously not directly,
 * but in vector or in variant) we can forward declare them;
 */
var IncludeKind;
(function (IncludeKind) {
    IncludeKind[IncludeKind["ForwardDeclare"] = 0] = "ForwardDeclare";
    IncludeKind[IncludeKind["Include"] = 1] = "Include";
})(IncludeKind = exports.IncludeKind || (exports.IncludeKind = {}));
var GlobalNames;
(function (GlobalNames) {
    GlobalNames[GlobalNames["ClassMemberConstraints"] = 0] = "ClassMemberConstraints";
    GlobalNames[GlobalNames["ClassMemberConstraintException"] = 1] = "ClassMemberConstraintException";
    GlobalNames[GlobalNames["ValueTooLowException"] = 2] = "ValueTooLowException";
    GlobalNames[GlobalNames["ValueTooHighException"] = 3] = "ValueTooHighException";
    GlobalNames[GlobalNames["ValueTooShortException"] = 4] = "ValueTooShortException";
    GlobalNames[GlobalNames["ValueTooLongException"] = 5] = "ValueTooLongException";
    GlobalNames[GlobalNames["InvalidPatternException"] = 6] = "InvalidPatternException";
    GlobalNames[GlobalNames["CheckConstraint"] = 7] = "CheckConstraint";
})(GlobalNames = exports.GlobalNames || (exports.GlobalNames = {}));
var MemberNames;
(function (MemberNames) {
    MemberNames[MemberNames["MinValue"] = 0] = "MinValue";
    MemberNames[MemberNames["GetMinValue"] = 1] = "GetMinValue";
    MemberNames[MemberNames["SetMinValue"] = 2] = "SetMinValue";
    MemberNames[MemberNames["MaxValue"] = 3] = "MaxValue";
    MemberNames[MemberNames["GetMaxValue"] = 4] = "GetMaxValue";
    MemberNames[MemberNames["SetMaxValue"] = 5] = "SetMaxValue";
    MemberNames[MemberNames["MinLength"] = 6] = "MinLength";
    MemberNames[MemberNames["GetMinLength"] = 7] = "GetMinLength";
    MemberNames[MemberNames["SetMinLength"] = 8] = "SetMinLength";
    MemberNames[MemberNames["MaxLength"] = 9] = "MaxLength";
    MemberNames[MemberNames["GetMaxLength"] = 10] = "GetMaxLength";
    MemberNames[MemberNames["SetMaxLength"] = 11] = "SetMaxLength";
    MemberNames[MemberNames["Pattern"] = 12] = "Pattern";
    MemberNames[MemberNames["GetPattern"] = 13] = "GetPattern";
    MemberNames[MemberNames["SetPattern"] = 14] = "SetPattern";
})(MemberNames = exports.MemberNames || (exports.MemberNames = {}));
function addQualifier(qualifier, qualified) {
    if (qualified.length === 0) {
        return [];
    }
    return [qualifier, qualified];
}
class WrappingCode {
    constructor(start, end) {
        this._start = start;
        this._end = end;
    }
    wrap(qualifier, inner) {
        return [addQualifier(qualifier, this._start), inner, this._end];
    }
}
class BaseString {
    constructor(stringType, constStringType, smatch, regex, stringLiteralPrefix, toString, encodingClass, encodingFunction) {
        (this._stringType = stringType),
            (this._constStringType = constStringType),
            (this._smatch = smatch),
            (this._regex = regex),
            (this._stringLiteralPrefix = stringLiteralPrefix),
            (this._toString = toString),
            (this._encodingClass = encodingClass),
            (this._encodingFunction = encodingFunction);
    }
    getType() {
        return this._stringType;
    }
    getConstType() {
        return this._constStringType;
    }
    getSMatch() {
        return this._smatch;
    }
    getRegex() {
        return this._regex;
    }
    createStringLiteral(inner) {
        return [this._stringLiteralPrefix, '"', inner, '"'];
    }
    wrapToString(inner) {
        return this._toString.wrap([], inner);
    }
}
class CPlusPlusRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
        this._gettersAndSettersForPropertyName = new Map();
        this.NarrowString = new class extends BaseString {
            constructor() {
                super("std::string", "const std::string & ", "std::smatch", "std::regex", "", new WrappingCode(["std::to_string("], [")"]), "", "");
            }
            wrapEncodingChange(_qualifier, _fromType, _toType, inner) {
                return inner;
            }
            emitHelperFunctions() {
                return;
            }
        }();
        this.WideString = new class extends BaseString {
            constructor(superThis) {
                super("std::wstring", "const std::wstring & ", "std::wsmatch", "std::wregex", "L", new WrappingCode(["std::to_wstring("], [")"]), "Utf16_Utf8", "convert");
                this.superThis = superThis;
            }
            wrapEncodingChange(qualifier, fromType, toType, inner) {
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
            emitHelperFunctions() {
                this.superThis.emitLine("template<typename T>");
                this.superThis.emitLine("struct tag {};");
                this.superThis.ensureBlankLine();
                this.superThis.emitLine("template<typename fromType, typename toType>");
                this.superThis.emitBlock(["class Utf16_Utf8"], true, () => {
                    this.superThis.emitLine("private:");
                    this.superThis.emitLine("template<typename TF, typename TT>");
                    this.superThis.emitBlock(["static toType convert(tag<std::shared_ptr<TF> >, tag<std::shared_ptr<TT> >, fromType ptr)"], false, () => {
                        this.superThis.emitLine("if (ptr == nullptr) return std::unique_ptr<TT>(); else return std::unique_ptr<TT>(new TT(Utf16_Utf8<TF,TT>::convert(*ptr)));");
                    });
                    this.superThis.ensureBlankLine();
                    this.superThis.emitLine("template<typename TF, typename TT>");
                    this.superThis.emitBlock(["static toType convert(tag<std::vector<TF> >, tag<std::vector<TT> >, fromType v)"], false, () => {
                        this.superThis.emitLine("auto it = v.begin();");
                        this.superThis.emitLine("auto newVector = std::vector<TT>();");
                        this.superThis.emitBlock(["while (it != v.end())"], false, () => {
                            this.superThis.emitLine("newVector.push_back(Utf16_Utf8<TF,TT>::convert(*it));");
                            this.superThis.emitLine("it++;");
                        });
                        this.superThis.emitLine("return newVector;");
                    });
                    this.superThis.ensureBlankLine();
                    this.superThis.emitLine("template<typename KF, typename VF, typename KT, typename VT>");
                    this.superThis.emitBlock(["static toType convert(tag<std::map<KF,VF> >, tag<std::map<KT,VT> >, fromType m)"], false, () => {
                        this.superThis.emitLine("auto it = m.begin();");
                        this.superThis.emitLine("auto newMap = std::map<KT, VT>();");
                        this.superThis.emitBlock(["while (it != m.end())"], false, () => {
                            this.superThis.emitLine("newMap.insert(std::pair<KT, VT>(Utf16_Utf8<KF, KT>::convert(it->first), Utf16_Utf8<VF, VT>::convert(it->second)));");
                            this.superThis.emitLine("it++;");
                        });
                        this.superThis.emitLine("return newMap;");
                    });
                    this.superThis.ensureBlankLine();
                    this.superThis.emitLine("template<typename TF, typename TT>");
                    this.superThis.emitBlock(["static fromType convert(tag<TF>, tag<TT>, fromType from)"], false, () => {
                        this.superThis.emitLine("return from;");
                    });
                    this.superThis.ensureBlankLine();
                    this.superThis.emitBlock(["static std::wstring convert(tag<std::string>, tag<std::wstring>, std::string str)"], false, () => {
                        this.superThis.emitLine("return std::wstring_convert<std::codecvt_utf8_utf16<wchar_t, 0x10ffff, std::little_endian>, wchar_t>{}.from_bytes(str.data());");
                    });
                    this.superThis.ensureBlankLine();
                    this.superThis.emitBlock(["static std::string convert(tag<std::wstring>, tag<std::string>, std::wstring str)"], false, () => {
                        this.superThis.emitLine("return std::wstring_convert<std::codecvt_utf8_utf16<wchar_t, 0x10ffff, std::little_endian>, wchar_t>{}.to_bytes(str.data());");
                    });
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
                    this.superThis.emitLine("return ", this.superThis.ourQualifier(false), "Utf16_Utf8<std::string, std::wstring>::convert(s.str()); ");
                });
                this.superThis.ensureBlankLine();
            }
        }(this);
        this._enumType = _options.enumType;
        this._namespaceNames = _options.namespace.split("::");
        this.typeNamingStyle = _options.typeNamingStyle;
        this._namedTypeNameStyle = Strings_1.makeNameStyle(this.typeNamingStyle, legalizeName);
        this.enumeratorNamingStyle = _options.enumeratorNamingStyle;
        this._memberNameStyle = Strings_1.makeNameStyle(_options.memberNamingStyle, legalizeName);
        this._memberNamingFunction = Naming_1.funPrefixNamer("members", this._memberNameStyle);
        this._gettersAndSettersForPropertyName = new Map();
        this._allTypeNames = new Set();
        this._generatedFiles = new Set();
        this._generatedGlobalNames = new Map();
        this._generatedMemberNames = new Map();
        this._forbiddenGlobalNames = [];
        if (_options.wstring) {
            this._stringType = this.WideString;
        }
        else {
            this._stringType = this.NarrowString;
        }
        if (_options.boost) {
            this._optionalType = "boost::optional";
            this._nulloptType = "boost::none";
            this._variantType = "boost::variant";
            this._variantIndexMethodName = "which";
        }
        else {
            this._optionalType = "std::optional";
            this._nulloptType = "std::nullopt";
            this._variantType = "std::variant";
            this._variantIndexMethodName = "index";
        }
        this.setupGlobalNames();
    }
    getConstraintMembers() {
        return [
            {
                name: MemberNames.MinValue,
                getter: MemberNames.GetMinValue,
                setter: MemberNames.SetMinValue,
                cppType: "int"
            },
            {
                name: MemberNames.MaxValue,
                getter: MemberNames.GetMaxValue,
                setter: MemberNames.SetMaxValue,
                cppType: "int"
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
    lookupGlobalName(type) {
        return Support_1.defined(this._generatedGlobalNames.get(type));
    }
    lookupMemberName(type) {
        return Support_1.defined(this._generatedMemberNames.get(type));
    }
    addGlobalName(type) {
        const genName = this._namedTypeNameStyle(GlobalNames[type]);
        this._generatedGlobalNames.set(type, genName);
        this._forbiddenGlobalNames.push(genName);
    }
    addMemberName(type) {
        this._generatedMemberNames.set(type, this._memberNameStyle(MemberNames[type]));
    }
    setupGlobalNames() {
        for (const v of Support_1.numberEnumValues(GlobalNames)) {
            this.addGlobalName(v);
        }
        for (const v of Support_1.numberEnumValues(MemberNames)) {
            this.addMemberName(v);
        }
    }
    forbiddenNamesForGlobalNamespace() {
        return [...keywords, ...this._forbiddenGlobalNames];
    }
    forbiddenForObjectProperties(_c, _className) {
        return { names: [], includeGlobalForbidden: true };
    }
    forbiddenForEnumCases(_e, _enumName) {
        return { names: [], includeGlobalForbidden: true };
    }
    makeNamedTypeNamer() {
        return Naming_1.funPrefixNamer("types", this._namedTypeNameStyle);
    }
    namerForObjectProperty() {
        return this._memberNamingFunction;
    }
    makeUnionMemberNamer() {
        return null;
    }
    makeEnumCaseNamer() {
        return Naming_1.funPrefixNamer("enumerators", Strings_1.makeNameStyle(this.enumeratorNamingStyle, legalizeName));
    }
    makeNamesForPropertyGetterAndSetter(_c, _className, _p, _jsonName, name) {
        const getterName = new Naming_1.DependencyName(this._memberNamingFunction, name.order, lookup => `get_${lookup(name)}`);
        const mutableGetterName = new Naming_1.DependencyName(this._memberNamingFunction, name.order, lookup => `getMutable_${lookup(name)}`);
        const setterName = new Naming_1.DependencyName(this._memberNamingFunction, name.order, lookup => `set_${lookup(name)}`);
        return [getterName, mutableGetterName, setterName];
    }
    makePropertyDependencyNames(c, className, p, jsonName, name) {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(c, className, p, jsonName, name);
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }
    withConst(s) {
        if (this._options.westConst) {
            return ["const ", s];
        }
        else {
            return [s, " const"];
        }
    }
    emitInclude(global, name) {
        this.emitLine("#include ", global ? "<" : '"', name, global ? ">" : '"');
    }
    startFile(basename, includeHelper = true) {
        Support_2.assert(this._currentFilename === undefined, "Previous file wasn't finished");
        if (basename !== undefined) {
            this._currentFilename = this.sourcelikeToString(basename);
        }
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }
        else if (!this._options.justTypes) {
            this.emitCommentLines([
                " To parse this JSON data, first install",
                "",
            ]);
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
                    this.emitLine("//     ", this.ourQualifier(false), topLevelName, " data = nlohmann::json::parse(jsonString);");
                });
            }
            else {
                this.emitLine("//     ", this.ourQualifier(false), basename, " data = nlohmann::json::parse(jsonString);");
            }
            if (this._options.wstring) {
                this.emitLine("//");
                this.emitLine("//  You can get std::wstring data back out using");
                this.emitLine("//");
                this.forEachTopLevel("none", (_, topLevelName) => {
                    this.emitLine("//     std::wcout << ", this.ourQualifier(false), "wdump((nlohmann::json) ", topLevelName, ");");
                });
            }
        }
        this.ensureBlankLine();
        this.emitLine("#pragma once");
        this.ensureBlankLine();
        if (this.haveNamedUnions) {
            if (this._options.boost) {
                this.emitInclude(true, "boost/variant.hpp");
            }
            else {
                this.emitInclude(true, "variant");
            }
        }
        if (!this._options.justTypes) {
            if (!this._options.includeLocation) {
                this.emitInclude(true, "nlohmann/json.hpp");
            }
            else {
                this.emitInclude(false, "json.hpp");
            }
            if (includeHelper && !this._options.typeSourceStyle) {
                this.emitInclude(false, "helper.hpp");
            }
        }
        this.ensureBlankLine();
    }
    finishFile() {
        super.finishFile(Support_1.defined(this._currentFilename));
        this._currentFilename = undefined;
    }
    get needsTypeDeclarationBeforeUse() {
        return true;
    }
    canBeForwardDeclared(t) {
        const kind = t.kind;
        return kind === "class";
    }
    emitDescriptionBlock(lines) {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }
    emitBlock(line, withSemicolon, f, withIndent = true) {
        this.emitLine(line, " {");
        this.preventBlankLine();
        if (withIndent) {
            this.indent(f);
        }
        else {
            f();
        }
        this.preventBlankLine();
        if (withSemicolon) {
            this.emitLine("};");
        }
        else {
            this.emitLine("}");
        }
    }
    emitNamespaces(namespaceNames, f) {
        const namesArray = collection_utils_1.toReadonlyArray(namespaceNames);
        const first = namesArray[0];
        if (first === undefined) {
            f();
        }
        else {
            this.emitBlock(["namespace ", first], false, () => this.emitNamespaces(namesArray.slice(1), f), namesArray.length === 1);
        }
    }
    cppTypeInOptional(nonNulls, ctx, withIssues, forceNarrowString) {
        if (nonNulls.size === 1) {
            return this.cppType(Support_1.defined(collection_utils_1.iterableFirst(nonNulls)), ctx, withIssues, forceNarrowString, false);
        }
        const typeList = [];
        for (const t of nonNulls) {
            if (typeList.length !== 0) {
                typeList.push(", ");
            }
            typeList.push(this.cppType(t, {
                needsForwardIndirection: true,
                needsOptionalIndirection: false,
                inJsonNamespace: ctx.inJsonNamespace
            }, withIssues, false, false));
        }
        return [this._variantType, "<", typeList, ">"];
    }
    variantType(u, inJsonNamespace) {
        const [maybeNull, nonNulls] = TypeUtils_1.removeNullFromUnion(u, true);
        Support_2.assert(nonNulls.size >= 2, "Variant not needed for less than two types.");
        const indirection = maybeNull !== null;
        const variant = this.cppTypeInOptional(nonNulls, { needsForwardIndirection: !indirection, needsOptionalIndirection: !indirection, inJsonNamespace }, true, false);
        if (!indirection) {
            return variant;
        }
        return [optionalType, "<", variant, ">"];
    }
    ourQualifier(inJsonNamespace) {
        return (inJsonNamespace || this._options.msbuildPermissive) ? [collection_utils_1.arrayIntercalate("::", this._namespaceNames), "::"] : [];
    }
    jsonQualifier(inJsonNamespace) {
        return (inJsonNamespace || this._options.msbuildPermissive) ? [] : "nlohmann::";
    }
    variantIndirection(needIndirection, typeSrc) {
        if (!needIndirection)
            return typeSrc;
        return [optionalType, "<", typeSrc, ">"];
    }
    cppType(t, ctx, withIssues, forceNarrowString, isOptional) {
        const inJsonNamespace = ctx.inJsonNamespace;
        if (isOptional && t instanceof Type_1.UnionType) { // avoid have optionalType<optionalType<Type>>
            for (const tChild of t.getChildren()) {
                if (tChild.isNullable) {
                    isOptional = false;
                    break;
                }
            }
        }
        let typeSource = TypeUtils_1.matchType(t, _anyType => {
            isOptional = false;
            return Source_1.maybeAnnotated(withIssues, Annotation_1.anyTypeIssueAnnotation, [this.jsonQualifier(inJsonNamespace), "json"]);
        }, _nullType => {
            isOptional = false;
            return Source_1.maybeAnnotated(withIssues, Annotation_1.nullTypeIssueAnnotation, [this.jsonQualifier(inJsonNamespace), "json"]);
        }, _boolType => "bool", _integerType => "int64_t", _doubleType => "double", _stringType => {
            if (forceNarrowString) {
                return "std::string";
            }
            else {
                return this._stringType.getType();
            }
        }, arrayType => [
            "std::vector<",
            this.cppType(arrayType.items, { needsForwardIndirection: false, needsOptionalIndirection: true, inJsonNamespace }, withIssues, forceNarrowString, false),
            ">"
        ], classType => this.variantIndirection(ctx.needsForwardIndirection && this.isForwardDeclaredType(classType) && !isOptional, [
            this.ourQualifier(inJsonNamespace),
            this.nameForNamedType(classType)
        ]), mapType => {
            let keyType = this._stringType.getType();
            if (forceNarrowString) {
                keyType = "std::string";
            }
            return [
                "std::map<",
                keyType,
                ", ",
                this.cppType(mapType.values, { needsForwardIndirection: false, needsOptionalIndirection: true, inJsonNamespace }, withIssues, forceNarrowString, false),
                ">"
            ];
        }, enumType => [this.ourQualifier(inJsonNamespace), this.nameForNamedType(enumType)], unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable === null)
                return [this.ourQualifier(inJsonNamespace), this.nameForNamedType(unionType)];
            isOptional = true;
            return this.cppType(nullable, { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace }, withIssues, forceNarrowString, false);
        });
        if (!isOptional)
            return typeSource;
        return [
            optionalType,
            "<",
            typeSource,
            ">"
        ];
    }
    /**
     * similar to cppType, it practically gathers all the generated types within
     * 't'. It also records, whether a given sub-type is part of a variant or not.
     */
    generatedTypes(isClassMember, theType) {
        const result = [];
        const recur = (forceInclude, isVariant, l, t) => {
            if (t instanceof Type_1.ArrayType) {
                recur(forceInclude, isVariant, l + 1, t.items);
            }
            else if (t instanceof Type_1.ClassType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude: forceInclude
                });
            }
            else if (t instanceof Type_1.MapType) {
                recur(forceInclude, isVariant, l + 1, t.values);
            }
            else if (t instanceof Type_1.EnumType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude: false
                });
            }
            else if (t instanceof Type_1.UnionType) {
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
                        forceInclude: forceInclude
                    });
                    /** intentional "fall-through", add all subtypes as well - but forced include */
                }
                const [hasNull, nonNulls] = TypeUtils_1.removeNullFromUnion(t);
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
    constraintMember(jsonName) {
        return this._memberNameStyle(jsonName + "Constraint");
    }
    emitMember(cppType, name) {
        this.emitLine(cppType, " ", name, ";");
    }
    emitClassMembers(c, constraints) {
        if (this._options.codeFormat) {
            this.emitLine("private:");
            this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                this.emitMember(this.cppType(property.type, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true, false, property.isOptional), name);
                if (constraints !== undefined && constraints.has(jsonName)) {
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
                this.emitMember(this.cppType(property.type, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true, false, property.isOptional), name);
            }
            else {
                const [getterName, mutableGetterName, setterName] = Support_1.defined(this._gettersAndSettersForPropertyName.get(name));
                const rendered = this.cppType(property.type, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true, false, property.isOptional);
                /**
                 * fix for optional type -> e.g. unique_ptrs can't be copied
                 * One might as why the "this->xxx = value". Simple if we have
                 * a member called 'value' value = value will screw up the compiler
                 */
                const checkConst = this.lookupGlobalName(GlobalNames.CheckConstraint);
                if ((property.type instanceof Type_1.UnionType && property.type.findMember("null") !== undefined) || (property.isOptional && property.type.kind !== "null" && property.type.kind !== "any")) {
                    this.emitLine(rendered, " ", getterName, "() const { return ", name, "; }");
                    if (constraints !== undefined && constraints.has(jsonName)) {
                        this.emitLine("void ", setterName, "(", rendered, " value) { if (value) ", checkConst, "(", this._stringType.createStringLiteral([name]), ", ", this.constraintMember(jsonName), ", *value); this->", name, " = value; }");
                    }
                    else {
                        this.emitLine("void ", setterName, "(", rendered, " value) { this->", name, " = value; }");
                    }
                }
                else {
                    this.emitLine(this.withConst(rendered), " & ", getterName, "() const { return ", name, "; }");
                    this.emitLine(rendered, " & ", mutableGetterName, "() { return ", name, "; }");
                    if (constraints !== undefined && constraints.has(jsonName)) {
                        this.emitLine("void ", setterName, "(", this.withConst(rendered), " & value) { ", checkConst, "(", this._stringType.createStringLiteral([name]), ", ", this.constraintMember(jsonName), ", value); this->", name, " = value; }");
                    }
                    else {
                        this.emitLine("void ", setterName, "(", this.withConst(rendered), " & value) { this->", name, " = value; }");
                    }
                }
                this.ensureBlankLine();
            }
        });
    }
    generateClassConstraints(c) {
        let res = new Map();
        this.forEachClassProperty(c, "none", (_name, jsonName, property) => {
            const constraints = constraintsForType(property.type);
            if (constraints === undefined)
                return;
            const { minMax, minMaxLength, pattern } = constraints;
            res.set(jsonName, [
                this.constraintMember(jsonName),
                "(",
                (minMax !== undefined && minMax[0] !== undefined) ? String(minMax[0]) : this._nulloptType,
                ", ",
                (minMax !== undefined && minMax[1] !== undefined) ? String(minMax[1]) : this._nulloptType,
                ", ",
                (minMaxLength !== undefined && minMaxLength[0] !== undefined) ? String(minMaxLength[0]) : this._nulloptType,
                ", ",
                (minMaxLength !== undefined && minMaxLength[1] !== undefined) ? String(minMaxLength[1]) : this._nulloptType,
                ", ",
                (pattern === undefined) ? this._nulloptType : [this._stringType.getType(), "(", this._stringType.createStringLiteral([Strings_1.stringEscape(pattern)]), ")"],
                ")"
            ]);
        });
        return res.size === 0 ? undefined : res;
    }
    emitClass(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock([this._options.codeFormat ? "class " : "struct ", className], true, () => {
            const constraints = this.generateClassConstraints(c);
            if (this._options.codeFormat) {
                this.emitLine("public:");
                if (constraints === undefined) {
                    this.emitLine(className, "() = default;");
                }
                else {
                    this.emitLine(className, "() :");
                    let numEmits = 0;
                    constraints.forEach((initializer, _propName) => {
                        numEmits++;
                        this.indent(() => {
                            if (numEmits === constraints.size) {
                                this.emitLine(initializer);
                            }
                            else {
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
    emitTopLevelHeaders(t, className) {
        // Maps need ecoding conversions, since they have a string in the key. Other types don't.
        if (t instanceof Type_1.MapType && this._stringType !== this.NarrowString) {
            const ourQualifier = this.ourQualifier(true);
            this.emitLine("void from_json(", this.withConst("json"), " & j, ", ourQualifier, className, " & x);");
            this.emitLine("void to_json(json & j, ", this.withConst([ourQualifier, className]), " & x);");
        }
    }
    emitClassHeaders(className) {
        const ourQualifier = this.ourQualifier(true);
        this.emitLine("void from_json(", this.withConst("json"), " & j, ", ourQualifier, className, " & x);");
        this.emitLine("void to_json(json & j, ", this.withConst([ourQualifier, className]), " & x);");
    }
    emitTopLevelFunction(t, className) {
        // Maps need ecoding conversions, since they have a string in the key. Other types don't.
        if (t instanceof Type_1.MapType && this._stringType !== this.NarrowString) {
            const ourQualifier = this.ourQualifier(true);
            let cppType;
            let toType;
            this.emitBlock(["inline void from_json(", this.withConst("json"), " & j, ", ourQualifier, className, "& x)"], false, () => {
                cppType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, true, false);
                toType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, false, false);
                this.emitLine([
                    "x = ",
                    this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, ["j.get<", cppType, ">()"]),
                    ";"
                ]);
            });
            this.emitBlock(["inline void to_json(json & j, ", this.withConst([ourQualifier, className]), " & x)"], false, () => {
                cppType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, false, false);
                toType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, true, false);
                this.emitLine([
                    "j = ",
                    this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, "x"),
                    ";"
                ]);
            });
        }
    }
    emitClassFunctions(c, className) {
        const ourQualifier = this.ourQualifier(true);
        let cppType;
        let toType;
        this.emitBlock(["inline void from_json(", this.withConst("json"), " & j, ", ourQualifier, className, "& x)"], false, () => {
            this.forEachClassProperty(c, "none", (name, json, p) => {
                const [, , setterName] = Support_1.defined(this._gettersAndSettersForPropertyName.get(name));
                const t = p.type;
                let assignment;
                if (this._options.codeFormat) {
                    assignment = new WrappingCode(["x.", setterName, "("], [")"]);
                }
                else {
                    assignment = new WrappingCode(["x.", name, " = "], []);
                }
                if (t.kind === "null" || t.kind === "any") {
                    this.emitLine(assignment.wrap([], [
                        ourQualifier,
                        "get_untyped(j, ",
                        this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), [this._stringType.createStringLiteral([Strings_1.stringEscape(json)])]),
                        ")"
                    ]), ";");
                    return;
                }
                if (p.isOptional || t instanceof Type_1.UnionType) {
                    const [nullOrOptional, typeSet] = function () {
                        if (t instanceof Type_1.UnionType) {
                            const [maybeNull, nonNulls] = TypeUtils_1.removeNullFromUnion(t, true);
                            return [maybeNull !== null || p.isOptional, nonNulls];
                        }
                        else {
                            let set = new Set();
                            set.add(t);
                            return [true, set];
                        }
                    }();
                    if (nullOrOptional) {
                        cppType = this.cppTypeInOptional(typeSet, {
                            needsForwardIndirection: false,
                            needsOptionalIndirection: false,
                            inJsonNamespace: true
                        }, false, true);
                        toType = this.cppTypeInOptional(typeSet, {
                            needsForwardIndirection: false,
                            needsOptionalIndirection: false,
                            inJsonNamespace: true
                        }, false, false);
                        this.emitLine(assignment.wrap([], [
                            this._stringType.wrapEncodingChange([ourQualifier], [optionalType, "<", cppType, ">"], [optionalType, "<", toType, ">"], [
                                ourQualifier,
                                "get_optional<",
                                cppType,
                                ">(j, ",
                                this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), [this._stringType.createStringLiteral([Strings_1.stringEscape(json)])]),
                                ")"
                            ])
                        ]), ";");
                        return;
                    }
                }
                cppType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, true, p.isOptional);
                toType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, false, p.isOptional);
                this.emitLine(assignment.wrap([], this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, [
                    "j.at(",
                    this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), this._stringType.createStringLiteral([Strings_1.stringEscape(json)])),
                    ").get<",
                    cppType,
                    ">()"
                ])), ";");
            });
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json & j, ", this.withConst([ourQualifier, className]), " & x)"], false, () => {
            this.emitLine("j = json::object();");
            this.forEachClassProperty(c, "none", (name, json, p) => {
                const t = p.type;
                cppType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, false, p.isOptional);
                toType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, true, p.isOptional);
                const [getterName, ,] = Support_1.defined(this._gettersAndSettersForPropertyName.get(name));
                let getter;
                if (this._options.codeFormat) {
                    getter = [getterName, "()"];
                }
                else {
                    getter = [name];
                }
                let assignment = [
                    "j[",
                    this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), this._stringType.createStringLiteral([Strings_1.stringEscape(json)])),
                    "] = ",
                    this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, ["x.", getter]),
                    ";"
                ];
                if (p.isOptional && this._options.hideNullOptional) {
                    this.emitBlock(["if (", this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, ["x.", getter]), ")"], false, () => {
                        this.emitLine(assignment);
                    });
                }
                else {
                    this.emitLine(assignment);
                }
            });
        });
    }
    emitEnum(e, enumName) {
        const caseNames = [];
        const enumValues = EnumValues_1.enumCaseValues(e, this.targetLanguage.name);
        this.forEachEnumCase(e, "none", (name, jsonName) => {
            if (caseNames.length > 0)
                caseNames.push(", ");
            caseNames.push(name);
            if (enumValues !== undefined) {
                const [enumValue] = AccessorNames_1.getAccessorName(enumValues, jsonName);
                if (enumValue !== undefined) {
                    caseNames.push(" = ", enumValue.toString());
                }
            }
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum class ", enumName, " : ", this._enumType, " { ", caseNames, " };");
    }
    emitUnionTypedefs(u, unionName) {
        this.emitLine("using ", unionName, " = ", this.variantType(u, false), ";");
    }
    emitUnionHeaders(u) {
        const nonNulls = TypeUtils_1.removeNullFromUnion(u, true)[1];
        const variantType = this.cppTypeInOptional(nonNulls, { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true }, false, false);
        this.emitLine("void from_json(", this.withConst("json"), " & j, ", variantType, " & x);");
        this.emitLine("void to_json(json & j, ", this.withConst(variantType), " & x);");
    }
    emitUnionFunctions(u) {
        const ourQualifier = this.ourQualifier(true);
        const functionForKind = [
            ["bool", "is_boolean"],
            ["integer", "is_number_integer"],
            ["double", "is_number"],
            ["string", "is_string"],
            ["class", "is_object"],
            ["map", "is_object"],
            ["array", "is_array"],
            ["enum", "is_string"]
        ];
        const nonNulls = TypeUtils_1.removeNullFromUnion(u, true)[1];
        const variantType = this.cppTypeInOptional(nonNulls, { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true }, false, false);
        this.emitBlock(["inline void from_json(", this.withConst("json"), " & j, ", variantType, " & x)"], false, () => {
            let onFirst = true;
            for (const [kind, func] of functionForKind) {
                const typeForKind = collection_utils_1.iterableFind(nonNulls, t => t.kind === kind);
                if (typeForKind === undefined)
                    continue;
                this.emitLine(onFirst ? "if" : "else if", " (j.", func, "())");
                this.indent(() => {
                    const cppType = this.cppType(typeForKind, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, true, false);
                    let toType = this.cppType(typeForKind, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, false, false);
                    this.emitLine("x = ", this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, [
                        "j.get<",
                        cppType,
                        ">()"
                    ]), ";");
                });
                onFirst = false;
            }
            this.emitLine('else throw "Could not deserialize";');
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json & j, ", this.withConst(variantType), " & x)"], false, () => {
            this.emitBlock(["switch (x.", this._variantIndexMethodName, "())"], false, () => {
                let i = 0;
                for (const t of nonNulls) {
                    this.emitLine("case ", i.toString(), ":");
                    this.indent(() => {
                        const cppType = this.cppType(t, {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: true
                        }, false, false, false);
                        const toType = this.cppType(t, {
                            needsForwardIndirection: true,
                            needsOptionalIndirection: true,
                            inJsonNamespace: true
                        }, false, true, false);
                        this.emitLine("j = ", this._stringType.wrapEncodingChange([ourQualifier], cppType, toType, [
                            this._options.boost ? "boost::get<" : "std::get<",
                            cppType,
                            ">(x)"
                        ]), ";");
                        this.emitLine("break;");
                    });
                    i++;
                }
                this.emitLine('default: throw "Input JSON does not conform to schema";');
            });
        });
    }
    emitEnumHeaders(enumName) {
        const ourQualifier = this.ourQualifier(true);
        this.emitLine("void from_json(", this.withConst("json"), " & j, ", ourQualifier, enumName, " & x);");
        this.emitLine("void to_json(json & j, ", this.withConst([ourQualifier, enumName]), " & x);");
    }
    isLargeEnum(e) {
        // This is just an estimation. Someone might want to do some
        // benchmarks to find the optimum value here
        return e.cases.size > 15;
    }
    emitEnumFunctions(e, enumName) {
        const ourQualifier = this.ourQualifier(true);
        this.emitBlock(["inline void from_json(", this.withConst("json"), " & j, ", ourQualifier, enumName, " & x)"], false, () => {
            if (this.isLargeEnum(e)) {
                this.emitBlock(["static std::unordered_map<", this._stringType.getType(), ", ", ourQualifier, enumName, "> enumValues"], true, () => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        this.emitLine("{", this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), [this._stringType.createStringLiteral([Strings_1.stringEscape(jsonName)])]), ", ", ourQualifier, enumName, "::", name, "},");
                    });
                });
                this.emitLine(`auto iter = enumValues.find(j.get<${this._stringType.getType()}>());`);
                this.emitBlock("if (iter != enumValues.end())", false, () => {
                    this.emitLine("x = iter->second;");
                });
            }
            else {
                let onFirst = true;
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    const maybeElse = onFirst ? "" : "else ";
                    this.emitLine(maybeElse, "if (j == ", this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), [this._stringType.createStringLiteral([Strings_1.stringEscape(jsonName)])]), ") x = ", ourQualifier, enumName, "::", name, ";");
                    onFirst = false;
                });
                this.emitLine('else throw "Input JSON does not conform to schema";');
            }
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json & j, ", this.withConst([ourQualifier, enumName]), " & x)"], false, () => {
            this.emitBlock("switch (x)", false, () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", ourQualifier, enumName, "::", name, ": j = ", this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), [this._stringType.createStringLiteral([Strings_1.stringEscape(jsonName)])]), "; break;");
                });
                this.emitLine('default: throw "This should not happen";');
            });
        });
    }
    emitTopLevelTypedef(t, name) {
        this.emitLine("using ", name, " = ", this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false }, true, false, false), ";");
    }
    emitAllUnionFunctions() {
        this.forEachUniqueUnion("interposing", u => this.sourcelikeToString(this.cppTypeInOptional(TypeUtils_1.removeNullFromUnion(u, true)[1], { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true }, false, false)), (u) => this.emitUnionFunctions(u));
    }
    emitAllUnionHeaders() {
        this.forEachUniqueUnion("interposing", u => this.sourcelikeToString(this.cppTypeInOptional(TypeUtils_1.removeNullFromUnion(u, true)[1], { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true }, false, false)), (u) => this.emitUnionHeaders(u));
    }
    emitOptionalHelpers() {
        this.emitLine("#ifndef NLOHMANN_OPT_HELPER");
        this.emitLine("#define NLOHMANN_OPT_HELPER");
        this.emitNamespaces(["nlohmann"], () => {
            this.emitLine("template <typename T>");
            this.emitBlock(["struct adl_serializer<", optionalType, "<T>>"], true, () => {
                this.emitBlock(["static void to_json(json & j, ", this.withConst([optionalType, "<T>"]), " & opt)"], false, () => {
                    this.emitLine("if (!opt) j = nullptr; else j = *opt;");
                });
                this.ensureBlankLine();
                this.emitBlock(["static ", optionalType, "<T> from_json(", this.withConst("json"), " & j)"], false, () => {
                    this.emitLine(`if (j.is_null()) return std::unique_ptr<T>(); else return std::unique_ptr<T>(new T(j.get<T>()));`);
                });
            });
        });
        this.emitLine("#endif");
    }
    emitDeclaration(decl) {
        if (decl.kind === "forward") {
            if (this._options.codeFormat) {
                this.emitLine("class ", this.nameForNamedType(decl.type), ";");
            }
            else {
                this.emitLine("struct ", this.nameForNamedType(decl.type), ";");
            }
        }
        else if (decl.kind === "define") {
            const t = decl.type;
            const name = this.nameForNamedType(t);
            if (t instanceof Type_1.ClassType) {
                this.emitClass(t, name);
            }
            else if (t instanceof Type_1.EnumType) {
                this.emitEnum(t, name);
            }
            else if (t instanceof Type_1.UnionType) {
                this.emitUnionTypedefs(t, name);
            }
            else {
                return Support_1.panic(`Cannot declare type ${t.kind}`);
            }
        }
        else {
            return Support_1.assertNever(decl.kind);
        }
    }
    emitGetterSetter(t, getterName, setterName, memberName) {
        this.emitLine("void ", setterName, "(", t, " ", memberName, ") { this->", memberName, " = ", memberName, "; }");
        this.emitLine("auto ", getterName, "() const { return ", memberName, "; }");
    }
    emitConstraintClasses() {
        const ourQualifier = this.ourQualifier(false);
        const getterMinValue = this.lookupMemberName(MemberNames.GetMinValue);
        const getterMaxValue = this.lookupMemberName(MemberNames.GetMaxValue);
        const getterMinLength = this.lookupMemberName(MemberNames.GetMinLength);
        const getterMaxLength = this.lookupMemberName(MemberNames.GetMaxLength);
        const getterPattern = this.lookupMemberName(MemberNames.GetPattern);
        const classConstraint = this.lookupGlobalName(GlobalNames.ClassMemberConstraints);
        this.emitBlock(["class ", classConstraint], true, () => {
            this.emitLine("private:");
            let constraintMembers = this.getConstraintMembers();
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
            this.emitLine(") : ", collection_utils_1.arrayIntercalate([", "], args), " {}");
            this.emitLine(classConstraint, "() = default;");
            this.emitLine("virtual ~", classConstraint, "() = default;");
            for (const member of constraintMembers) {
                this.ensureBlankLine();
                this.emitGetterSetter(collection_utils_1.withDefault(member.cppConstType, member.cppType), this.lookupMemberName(member.getter), this.lookupMemberName(member.setter), this.lookupMemberName(member.name));
            }
        });
        this.ensureBlankLine();
        const classConstEx = this.lookupGlobalName(GlobalNames.ClassMemberConstraintException);
        this.emitBlock(["class ", classConstEx, " : public std::runtime_error"], true, () => {
            this.emitLine("public:");
            this.emitLine(classConstEx, "(", this._stringType.getConstType(), " msg) : std::runtime_error(", this._stringType.wrapEncodingChange([ourQualifier], this._stringType.getType(), this.NarrowString.getType(), ["msg"]), ") {}");
        });
        this.ensureBlankLine();
        const exceptions = [
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
        this.emitBlock(["inline void ", checkConst, "(", this._stringType.getConstType(), " name, ", this.withConst(classConstraint), " & c, int64_t value)"], false, () => {
            this.emitBlock(["if (c.", getterMinValue, "() != ", this._nulloptType, " && value < *c.", getterMinValue, "())"], false, () => {
                this.emitLine("throw ", this.lookupGlobalName(GlobalNames.ValueTooLowException), " (", this._stringType.createStringLiteral(["Value too low for "]), " + name + ", this._stringType.createStringLiteral([" ("]), " + ", this._stringType.wrapToString(["value"]), " + ", this._stringType.createStringLiteral(["<"]), " + ", this._stringType.wrapToString(["*c.", getterMinValue, "()"]), " + ", this._stringType.createStringLiteral([")"]), ");");
            });
            this.ensureBlankLine();
            this.emitBlock(["if (c.", getterMaxValue, "() != ", this._nulloptType, " && value > *c.", getterMaxValue, "())"], false, () => {
                this.emitLine("throw ", this.lookupGlobalName(GlobalNames.ValueTooHighException), " (", this._stringType.createStringLiteral(["Value too high for "]), " + name + ", this._stringType.createStringLiteral([" ("]), " + ", this._stringType.wrapToString(["value"]), " + ", this._stringType.createStringLiteral([">"]), " + ", this._stringType.wrapToString(["*c.", getterMaxValue, "()"]), " + ", this._stringType.createStringLiteral([")"]), ");");
            });
            this.ensureBlankLine();
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void ", checkConst, "(", this._stringType.getConstType(), " name, ", this.withConst(classConstraint), " & c, ", this._stringType.getConstType(), " value)"], false, () => {
            this.emitBlock(["if (c.", getterMinLength, "() != ", this._nulloptType, " && value.length() < *c.", getterMinLength, "())"], false, () => {
                this.emitLine("throw ", this.lookupGlobalName(GlobalNames.ValueTooShortException), " (", this._stringType.createStringLiteral(["Value too short for "]), " + name + ", this._stringType.createStringLiteral([" ("]), " + ", this._stringType.wrapToString(["value.length()"]), " + ", this._stringType.createStringLiteral(["<"]), " + ", this._stringType.wrapToString(["*c.", getterMinLength, "()"]), " + ", this._stringType.createStringLiteral([")"]), ");");
            });
            this.ensureBlankLine();
            this.emitBlock(["if (c.", getterMaxLength, "() != ", this._nulloptType, " && value.length() > *c.", getterMaxLength, "())"], false, () => {
                this.emitLine("throw ", this.lookupGlobalName(GlobalNames.ValueTooLongException), " (", this._stringType.createStringLiteral(["Value too long for "]), " + name + ", this._stringType.createStringLiteral([" ("]), " + ", this._stringType.wrapToString(["value.length()"]), " + ", this._stringType.createStringLiteral([">"]), " + ", this._stringType.wrapToString(["*c.", getterMaxLength, "()"]), " + ", this._stringType.createStringLiteral([")"]), ");");
            });
            this.ensureBlankLine();
            this.emitBlock(["if (c.", getterPattern, "() != ", this._nulloptType, ")"], false, () => {
                this.emitLine(this._stringType.getSMatch(), " result;");
                this.emitLine("std::regex_search(value, result, ", this._stringType.getRegex(), "( *c.", getterPattern, "() ));");
                this.emitBlock(["if (result.empty())"], false, () => {
                    this.emitLine("throw ", this.lookupGlobalName(GlobalNames.InvalidPatternException), " (", this._stringType.createStringLiteral(["Value doesn't match pattern for "]), " + name + ", this._stringType.createStringLiteral([" ("]), " + value +", this._stringType.createStringLiteral([" != "]), " + *c.", getterPattern, "() + ", this._stringType.createStringLiteral([")"]), ");");
                });
            });
            this.ensureBlankLine();
        });
    }
    emitHelperFunctions() {
        this._stringType.emitHelperFunctions();
        if (this._options.codeFormat &&
            collection_utils_1.iterableSome(this.typeGraph.allTypesUnordered(), t => constraintsForType(t) !== undefined)) {
            this.emitConstraintClasses();
            this.ensureBlankLine();
        }
        this.emitBlock([
            "inline json get_untyped(", this.withConst("json"), " & j, ", this.withConst("char"), " * property)"
        ], false, () => {
            this.emitBlock(["if (j.find(property) != j.end())"], false, () => {
                this.emitLine("return j.at(property).get<json>();");
            });
            this.emitLine("return json();");
        });
        this.ensureBlankLine();
        this.emitBlock([
            "inline json get_untyped(", this.withConst("json"), " & j, std::string property)"
        ], false, () => {
            this.emitLine("return get_untyped(j, property.data());");
        });
        this.ensureBlankLine();
        if (this.haveUnions || this.haveOptionalProperties) {
            this.emitLine("template <typename T>");
            this.emitBlock(["inline ", optionalType, "<T> get_optional(", this.withConst("json"), " & j, ", this.withConst("char"), " * property)"], false, () => {
                this.emitBlock(["if (j.find(property) != j.end())"], false, () => {
                    this.emitLine("return j.at(property).get<", optionalType, "<T>>();");
                });
                this.emitLine("return ", optionalType, "<T>();");
            });
            this.ensureBlankLine();
            this.emitLine("template <typename T>");
            this.emitBlock(["inline ", optionalType, "<T> get_optional(", this.withConst("json"), " & j, std::string property)"], false, () => {
                this.emitLine("return get_optional<T>(j, property.data());");
            });
            this.ensureBlankLine();
        }
    }
    emitExtraIncludes() {
        this.ensureBlankLine();
        if (this._options.codeFormat) {
            if (this._options.boost) {
                this.emitInclude(true, `boost/optional.hpp`);
            }
            else {
                this.emitInclude(true, `optional`);
            }
            this.emitInclude(true, `stdexcept`);
            this.emitInclude(true, `regex`);
        }
        if (this._options.wstring) {
            this.emitInclude(true, `codecvt`);
            this.emitInclude(true, `locale`);
        }
        // Include unordered_map if contains large enums
        if (Array.from(this.enums).some(enumType => this.isLargeEnum(enumType))) {
            this.emitInclude(true, `unordered_map`);
        }
        this.ensureBlankLine();
    }
    emitHelper() {
        this.startFile("helper.hpp", false);
        this.emitExtraIncludes();
        this.emitInclude(true, `sstream`);
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
    emitTypes() {
        if (!this._options.justTypes) {
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitHelperFunctions();
        }
        this.forEachDeclaration("interposing", decl => this.emitDeclaration(decl));
        if (this._options.justTypes)
            return;
        this.forEachTopLevel("leading", (t, name) => this.emitTopLevelTypedef(t, name), t => this.namedTypeToNameForTopLevel(t) === undefined);
    }
    emitGenerators() {
        let didEmit = false;
        const gathered = this.gatherSource(() => this.emitNamespaces(this._namespaceNames, () => {
            didEmit = this.forEachTopLevel("none", (t, name) => this.emitTopLevelTypedef(t, name), t => this.namedTypeToNameForTopLevel(t) === undefined);
        }));
        if (didEmit) {
            this.emitGatheredSource(gathered);
            this.ensureBlankLine();
        }
        if (!this._options.justTypes) {
            let namespaces = ["nlohmann"];
            if (this._options.msbuildPermissive) {
                namespaces = ["nlohmann", "detail"];
            }
            this.emitNamespaces(namespaces, () => {
                this.forEachObject("leading-and-interposing", (_, className) => this.emitClassHeaders(className));
                this.forEachTopLevel("leading-and-interposing", (t, className) => this.emitTopLevelHeaders(t, className));
                this.forEachEnum("leading-and-interposing", (_, enumName) => this.emitEnumHeaders(enumName));
                if (this.haveUnions) {
                    this.emitAllUnionHeaders();
                }
                this.ensureBlankLine();
                this.forEachObject("leading-and-interposing", (c, className) => this.emitClassFunctions(c, className));
                this.forEachEnum("leading-and-interposing", (e, enumName) => this.emitEnumFunctions(e, enumName));
                if (this.haveUnions) {
                    this.emitAllUnionFunctions();
                }
                this.forEachTopLevel("leading-and-interposing", (t, name) => this.emitTopLevelFunction(t, name), t => this.namedTypeToNameForTopLevel(t) === undefined);
            });
        }
    }
    emitSingleSourceStructure(proposedFilename) {
        this.startFile(proposedFilename);
        this._generatedFiles.add(proposedFilename);
        this.emitExtraIncludes();
        if (this._options.justTypes) {
            this.emitTypes();
        }
        else {
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
    updateIncludes(isClassMember, includes, propertyType, _defName) {
        const propTypes = this.generatedTypes(isClassMember, propertyType);
        for (const t of propTypes) {
            const typeName = this.sourcelikeToString(t.name);
            let propRecord = { kind: undefined, typeKind: undefined };
            if (t.type instanceof Type_1.ClassType) {
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
            }
            else if (t.type instanceof Type_1.EnumType) {
                propRecord.typeKind = "enum";
                propRecord.kind = IncludeKind.ForwardDeclare;
            }
            else if (t.type instanceof Type_1.UnionType) {
                propRecord.typeKind = "union";
                /** Recurse into the union */
                const [maybeNull] = TypeUtils_1.removeNullFromUnion(t.type, true);
                if (maybeNull !== undefined) {
                    /** Houston this is a variant, include it */
                    propRecord.kind = IncludeKind.Include;
                }
                else {
                    if (t.forceInclude) {
                        propRecord.kind = IncludeKind.Include;
                    }
                    else {
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
            }
            else {
                includes.set(typeName, propRecord);
            }
        }
    }
    emitIncludes(c, defName) {
        /**
         * Need to generate "includes", in terms 'c' has members, which
         * are defined by others
         */
        let includes = new Map();
        if (c instanceof Type_1.UnionType) {
            this.updateIncludes(false, includes, c, defName);
        }
        else if (c instanceof Type_1.ClassType) {
            this.forEachClassProperty(c, "none", (_name, _jsonName, property) => {
                this.updateIncludes(true, includes, property.type, defName);
            });
        }
        if (includes.size !== 0) {
            let numForwards = 0;
            let numIncludes = 0;
            includes.forEach((rec, name) => {
                /** Don't bother including the one we are defining */
                if (name === defName) {
                    return;
                }
                if (rec.kind !== IncludeKind.ForwardDeclare) {
                    this.emitInclude(false, [name, ".hpp"]);
                    numIncludes++;
                }
                else {
                    numForwards++;
                }
            });
            if (numIncludes > 0) {
                this.ensureBlankLine();
            }
            if (numForwards > 0) {
                this.emitNamespaces(this._namespaceNames, () => {
                    includes.forEach((rec, name) => {
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
                            }
                            else {
                                this.emitLine("struct ", name, ";");
                            }
                        }
                        else if (rec.typeKind === "enum") {
                            this.emitLine("enum class ", name, " : ", this._enumType, ";");
                        }
                        else {
                            Support_1.panic(`Invalid type "${rec.typeKind}" to forward declare`);
                        }
                    });
                });
            }
            this.ensureBlankLine();
        }
    }
    emitDefinition(d, defName) {
        const name = this.sourcelikeToString(defName) + ".hpp";
        this.startFile(name, true);
        this._generatedFiles.add(name);
        this.emitIncludes(d, this.sourcelikeToString(defName));
        this.emitNamespaces(this._namespaceNames, () => {
            this.emitDescription(this.descriptionForType(d));
            this.ensureBlankLine();
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            if (d instanceof Type_1.ClassType) {
                this.emitClass(d, defName);
            }
            else if (d instanceof Type_1.EnumType) {
                this.emitEnum(d, defName);
            }
            else if (d instanceof Type_1.UnionType) {
                this.emitUnionTypedefs(d, defName);
            }
        });
        this.finishFile();
    }
    emitMultiSourceStructure(proposedFilename) {
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
        this.forEachNamedType("leading-and-interposing", (c, n) => {
            this.emitDefinition(c, n);
        }, (e, n) => {
            this.emitDefinition(e, n);
        }, (u, n) => {
            this.emitDefinition(u, n);
        });
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
                this.forEachTopLevel("leading", (t, name) => this.emitTopLevelTypedef(t, name), t => this.namedTypeToNameForTopLevel(t) === undefined);
            });
            this.finishFile();
        }
    }
    emitSourceStructure(proposedFilename) {
        this._generatedFiles.clear();
        /** Gather all the unique/custom types used by the schema */
        this._allTypeNames.clear();
        this.forEachDeclaration("none", decl => {
            const definedTypes = TypeUtils_1.directlyReachableTypes(decl.type, t => {
                if (TypeUtils_1.isNamedType(t) && (t instanceof Type_1.ClassType || t instanceof Type_1.EnumType || t instanceof Type_1.UnionType)) {
                    return new Set([
                        this.sourcelikeToString(this.cppType(t, {
                            needsForwardIndirection: false,
                            needsOptionalIndirection: false,
                            inJsonNamespace: false
                        }, true, false, false))
                    ]);
                }
                return null;
            });
            this._allTypeNames = collection_utils_1.setUnion(definedTypes, this._allTypeNames);
        });
        if (this._options.typeSourceStyle) {
            this.emitSingleSourceStructure(proposedFilename);
        }
        else {
            this.emitMultiSourceStructure(proposedFilename);
        }
    }
    isConversionRequired(t) {
        let originalType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, false, false);
        let newType = this.cppType(t, { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true }, false, true, false);
        return originalType !== newType;
    }
}
exports.CPlusPlusRenderer = CPlusPlusRenderer;
