import { arrayIntercalate } from "collection-utils";

import {
    Type,
    EnumType,
    UnionType,
    ClassType,
    ClassProperty,
    ArrayType,
    TransformedStringTypeKind,
    PrimitiveStringTypeKind,
    PrimitiveType
} from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    camelCase,
    WordInName
} from "../support/Strings";
import { defined, assert, panic, assertNever } from "../support/Support";
import { Name, DependencyName, Namer, funPrefixNamer, SimpleName } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo, inferredNameOrder } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { StringOption, EnumOption, Option, BooleanOption, OptionValues, getOptionValues } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { StringTypeMapping } from "../TypeBuilder";
import {
    followTargetType,
    transformationForType,
    Transformer,
    DecodingTransformer,
    DecodingChoiceTransformer,
    UnionInstantiationTransformer,
    ChoiceTransformer,
    UnionMemberMatchTransformer,
    EncodingTransformer,
    StringMatchTransformer,
    StringProducerTransformer,
    ParseStringTransformer,
    StringifyTransformer,
    Transformation,
    ArrayDecodingTransformer,
    ArrayEncodingTransformer,
    MinMaxLengthCheckTransformer,
    MinMaxValueTransformer
} from "../Transformers";
import { RenderContext } from "../Renderer";
import { minMaxLengthForType, minMaxValueForType } from "../attributes/Constraints";
import unicode from "unicode-properties";

export enum Framework {
    Newtonsoft,
    SystemTextJson
}

export type Version = 5 | 6;
export type OutputFeatures = { helpers: boolean; attributes: boolean };

export enum AccessModifier {
    None,
    Public,
    Internal
}

export type CSharpTypeForAny = "object" | "dynamic";

function noFollow(t: Type): Type {
    return t;
}

function needTransformerForType(t: Type): "automatic" | "manual" | "nullable" | "none" {
    if (t instanceof UnionType) {
        const maybeNullable = nullableFromUnion(t);
        if (maybeNullable === null) return "automatic";
        if (needTransformerForType(maybeNullable) === "manual") return "nullable";
        return "none";
    }
    if (t instanceof ArrayType) {
        const itemsNeed = needTransformerForType(t.items);
        if (itemsNeed === "manual" || itemsNeed === "nullable") return "automatic";
        return "none";
    }
    if (t instanceof EnumType) return "automatic";
    if (t.kind === "double") return minMaxValueForType(t) !== undefined ? "manual" : "none";
    if (t.kind === "integer-string" || t.kind === "bool-string") return "manual";
    if (t.kind === "string") {
        return minMaxLengthForType(t) !== undefined ? "manual" : "none";
    }
    return "none";
}

function alwaysApplyTransformation(xf: Transformation): boolean {
    const t = xf.targetType;
    if (t instanceof EnumType) return true;
    if (t instanceof UnionType) return nullableFromUnion(t) === null;
    return false;
}

/**
 * The C# type for a given transformed string type.
 */
function csTypeForTransformedStringType(t: PrimitiveType): Sourcelike {
    switch (t.kind) {
        case "date-time":
            return "DateTimeOffset";
        case "uuid":
            return "Guid";
        case "uri":
            return "Uri";
        default:
            return panic(`Transformed string type ${t.kind} not supported`);
    }
}

export const cSharpOptions = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        [
            ["NewtonSoft", Framework.Newtonsoft],
            ["SystemTextJson", Framework.SystemTextJson]
        ],
        "NewtonSoft"
    ),
    useList: new EnumOption("array-type", "Use T[] or List<T>", [
        ["array", false],
        ["list", true]
    ]),
    dense: new EnumOption(
        "density",
        "Property density",
        [
            ["normal", false],
            ["dense", true]
        ],
        "normal",
        "secondary"
    ),
    // FIXME: Do this via a configurable named eventually.
    namespace: new StringOption("namespace", "Generated namespace", "NAME", "QuickType"),
    version: new EnumOption<Version>(
        "csharp-version",
        "C# version",
        [
            ["5", 5],
            ["6", 6]
        ],
        "6",
        "secondary"
    ),
    virtual: new BooleanOption("virtual", "Generate virtual properties", false),
    typeForAny: new EnumOption<CSharpTypeForAny>(
        "any-type",
        'Type to use for "any"',
        [
            ["object", "object"],
            ["dynamic", "dynamic"]
        ],
        "object",
        "secondary"
    ),
    useDecimal: new EnumOption(
        "number-type",
        "Type to use for numbers",
        [
            ["double", false],
            ["decimal", true]
        ],
        "double",
        "secondary"
    ),
    features: new EnumOption("features", "Output features", [
        ["complete", { namespaces: true, helpers: true, attributes: true }],
        ["attributes-only", { namespaces: true, helpers: false, attributes: true }],
        ["just-types-and-namespace", { namespaces: true, helpers: false, attributes: false }],
        ["just-types", { namespaces: true, helpers: false, attributes: false }]
    ]),
    baseclass: new EnumOption(
        "base-class",
        "Base class",
        [
            ["EntityData", "EntityData"],
            ["Object", undefined]
        ],
        "Object",
        "secondary"
    ),
    checkRequired: new BooleanOption("check-required", "Fail if required properties are missing", false),
    keepPropertyName: new BooleanOption("keep-property-name", "Keep original field name generate", false),
};

export class CSharpTargetLanguage extends TargetLanguage {
    constructor() {
        super("C#", ["cs", "csharp"], "cs");
    }

    protected getOptions(): Option<any>[] {
        return [
            cSharpOptions.framework,
            cSharpOptions.namespace,
            cSharpOptions.version,
            cSharpOptions.dense,
            cSharpOptions.useList,
            cSharpOptions.useDecimal,
            cSharpOptions.typeForAny,
            cSharpOptions.virtual,
            cSharpOptions.features,
            cSharpOptions.baseclass,
            cSharpOptions.checkRequired,
            cSharpOptions.keepPropertyName
        ];
    }

    get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        mapping.set("date", "date-time");
        mapping.set("time", "date-time");
        mapping.set("date-time", "date-time");
        mapping.set("uuid", "uuid");
        mapping.set("uri", "uri");
        mapping.set("integer-string", "integer-string");
        mapping.set("bool-string", "bool-string");
        return mapping;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    needsTransformerForType(t: Type): boolean {
        const need = needTransformerForType(t);
        return need !== "none" && need !== "nullable";
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): ConvenienceRenderer {
        const options = getOptionValues(cSharpOptions, untypedOptionValues);

        switch (options.framework) {
            case Framework.Newtonsoft:
                return new NewtonsoftCSharpRenderer(
                    this,
                    renderContext,
                    getOptionValues(newtonsoftCSharpOptions, untypedOptionValues)
                );
            case Framework.SystemTextJson:
                return new SystemTextJsonCSharpRenderer(
                    this,
                    renderContext,
                    getOptionValues(systemTextJsonCSharpOptions, untypedOptionValues)
                );
            default:
                return assertNever(options.framework);
        }
    }
}

const namingFunction = funPrefixNamer("namer", csNameStyle);
const namingFunctionKeep = funPrefixNamer("namerKeep", csNameStyleKeep);

// FIXME: Make a Named?
const denseJsonPropertyName = "J";
const denseRequiredEnumName = "R";
const denseNullValueHandlingEnumName = "N";

function isStartCharacter(utf16Unit: number): boolean {
    if (unicode.isAlphabetic(utf16Unit)) {
        return true;
    }
    return utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    if (["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0) {
        return true;
    }
    return isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function csNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        firstUpperWordStyle,
        firstUpperWordStyle,
        "",
        isStartCharacter
    );
}

function csNameStyleKeep(original: string): string {

    const keywords = [
        "abstract",
        "as",
        "base",
        "bool",
        "break",
        "byte",
        "case",
        "catch",
        "char",
        "checked",
        "class",
        "const",
        "continue",
        "decimal",
        "default",
        "delegate",
        "do",
        "double",
        "else",
        "enum",
        "event",
        "explicit",
        "extern",
        "false",
        "finally",
        "fixed",
        "float",
        "for",
        "foreach",
        "goto",
        "if",
        "implicit",
        "in",
        "int",
        "interface",
        "internal",
        "is",
        "lock",
        "long",
        "namespace",
        "new",
        "null",
        "object",
        "operator",
        "out",
        "override",
        "params",
        "private",
        "protected",
        "public",
        "readonly",
        "ref",
        "return",
        "sbyte",
        "sealed",
        "short",
        "sizeof",
        "stackalloc",
        "static",
        "string",
        "struct",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "uint",
        "ulong",
        "unchecked",
        "unsafe",
        "ushort",
        "using",
        "virtual",
        "void",
        "volatile",
        "while",
    ]

    const words: WordInName[] = [
        {
            word: original,
            isAcronym: false
        }
    ];

    const result = combineWords(
        words,
        legalizeName,
        x => x,
        x => x,
        x => x,
        x => x,
        "",
        isStartCharacter
    )

    return keywords.includes(result) ? "@" + result : result;
}

function isValueType(t: Type): boolean {
    if (t instanceof UnionType) {
        return nullableFromUnion(t) === null;
    }
    return ["integer", "double", "bool", "enum", "date-time", "uuid"].indexOf(t.kind) >= 0;
}

export class CSharpRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _csOptions: OptionValues<typeof cSharpOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["QuickType", "Type", "System", "Console", "Exception", "DateTimeOffset", "Guid", "Uri"];
    }

    protected forbiddenForObjectProperties(_: ClassType, classNamed: Name): ForbiddenWordsInfo {
        return {
            names: [
                classNamed,
                "ToString",
                "GetHashCode",
                "Finalize",
                "Equals",
                "GetType",
                "MemberwiseClone",
                "ReferenceEquals"
            ],
            includeGlobalForbidden: false
        };
    }

    protected forbiddenForUnionMembers(_: UnionType, unionNamed: Name): ForbiddenWordsInfo {
        return { names: [unionNamed], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return this._csOptions.keepPropertyName ? namingFunctionKeep : namingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return namingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return namingFunction;
    }

    protected unionNeedsName(u: UnionType): boolean {
        return nullableFromUnion(u) === null;
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.
        return directlyReachableSingleNamedType(type);
    }

    protected emitBlock(f: () => void, semicolon = false): void {
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}", semicolon ? ";" : "");
    }

    protected get doubleType(): string {
        return this._csOptions.useDecimal ? "decimal" : "double";
    }

    protected csType(t: Type, follow: (t: Type) => Type = followTargetType, withIssues = false): Sourcelike {
        const actualType = follow(t);
        return matchType<Sourcelike>(
            actualType,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, this._csOptions.typeForAny),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, this._csOptions.typeForAny),
            _boolType => "bool",
            _integerType => "long",
            _doubleType => this.doubleType,
            _stringType => "string",
            arrayType => {
                const itemsType = this.csType(arrayType.items, follow, withIssues);
                if (this._csOptions.useList) {
                    return ["List<", itemsType, ">"];
                } else {
                    return [itemsType, "[]"];
                }
            },
            classType => this.nameForNamedType(classType),
            mapType => ["Dictionary<string, ", this.csType(mapType.values, follow, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.nullableCSType(nullable, noFollow);
                return this.nameForNamedType(unionType);
            },
            transformedStringType => csTypeForTransformedStringType(transformedStringType)
        );
    }

    protected nullableCSType(t: Type, follow: (t: Type) => Type = followTargetType, withIssues = false): Sourcelike {
        t = followTargetType(t);
        const csType = this.csType(t, follow, withIssues);
        if (isValueType(t)) {
            return [csType, "?"];
        } else {
            return csType;
        }
    }
    protected baseclassForType(_t: Type): Sourcelike | undefined {
        return undefined;
    }
    protected emitType(
        description: string[] | undefined,
        accessModifier: AccessModifier,
        declaration: Sourcelike,
        name: Sourcelike,
        baseclass: Sourcelike | undefined,
        emitter: () => void
    ): void {
        switch (accessModifier) {
            case AccessModifier.Public:
                declaration = ["public ", declaration];
                break;
            case AccessModifier.Internal:
                declaration = ["internal ", declaration];
                break;
            default:
                break;
        }
        this.emitDescription(description);
        if (baseclass === undefined) {
            this.emitLine(declaration, " ", name);
        } else {
            this.emitLine(declaration, " ", name, " : ", baseclass);
        }
        this.emitBlock(emitter);
    }

    protected attributesForProperty(
        _property: ClassProperty,
        _name: Name,
        _c: ClassType,
        _jsonName: string
    ): Sourcelike[] | undefined {
        return undefined;
    }

    protected propertyDefinition(property: ClassProperty, name: Name, _c: ClassType, _jsonName: string): Sourcelike {
        const t = property.type;
        const csType = property.isOptional
            ? this.nullableCSType(t, followTargetType, true)
            : this.csType(t, followTargetType, true);

        const propertyArray = ["public "];

        if (this._csOptions.virtual) propertyArray.push("virtual ");

        return [...propertyArray, csType, " ", name, " { get; set; }"];
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        const start = "/// <summary>";
        if (this._csOptions.dense) {
            this.emitLine(start, lines.join("; "), "</summary>");
        } else {
            this.emitCommentLines(lines, "/// ", start, "/// </summary>");
        }
    }

    protected blankLinesBetweenAttributes(): boolean {
        return false;
    }

    private emitClassDefinition(c: ClassType, className: Name): void {
        this.emitType(
            this.descriptionForType(c),
            AccessModifier.Public,
            "partial class",
            className,
            this.baseclassForType(c),
            () => {
                if (c.getProperties().size === 0) return;
                const blankLines = this.blankLinesBetweenAttributes() ? "interposing" : "none";
                let columns: Sourcelike[][] = [];
                let isFirstProperty = true;
                let previousDescription: string[] | undefined = undefined;
                this.forEachClassProperty(c, blankLines, (name, jsonName, p) => {
                    const attributes = this.attributesForProperty(p, name, c, jsonName);
                    const description = this.descriptionForClassProperty(c, jsonName);
                    const property = this.propertyDefinition(p, name, c, jsonName);
                    if (attributes === undefined) {
                        if (
                            // Descriptions should be preceded by an empty line
                            (!isFirstProperty && description !== undefined) ||
                            // If the previous property has a description, leave an empty line
                            previousDescription !== undefined
                        ) {
                            this.ensureBlankLine();
                        }
                        this.emitDescription(description);
                        this.emitLine(property);
                    } else if (this._csOptions.dense && attributes.length > 0) {
                        const comment = description === undefined ? "" : ` // ${description.join("; ")}`;
                        columns.push([attributes, " ", property, comment]);
                    } else {
                        this.emitDescription(description);
                        for (const attribute of attributes) {
                            this.emitLine(attribute);
                        }
                        this.emitLine(property);
                    }

                    isFirstProperty = false;
                    previousDescription = description;
                });
                if (columns.length > 0) {
                    this.emitTable(columns);
                }
            }
        );
    }

    private emitUnionDefinition(u: UnionType, unionName: Name): void {
        const nonNulls = removeNullFromUnion(u, true)[1];
        this.emitType(
            this.descriptionForType(u),
            AccessModifier.Public,
            "partial struct",
            unionName,
            this.baseclassForType(u),
            () => {
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                    const csType = this.nullableCSType(t);
                    this.emitLine("public ", csType, " ", fieldName, ";");
                });
                this.ensureBlankLine();
                const nullTests: Sourcelike[] = Array.from(nonNulls).map(t => [
                    this.nameForUnionMember(u, t),
                    " == null"
                ]);
                this.ensureBlankLine();
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                    const csType = this.csType(t);
                    this.emitExpressionMember(
                        ["public static implicit operator ", unionName, "(", csType, " ", fieldName, ")"],
                        ["new ", unionName, " { ", fieldName, " = ", fieldName, " }"]
                    );
                });
                if (u.findMember("null") === undefined) return;
                this.emitExpressionMember("public bool IsNull", arrayIntercalate(" && ", nullTests), true);
            }
        );
    }

    private emitEnumDefinition(e: EnumType, enumName: Name): void {
        const caseNames: Sourcelike[] = [];
        this.forEachEnumCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("public enum ", enumName, " { ", caseNames, " };");
    }

    protected emitExpressionMember(declare: Sourcelike, define: Sourcelike, isProperty = false): void {
        if (this._csOptions.version === 5) {
            this.emitLine(declare);
            this.emitBlock(() => {
                const stmt = ["return ", define, ";"];
                if (isProperty) {
                    this.emitLine("get");
                    this.emitBlock(() => this.emitLine(stmt));
                } else {
                    this.emitLine(stmt);
                }
            });
        } else {
            this.emitLine(declare, " => ", define, ";");
        }
    }

    protected emitTypeSwitch<T extends Sourcelike>(
        types: Iterable<T>,
        condition: (t: T) => Sourcelike,
        withBlock: boolean,
        withReturn: boolean,
        f: (t: T) => void
    ): void {
        assert(!withReturn || withBlock, "Can only have return with block");
        for (const t of types) {
            this.emitLine("if (", condition(t), ")");
            if (withBlock) {
                this.emitBlock(() => {
                    f(t);
                    if (withReturn) {
                        this.emitLine("return;");
                    }
                });
            } else {
                this.indent(() => f(t));
            }
        }
    }

    protected emitUsing(ns: Sourcelike): void {
        this.emitLine("using ", ns, ";");
    }

    protected emitUsings(): void {
        for (const ns of ["System", "System.Collections.Generic"]) {
            this.emitUsing(ns);
        }
    }

    protected emitRequiredHelpers(): void {
        return;
    }

    private emitTypesAndSupport(): void {
        this.forEachObject("leading-and-interposing", (c: ClassType, name: Name) => this.emitClassDefinition(c, name));
        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnionDefinition(u, name));
        this.emitRequiredHelpers();
    }

    protected emitDefaultLeadingComments(): void {
        return;
    }

    protected emitDefaultFollowingComments(): void {
        return;
    }

    protected needNamespace(): boolean {
        return true;
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitDefaultLeadingComments();
        }

        this.ensureBlankLine();
        if (this.needNamespace()) {
            this.emitLine("namespace ", this._csOptions.namespace);
            this.emitBlock(() => {
                this.emitUsings();
                this.emitTypesAndSupport();
            });
        } else {
            this.emitUsings();
            this.emitTypesAndSupport();
        }

        this.emitDefaultFollowingComments();
    }
}

export const newtonsoftCSharpOptions = Object.assign({}, cSharpOptions, {});

export class NewtonsoftCSharpRenderer extends CSharpRenderer {
    private readonly _enumExtensionsNames = new Map<Name, Name>();

    private readonly _needHelpers: boolean;
    private readonly _needAttributes: boolean;
    private readonly _needNamespaces: boolean;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof newtonsoftCSharpOptions>
    ) {
        super(targetLanguage, renderContext, _options);
        this._needHelpers = _options.features.helpers;
        this._needAttributes = _options.features.attributes;
        this._needNamespaces = _options.features.namespaces;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        const forbidden = [
            "Converter",
            "JsonConverter",
            "JsonSerializer",
            "JsonWriter",
            "JsonToken",
            "Serialize",
            "Newtonsoft",
            "MetadataPropertyHandling",
            "DateParseHandling",
            "FromJson",
            "Required"
        ];
        if (this._options.dense) {
            forbidden.push("J", "R", "N");
        }
        if (this._options.baseclass !== undefined) {
            forbidden.push(this._options.baseclass);
        }
        return super.forbiddenNamesForGlobalNamespace().concat(forbidden);
    }

    protected forbiddenForObjectProperties(c: ClassType, className: Name): ForbiddenWordsInfo {
        const result = super.forbiddenForObjectProperties(c, className);
        result.names = result.names.concat(["ToJson", "FromJson", "Required"]);
        return result;
    }

    protected makeNameForTransformation(xf: Transformation, typeName: Name | undefined): Name {
        if (typeName === undefined) {
            let xfer = xf.transformer;
            if (xfer instanceof DecodingTransformer && xfer.consumer !== undefined) {
                xfer = xfer.consumer;
            }
            return new SimpleName([`${xfer.kind}_converter`], namingFunction, inferredNameOrder + 30);
        }
        return new DependencyName(namingFunction, typeName.order + 30, lookup => `${lookup(typeName)}_converter`);
    }

    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];

        const extensionsName = new DependencyName(
            namingFunction,
            name.order + 30,
            lookup => `${lookup(name)}_extensions`
        );
        this._enumExtensionsNames.set(name, extensionsName);
        return [extensionsName];
    }

    protected emitUsings(): void {
        // FIXME: We need System.Collections.Generic whenever we have maps or use List.
        if (!this._needAttributes && !this._needHelpers) return;

        super.emitUsings();
        this.ensureBlankLine();

        for (const ns of ["System.Globalization", "Newtonsoft.Json", "Newtonsoft.Json.Converters"]) {
            this.emitUsing(ns);
        }

        if (this._options.dense) {
            this.emitUsing([denseJsonPropertyName, " = Newtonsoft.Json.JsonPropertyAttribute"]);
            this.emitUsing([denseRequiredEnumName, " = Newtonsoft.Json.Required"]);
            this.emitUsing([denseNullValueHandlingEnumName, " = Newtonsoft.Json.NullValueHandling"]);
        }
        if (this._options.baseclass === "EntityData") {
            this.emitUsing("Microsoft.Azure.Mobile.Server");
        }
    }
    protected baseclassForType(_t: Type): Sourcelike | undefined {
        return this._options.baseclass;
    }
    protected emitDefaultLeadingComments(): void {
        if (!this._needHelpers) return;

        this.emitLine("// <auto-generated />");
        this.emitLine("//");
        this.emitLine(
            "// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do",
            this.topLevels.size === 1 ? "" : " one of these",
            ":"
        );
        this.emitLine("//");
        this.emitLine("//    using ", this._options.namespace, ";");
        this.emitLine("//");
        this.forEachTopLevel("none", (t, topLevelName) => {
            let rhs: Sourcelike;
            if (t instanceof EnumType) {
                rhs = ["JsonConvert.DeserializeObject<", topLevelName, ">(jsonString)"];
            } else {
                rhs = [topLevelName, ".FromJson(jsonString)"];
            }
            this.emitLine("//    var ", modifySource(camelCase, topLevelName), " = ", rhs, ";");
        });
    }

    private converterForType(t: Type): Name | undefined {
        let xf = transformationForType(t);

        if (xf === undefined && t instanceof UnionType) {
            const maybeNullable = nullableFromUnion(t);
            if (maybeNullable !== null) {
                t = maybeNullable;
                xf = transformationForType(t);
            }
        }

        if (xf === undefined) return undefined;

        if (alwaysApplyTransformation(xf)) return undefined;

        return defined(this.nameForTransformation(t));
    }

    protected attributesForProperty(
        property: ClassProperty,
        _name: Name,
        _c: ClassType,
        jsonName: string
    ): Sourcelike[] | undefined {
        if (!this._needAttributes) return undefined;

        const attributes: Sourcelike[] = [];

        const jsonProperty = this._options.dense ? denseJsonPropertyName : "JsonProperty";
        const escapedName = utf16StringEscape(jsonName);
        const isNullable = followTargetType(property.type).isNullable;
        const isOptional = property.isOptional;
        const requiredClass = this._options.dense ? "R" : "Required";
        const nullValueHandlingClass = this._options.dense ? "N" : "NullValueHandling";
        const nullValueHandling =
            isOptional && !isNullable ? [", NullValueHandling = ", nullValueHandlingClass, ".Ignore"] : [];
        let required: Sourcelike;
        if (!this._options.checkRequired || (isOptional && isNullable)) {
            required = [nullValueHandling];
        } else if (isOptional && !isNullable) {
            required = [", Required = ", requiredClass, ".DisallowNull", nullValueHandling];
        } else if (!isOptional && isNullable) {
            required = [", Required = ", requiredClass, ".AllowNull"];
        } else {
            required = [", Required = ", requiredClass, ".Always", nullValueHandling];
        }
        attributes.push(["[", jsonProperty, '("', escapedName, '"', required, ")]"]);

        const converter = this.converterForType(property.type);
        if (converter !== undefined) {
            attributes.push(["[JsonConverter(typeof(", converter, "))]"]);
        }

        return attributes;
    }

    protected blankLinesBetweenAttributes(): boolean {
        return this._needAttributes && !this._options.dense;
    }

    // The "this" type can't be `dynamic`, so we have to force it to `object`.
    private topLevelResultType(t: Type): Sourcelike {
        return t.kind === "any" || t.kind === "none" ? "object" : this.csType(t);
    }

    private emitFromJsonForTopLevel(t: Type, name: Name): void {
        if (t instanceof EnumType) return;

        let partial: string;
        let typeKind: string;
        const definedType = this.namedTypeToNameForTopLevel(t);
        if (definedType !== undefined) {
            partial = "partial ";
            typeKind = definedType instanceof ClassType ? "class" : "struct";
        } else {
            partial = "";
            typeKind = "class";
        }
        const csType = this.topLevelResultType(t);
        this.emitType(undefined, AccessModifier.Public, [partial, typeKind], name, this.baseclassForType(t), () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(
                ["public static ", csType, " FromJson(string json)"],
                ["JsonConvert.DeserializeObject<", csType, ">(json, ", this._options.namespace, ".Converter.Settings)"]
            );
        });
    }

    private emitDecoderSwitch(emitBody: () => void): void {
        this.emitLine("switch (reader.TokenType)");
        this.emitBlock(emitBody);
    }

    private emitTokenCase(tokenType: string): void {
        this.emitLine("case JsonToken.", tokenType, ":");
    }

    private emitThrow(message: Sourcelike): void {
        this.emitLine("throw new Exception(", message, ");");
    }

    private deserializeTypeCode(typeName: Sourcelike): Sourcelike {
        return ["serializer.Deserialize<", typeName, ">(reader)"];
    }

    private serializeValueCode(value: Sourcelike): Sourcelike {
        return ["serializer.Serialize(writer, ", value, ")"];
    }

    private emitSerializeClass(): void {
        // FIXME: Make Serialize a Named
        this.emitType(undefined, AccessModifier.Public, "static class", "Serialize", undefined, () => {
            // Sometimes multiple top-levels will resolve to the same type, so we have to take care
            // not to emit more than one extension method for the same type.
            const seenTypes = new Set<Type>();
            this.forEachTopLevel("none", t => {
                // FIXME: Make ToJson a Named
                if (!seenTypes.has(t)) {
                    seenTypes.add(t);
                    this.emitExpressionMember(
                        ["public static string ToJson(this ", this.topLevelResultType(t), " self)"],
                        ["JsonConvert.SerializeObject(self, ", this._options.namespace, ".Converter.Settings)"]
                    );
                }
            });
        });
    }

    private emitCanConvert(expr: Sourcelike): void {
        this.emitExpressionMember("public override bool CanConvert(Type t)", expr);
    }

    private emitReadJson(emitBody: () => void): void {
        this.emitLine(
            "public override object ReadJson(JsonReader reader, Type t, object existingValue, JsonSerializer serializer)"
        );
        this.emitBlock(emitBody);
    }

    private emitWriteJson(variable: string, emitBody: () => void): void {
        this.emitLine(
            "public override void WriteJson(JsonWriter writer, object ",
            variable,
            ", JsonSerializer serializer)"
        );
        this.emitBlock(emitBody);
    }

    private converterObject(converterName: Name): Sourcelike {
        // FIXME: Get a singleton
        return [converterName, ".Singleton"];
    }

    private emitConverterClass(): void {
        // FIXME: Make Converter a Named
        const converterName: Sourcelike = ["Converter"];
        this.emitType(undefined, AccessModifier.Internal, "static class", converterName, undefined, () => {
            this.emitLine("public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings");
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
                this.emitLine("Converters =");
                this.emitLine("{");
                this.indent(() => {
                    for (const [t, converter] of this.typesWithNamedTransformations) {
                        if (alwaysApplyTransformation(defined(transformationForType(t)))) {
                            this.emitLine(this.converterObject(converter), ",");
                        }
                    }
                    this.emitLine("new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }");
                });
                this.emitLine(`},`);
            }, true);
        });
    }

    private emitDecoderTransformerCase(
        tokenCases: string[],
        variableName: string,
        xfer: Transformer | undefined,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void
    ): void {
        if (xfer === undefined) return;

        for (const tokenCase of tokenCases) {
            this.emitTokenCase(tokenCase);
        }
        this.indent(() => {
            const allHandled = this.emitDecodeTransformer(xfer, targetType, emitFinish, variableName);
            if (!allHandled) {
                this.emitLine("break;");
            }
        });
    }

    private emitConsume(
        value: Sourcelike,
        consumer: Transformer | undefined,
        targetType: Type,
        emitFinish: (variableName: Sourcelike) => void
    ): boolean {
        if (consumer === undefined) {
            emitFinish(value);
            return true;
        } else {
            return this.emitTransformer(value, consumer, targetType, emitFinish);
        }
    }

    private emitDecodeTransformer(
        xfer: Transformer,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void,
        variableName = "value"
    ): boolean {
        if (xfer instanceof DecodingTransformer) {
            const source = xfer.sourceType;
            const converter = this.converterForType(targetType);
            if (converter !== undefined) {
                const typeSource = this.csType(targetType);
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine(
                    "var ",
                    variableName,
                    " = (",
                    typeSource,
                    ")converter.ReadJson(reader, typeof(",
                    typeSource,
                    "), null, serializer);"
                );
            } else if (source.kind !== "null") {
                let output = targetType.kind === "double" ? targetType : source;
                this.emitLine("var ", variableName, " = ", this.deserializeTypeCode(this.csType(output)), ";");
            }
            return this.emitConsume(variableName, xfer.consumer, targetType, emitFinish);
        } else if (xfer instanceof ArrayDecodingTransformer) {
            // FIXME: Consume StartArray
            if (!(targetType instanceof ArrayType)) {
                return panic("Array decoding must produce an array type");
            }
            // FIXME: handle EOF
            this.emitLine("reader.Read();");
            this.emitLine("var ", variableName, " = new List<", this.csType(targetType.items), ">();");
            this.emitLine("while (reader.TokenType != JsonToken.EndArray)");
            this.emitBlock(() => {
                this.emitDecodeTransformer(
                    xfer.itemTransformer,
                    xfer.itemTargetType,
                    v => this.emitLine(variableName, ".Add(", v, ");"),
                    "arrayItem"
                );
                // FIXME: handle EOF
                this.emitLine("reader.Read();");
            });
            let result: Sourcelike = variableName;
            if (!this._options.useList) {
                result = [result, ".ToArray()"];
            }
            emitFinish(result);
            return true;
        } else if (xfer instanceof DecodingChoiceTransformer) {
            this.emitDecoderSwitch(() => {
                const nullTransformer = xfer.nullTransformer;
                if (nullTransformer !== undefined) {
                    this.emitTokenCase("Null");
                    this.indent(() => {
                        const allHandled = this.emitDecodeTransformer(nullTransformer, targetType, emitFinish, "null");
                        if (!allHandled) {
                            this.emitLine("break");
                        }
                    });
                }
                this.emitDecoderTransformerCase(
                    ["Integer"],
                    "integerValue",
                    xfer.integerTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    xfer.integerTransformer === undefined ? ["Integer", "Float"] : ["Float"],
                    "doubleValue",
                    xfer.doubleTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(["Boolean"], "boolValue", xfer.boolTransformer, targetType, emitFinish);
                this.emitDecoderTransformerCase(
                    ["String", "Date"],
                    "stringValue",
                    xfer.stringTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["StartObject"],
                    "objectValue",
                    xfer.objectTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["StartArray"],
                    "arrayValue",
                    xfer.arrayTransformer,
                    targetType,
                    emitFinish
                );
            });
            return false;
        } else {
            return panic("Unknown transformer");
        }
    }

    private stringCaseValue(t: Type, stringCase: string): Sourcelike {
        if (t.kind === "string") {
            return ['"', utf16StringEscape(stringCase), '"'];
        } else if (t instanceof EnumType) {
            return [this.nameForNamedType(t), ".", this.nameForEnumCase(t, stringCase)];
        }
        return panic(`Type ${t.kind} does not have string cases`);
    }

    private emitTransformer(
        variable: Sourcelike,
        xfer: Transformer,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void
    ): boolean {
        function directTargetType(continuation: Transformer | undefined): Type {
            if (continuation === undefined) {
                return targetType;
            }
            return followTargetType(continuation.sourceType);
        }

        if (xfer instanceof ChoiceTransformer) {
            const caseXfers = xfer.transformers;
            if (caseXfers.length > 1 && caseXfers.every(caseXfer => caseXfer instanceof StringMatchTransformer)) {
                this.emitLine("switch (", variable, ")");
                this.emitBlock(() => {
                    for (const caseXfer of caseXfers) {
                        const matchXfer = caseXfer as StringMatchTransformer;
                        const value = this.stringCaseValue(
                            followTargetType(matchXfer.sourceType),
                            matchXfer.stringCase
                        );
                        this.emitLine("case ", value, ":");
                        this.indent(() => {
                            const allDone = this.emitTransformer(
                                variable,
                                matchXfer.transformer,
                                targetType,
                                emitFinish
                            );
                            if (!allDone) {
                                this.emitLine("break;");
                            }
                        });
                    }
                });
                // FIXME: Can we check for exhaustiveness?  For enums it should be easy.
                return false;
            } else {
                for (const caseXfer of caseXfers) {
                    this.emitTransformer(variable, caseXfer, targetType, emitFinish);
                }
            }
        } else if (xfer instanceof UnionMemberMatchTransformer) {
            const memberType = xfer.memberType;
            const maybeNullable = nullableFromUnion(xfer.sourceType);
            let test: Sourcelike;
            let member: Sourcelike;
            if (maybeNullable !== null) {
                if (memberType.kind === "null") {
                    test = [variable, " == null"];
                    member = "null";
                } else {
                    test = [variable, " != null"];
                    member = variable;
                }
            } else if (memberType.kind === "null") {
                test = [variable, ".IsNull"];
                member = "null";
            } else {
                const memberName = this.nameForUnionMember(xfer.sourceType, memberType);
                member = [variable, ".", memberName];
                test = [member, " != null"];
            }
            if (memberType.kind !== "null" && isValueType(memberType)) {
                member = [member, ".Value"];
            }
            this.emitLine("if (", test, ")");
            this.emitBlock(() => this.emitTransformer(member, xfer.transformer, targetType, emitFinish));
        } else if (xfer instanceof StringMatchTransformer) {
            const value = this.stringCaseValue(followTargetType(xfer.sourceType), xfer.stringCase);
            this.emitLine("if (", variable, " == ", value, ")");
            this.emitBlock(() => this.emitTransformer(variable, xfer.transformer, targetType, emitFinish));
        } else if (xfer instanceof EncodingTransformer) {
            const converter = this.converterForType(xfer.sourceType);
            if (converter !== undefined) {
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine("converter.WriteJson(writer, ", variable, ", serializer);");
            } else {
                this.emitLine(this.serializeValueCode(variable), ";");
            }
            emitFinish([]);
            return true;
        } else if (xfer instanceof ArrayEncodingTransformer) {
            this.emitLine("writer.WriteStartArray();");
            const itemVariable = "arrayItem";
            this.emitLine("foreach (var ", itemVariable, " in ", variable, ")");
            this.emitBlock(() => {
                this.emitTransformer(itemVariable, xfer.itemTransformer, xfer.itemTargetType, () => {
                    return;
                });
            });
            this.emitLine("writer.WriteEndArray();");
            emitFinish([]);
            return true;
        } else if (xfer instanceof ParseStringTransformer) {
            const immediateTargetType = xfer.consumer === undefined ? targetType : xfer.consumer.sourceType;
            switch (immediateTargetType.kind) {
                case "date-time":
                    this.emitLine("DateTimeOffset dt;");
                    this.emitLine("if (DateTimeOffset.TryParse(", variable, ", out dt))");
                    this.emitBlock(() => this.emitConsume("dt", xfer.consumer, targetType, emitFinish));
                    break;
                case "uuid":
                    this.emitLine("Guid guid;");
                    this.emitLine("if (Guid.TryParse(", variable, ", out guid))");
                    this.emitBlock(() => this.emitConsume("guid", xfer.consumer, targetType, emitFinish));
                    break;
                case "uri":
                    this.emitLine("try");
                    this.emitBlock(() => {
                        this.emitLine("var uri = new Uri(", variable, ");");
                        this.emitConsume("uri", xfer.consumer, targetType, emitFinish);
                    });
                    this.emitLine("catch (UriFormatException) {}");
                    break;
                case "integer":
                    this.emitLine("long l;");
                    this.emitLine("if (Int64.TryParse(", variable, ", out l))");
                    this.emitBlock(() => this.emitConsume("l", xfer.consumer, targetType, emitFinish));
                    break;
                case "bool":
                    this.emitLine("bool b;");
                    this.emitLine("if (Boolean.TryParse(", variable, ", out b))");
                    this.emitBlock(() => this.emitConsume("b", xfer.consumer, targetType, emitFinish));
                    break;
                default:
                    return panic(`Parsing string to ${immediateTargetType.kind} not supported`);
            }
        } else if (xfer instanceof StringifyTransformer) {
            switch (xfer.sourceType.kind) {
                case "date-time":
                    return this.emitConsume(
                        [variable, '.ToString("o", System.Globalization.CultureInfo.InvariantCulture)'],
                        xfer.consumer,
                        targetType,
                        emitFinish
                    );
                case "uuid":
                    return this.emitConsume(
                        [variable, '.ToString("D", System.Globalization.CultureInfo.InvariantCulture)'],
                        xfer.consumer,
                        targetType,
                        emitFinish
                    );
                case "integer":
                case "uri":
                    return this.emitConsume([variable, ".ToString()"], xfer.consumer, targetType, emitFinish);
                case "bool":
                    this.emitLine("var boolString = ", variable, ' ? "true" : "false";');
                    return this.emitConsume("boolString", xfer.consumer, targetType, emitFinish);
                default:
                    return panic(`Stringifying ${xfer.sourceType.kind} not supported`);
            }
        } else if (xfer instanceof StringProducerTransformer) {
            const value = this.stringCaseValue(directTargetType(xfer.consumer), xfer.result);
            return this.emitConsume(value, xfer.consumer, targetType, emitFinish);
        } else if (xfer instanceof MinMaxLengthCheckTransformer) {
            const min = xfer.minLength;
            const max = xfer.maxLength;
            const conditions: Sourcelike[] = [];

            if (min !== undefined) {
                conditions.push([variable, ".Length >= ", min.toString()]);
            }
            if (max !== undefined) {
                conditions.push([variable, ".Length <= ", max.toString()]);
            }
            this.emitLine("if (", arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        } else if (xfer instanceof MinMaxValueTransformer) {
            const min = xfer.minimum;
            const max = xfer.maximum;
            const conditions: Sourcelike[] = [];

            if (min !== undefined) {
                conditions.push([variable, " >= ", min.toString()]);
            }
            if (max !== undefined) {
                conditions.push([variable, " <= ", max.toString()]);
            }
            this.emitLine("if (", arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        } else if (xfer instanceof UnionInstantiationTransformer) {
            if (!(targetType instanceof UnionType)) {
                return panic("Union instantiation transformer must produce a union type");
            }
            const maybeNullable = nullableFromUnion(targetType);
            if (maybeNullable !== null) {
                emitFinish(variable);
            } else {
                const unionName = this.nameForNamedType(targetType);
                let initializer: Sourcelike;
                if (xfer.sourceType.kind === "null") {
                    initializer = " ";
                } else {
                    const memberName = this.nameForUnionMember(targetType, xfer.sourceType);
                    initializer = [" ", memberName, " = ", variable, " "];
                }
                emitFinish(["new ", unionName, " {", initializer, "}"]);
            }
            return true;
        } else {
            return panic("Unknown transformer");
        }
        return false;
    }

    private emitTransformation(converterName: Name, t: Type): void {
        const xf = defined(transformationForType(t));
        const reverse = xf.reverse;
        const targetType = xf.targetType;
        const xfer = xf.transformer;
        this.emitType(undefined, AccessModifier.Internal, "class", converterName, "JsonConverter", () => {
            const csType = this.csType(targetType);
            let canConvertExpr: Sourcelike = ["t == typeof(", csType, ")"];
            const haveNullable = isValueType(targetType);
            if (haveNullable) {
                canConvertExpr = [canConvertExpr, " || t == typeof(", csType, "?)"];
            }
            this.emitCanConvert(canConvertExpr);
            this.ensureBlankLine();
            this.emitReadJson(() => {
                // FIXME: It's unsatisfying that we need this.  The reason is that we not
                // only match T, but also T?.  If we didn't, then the T in T? would not be
                // deserialized with our converter but with the default one.  Can we check
                // whether the type is a nullable?
                // FIXME: This could duplicate one of the cases handled below in
                // `emitDecodeTransformer`.
                if (haveNullable && !(targetType instanceof UnionType)) {
                    this.emitLine("if (reader.TokenType == JsonToken.Null) return null;");
                }

                const allHandled = this.emitDecodeTransformer(xfer, targetType, v => this.emitLine("return ", v, ";"));
                if (!allHandled) {
                    this.emitThrow(['"Cannot unmarshal type ', csType, '"']);
                }
            });
            this.ensureBlankLine();
            this.emitWriteJson("untypedValue", () => {
                // FIXME: See above.
                if (haveNullable && !(targetType instanceof UnionType)) {
                    this.emitLine("if (untypedValue == null)");
                    this.emitBlock(() => {
                        this.emitLine("serializer.Serialize(writer, null);");
                        this.emitLine("return;");
                    });
                }
                this.emitLine("var value = (", csType, ")untypedValue;");
                const allHandled = this.emitTransformer("value", reverse.transformer, reverse.targetType, () =>
                    this.emitLine("return;")
                );
                if (!allHandled) {
                    this.emitThrow(['"Cannot marshal type ', csType, '"']);
                }
            });
            this.ensureBlankLine();
            this.emitLine("public static readonly ", converterName, " Singleton = new ", converterName, "();");
        });
    }

    protected emitRequiredHelpers(): void {
        if (this._needHelpers) {
            this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitFromJsonForTopLevel(t, n));
            this.ensureBlankLine();
            this.emitSerializeClass();
        }
        if (this._needHelpers || (this._needAttributes && (this.haveNamedUnions || this.haveEnums))) {
            this.ensureBlankLine();
            this.emitConverterClass();
            this.forEachTransformation("leading-and-interposing", (n, t) => this.emitTransformation(n, t));
        }
    }

    protected needNamespace(): boolean {
        return this._needNamespaces;
    }
}

export const systemTextJsonCSharpOptions = Object.assign({}, cSharpOptions, {});

export class SystemTextJsonCSharpRenderer extends CSharpRenderer {
    private readonly _enumExtensionsNames = new Map<Name, Name>();

    private readonly _needHelpers: boolean;
    private readonly _needAttributes: boolean;
    private readonly _needNamespaces: boolean;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof systemTextJsonCSharpOptions>
    ) {
        super(targetLanguage, renderContext, _options);
        this._needHelpers = _options.features.helpers;
        this._needAttributes = _options.features.attributes;
        this._needNamespaces = _options.features.namespaces;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        const forbidden = [
            "Converter",
            "JsonConverter",
            "JsonSerializer",
            "JsonWriter",
            "JsonToken",
            "Serialize",
            "JsonSerializerOptions",
            // "Newtonsoft",
            // "MetadataPropertyHandling",
            // "DateParseHandling",
            "FromJson",
            "Required"
        ];
        if (this._options.dense) {
            forbidden.push("J", "R", "N");
        }
        if (this._options.baseclass !== undefined) {
            forbidden.push(this._options.baseclass);
        }
        return super.forbiddenNamesForGlobalNamespace().concat(forbidden);
    }

    protected forbiddenForObjectProperties(c: ClassType, className: Name): ForbiddenWordsInfo {
        const result = super.forbiddenForObjectProperties(c, className);
        result.names = result.names.concat(["ToJson", "FromJson", "Required"]);
        return result;
    }

    protected makeNameForTransformation(xf: Transformation, typeName: Name | undefined): Name {
        if (typeName === undefined) {
            let xfer = xf.transformer;
            if (xfer instanceof DecodingTransformer && xfer.consumer !== undefined) {
                xfer = xfer.consumer;
            }
            return new SimpleName([`${xfer.kind}_converter`], namingFunction, inferredNameOrder + 30);
        }
        return new DependencyName(namingFunction, typeName.order + 30, lookup => `${lookup(typeName)}_converter`);
    }

    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];

        const extensionsName = new DependencyName(
            namingFunction,
            name.order + 30,
            lookup => `${lookup(name)}_extensions`
        );
        this._enumExtensionsNames.set(name, extensionsName);
        return [extensionsName];
    }

    protected emitUsings(): void {
        // FIXME: We need System.Collections.Generic whenever we have maps or use List.
        if (!this._needAttributes && !this._needHelpers) return;

        super.emitUsings();
        this.ensureBlankLine();

        for (const ns of ["System.Text.Json", "System.Text.Json.Serialization", "System.Globalization"]) {
            this.emitUsing(ns);
        }

        if (this._options.dense) {
            this.emitUsing([denseJsonPropertyName, " = System.Text.Json.Serialization.JsonPropertyNameAttribute"]);
            // this.emitUsing([denseRequiredEnumName, " = Newtonsoft.Json.Required"]);
            this.emitUsing([denseNullValueHandlingEnumName, " = System.Text.Json.Serialization.JsonIgnoreCondition"]);
        }
        if (this._options.baseclass === "EntityData") {
            this.emitUsing("Microsoft.Azure.Mobile.Server");
        }
    }

    protected baseclassForType(_t: Type): Sourcelike | undefined {
        return this._options.baseclass;
    }

    protected emitDefaultFollowingComments(): void {
        if (!this._needHelpers) return;

        this.emitLine("#pragma warning restore CS8618");
        this.emitLine("#pragma warning restore CS8601");
        this.emitLine("#pragma warning restore CS8603");
    }

    protected emitDefaultLeadingComments(): void {
        if (!this._needHelpers) return;

        this.emitLine("// <auto-generated />");
        this.emitLine("//");
        this.emitLine(
            "// To parse this JSON data, add NuGet 'System.Text.Json' then do",
            this.topLevels.size === 1 ? "" : " one of these",
            ":"
        );
        this.emitLine("//");
        this.emitLine("//    using ", this._options.namespace, ";");
        this.emitLine("//");
        this.forEachTopLevel("none", (t, topLevelName) => {
            let rhs: Sourcelike;
            if (t instanceof EnumType) {
                rhs = ["JsonSerializer.Deserialize<", topLevelName, ">(jsonString)"];
            } else {
                rhs = [topLevelName, ".FromJson(jsonString)"];
            }
            this.emitLine("//    var ", modifySource(camelCase, topLevelName), " = ", rhs, ";");
        });

        // fix: should this be an option? Or respond to an existing option?
        this.emitLine("#nullable enable");
        this.emitLine("#pragma warning disable CS8618");
        this.emitLine("#pragma warning disable CS8601");
        this.emitLine("#pragma warning disable CS8603");
    }

    private converterForType(t: Type): Name | undefined {
        let xf = transformationForType(t);

        if (xf === undefined && t instanceof UnionType) {
            const maybeNullable = nullableFromUnion(t);
            if (maybeNullable !== null) {
                t = maybeNullable;
                xf = transformationForType(t);
            }
        }

        if (xf === undefined) return undefined;

        if (alwaysApplyTransformation(xf)) return undefined;

        return defined(this.nameForTransformation(t));
    }

    protected attributesForProperty(
        property: ClassProperty,
        _name: Name,
        _c: ClassType,
        jsonName: string
    ): Sourcelike[] | undefined {
        if (!this._needAttributes) return undefined;

        const attributes: Sourcelike[] = [];

        const jsonPropertyName = this._options.dense ? denseJsonPropertyName : "JsonPropertyName";
        const escapedName = utf16StringEscape(jsonName);
        const isNullable = followTargetType(property.type).isNullable;
        const isOptional = property.isOptional;

        if (isOptional && !isNullable) {
            attributes.push(["[", "JsonIgnore", "(Condition = JsonIgnoreCondition.WhenWritingNull)]"]);
        }

        // const requiredClass = this._options.dense ? "R" : "Required";
        // const nullValueHandlingClass = this._options.dense ? "N" : "NullValueHandling";
        // const nullValueHandling = isOptional && !isNullable ? [", NullValueHandling = ", nullValueHandlingClass, ".Ignore"] : [];
        // let required: Sourcelike;
        // if (!this._options.checkRequired || (isOptional && isNullable)) {
        //     required = [nullValueHandling];
        // } else if (isOptional && !isNullable) {
        //     required = [", Required = ", requiredClass, ".DisallowNull", nullValueHandling];
        // } else if (!isOptional && isNullable) {
        //     required = [", Required = ", requiredClass, ".AllowNull"];
        // } else {
        //     required = [", Required = ", requiredClass, ".Always", nullValueHandling];
        // }

        attributes.push(["[", jsonPropertyName, '("', escapedName, '")]']);

        const converter = this.converterForType(property.type);
        if (converter !== undefined) {
            attributes.push(["[JsonConverter(typeof(", converter, "))]"]);
        }

        return attributes;
    }

    protected blankLinesBetweenAttributes(): boolean {
        return this._needAttributes && !this._options.dense;
    }

    // The "this" type can't be `dynamic`, so we have to force it to `object`.
    private topLevelResultType(t: Type): Sourcelike {
        return t.kind === "any" || t.kind === "none" ? "object" : this.csType(t);
    }

    private emitFromJsonForTopLevel(t: Type, name: Name): void {
        if (t instanceof EnumType) return;

        let partial: string;
        let typeKind: string;
        const definedType = this.namedTypeToNameForTopLevel(t);
        if (definedType !== undefined) {
            partial = "partial ";
            typeKind = definedType instanceof ClassType ? "class" : "struct";
        } else {
            partial = "";
            typeKind = "class";
        }
        const csType = this.topLevelResultType(t);
        this.emitType(undefined, AccessModifier.Public, [partial, typeKind], name, this.baseclassForType(t), () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(
                ["public static ", csType, " FromJson(string json)"],
                ["JsonSerializer.Deserialize<", csType, ">(json, ", this._options.namespace, ".Converter.Settings)"]
            );
        });
    }

    private emitDecoderSwitch(emitBody: () => void): void {
        this.emitLine("switch (reader.TokenType)");
        this.emitBlock(emitBody);
    }

    private emitTokenCase(tokenType: string): void {
        this.emitLine("case JsonTokenType.", tokenType, ":");
    }

    private emitThrow(message: Sourcelike): void {
        this.emitLine("throw new Exception(", message, ");");
    }

    private deserializeTypeCode(typeName: Sourcelike): Sourcelike {
        switch (typeName) {
            case "bool":
                return ["reader.GetBoolean()"];
            case "long":
                return ["reader.GetInt64()"];
            case "decimal":
                return ["reader.GetDecimal()"];
            case "double":
                return ["reader.GetDouble()"];
            case "string":
                return ["reader.GetString()"];
            default:
                return ["JsonSerializer.Deserialize<", typeName, ">(ref reader, options)"];
        }
    }

    private serializeValueCode(value: Sourcelike): Sourcelike {
        if (value !== "null") return ["JsonSerializer.Serialize(writer, ", value, ", options)"];
        else return ["writer.WriteNullValue()"];
    }

    private emitSerializeClass(): void {
        // FIXME: Make Serialize a Named
        this.emitType(undefined, AccessModifier.Public, "static class", "Serialize", undefined, () => {
            // Sometimes multiple top-levels will resolve to the same type, so we have to take care
            // not to emit more than one extension method for the same type.
            const seenTypes = new Set<Type>();
            this.forEachTopLevel("none", t => {
                // FIXME: Make ToJson a Named
                if (!seenTypes.has(t)) {
                    seenTypes.add(t);
                    this.emitExpressionMember(
                        ["public static string ToJson(this ", this.topLevelResultType(t), " self)"],
                        ["JsonSerializer.Serialize(self, ", this._options.namespace, ".Converter.Settings)"]
                    );
                }
            });
        });
    }

    private emitCanConvert(expr: Sourcelike): void {
        this.emitExpressionMember("public override bool CanConvert(Type t)", expr);
    }

    private emitReadJson(emitBody: () => void, csType: Sourcelike): void {
        this.emitLine(
            "public override ",
            csType,
            " Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)"
        );
        this.emitBlock(emitBody);
    }

    private emitWriteJson(variable: string, emitBody: () => void, csType: Sourcelike): void {
        this.emitLine(
            "public override void Write(Utf8JsonWriter writer, ",
            csType,
            " ",
            variable,
            ", JsonSerializerOptions options)"
        );
        this.emitBlock(emitBody);
    }

    private converterObject(converterName: Name): Sourcelike {
        // FIXME: Get a singleton
        return [converterName, ".Singleton"];
    }

    private emitConverterClass(): void {
        // FIXME: Make Converter a Named
        const converterName: Sourcelike = ["Converter"];
        this.emitType(undefined, AccessModifier.Internal, "static class", converterName, undefined, () => {
            // Do not use .Web as defaults. That turns on caseInsensitive property names and will fail the keywords test.
            this.emitLine(
                "public static readonly JsonSerializerOptions Settings = new(JsonSerializerDefaults.General)"
            );
            this.emitBlock(() => {
                // this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                // this.emitLine("DateParseHandling = DateParseHandling.None,");
                this.emitLine("Converters =");
                this.emitLine("{");
                this.indent(() => {
                    for (const [t, converter] of this.typesWithNamedTransformations) {
                        if (alwaysApplyTransformation(defined(transformationForType(t)))) {
                            this.emitLine(this.converterObject(converter), ",");
                        }
                    }
                    this.emitLine("new DateOnlyConverter(),");
                    this.emitLine("new TimeOnlyConverter(),");
                    this.emitLine("IsoDateTimeOffsetConverter.Singleton");
                    // this.emitLine("new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }");
                });
                this.emitLine(`},`);
            }, true);
        });
    }

    private emitDecoderTransformerCase(
        tokenCases: string[],
        variableName: string,
        xfer: Transformer | undefined,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void
    ): void {
        if (xfer === undefined) return;

        for (const tokenCase of tokenCases) {
            this.emitTokenCase(tokenCase);
        }
        this.indent(() => {
            const allHandled = this.emitDecodeTransformer(xfer, targetType, emitFinish, variableName);
            if (!allHandled) {
                this.emitLine("break;");
            }
        });
    }

    private emitConsume(
        value: Sourcelike,
        consumer: Transformer | undefined,
        targetType: Type,
        emitFinish: (variableName: Sourcelike) => void
    ): boolean {
        if (consumer === undefined) {
            emitFinish(value);
            return true;
        } else {
            return this.emitTransformer(value, consumer, targetType, emitFinish);
        }
    }

    private emitDecodeTransformer(
        xfer: Transformer,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void,
        variableName = "value"
    ): boolean {
        if (xfer instanceof DecodingTransformer) {
            const source = xfer.sourceType;
            const converter = this.converterForType(targetType);
            if (converter !== undefined) {
                const typeSource = this.csType(targetType);
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine(
                    "var ",
                    variableName,
                    " = (",
                    typeSource,
                    ")converter.ReadJson(reader, typeof(",
                    typeSource,
                    "), null, serializer);"
                );
            } else if (source.kind !== "null") {
                let output = targetType.kind === "double" ? targetType : source;
                this.emitLine("var ", variableName, " = ", this.deserializeTypeCode(this.csType(output)), ";");
            }
            return this.emitConsume(variableName, xfer.consumer, targetType, emitFinish);
        } else if (xfer instanceof ArrayDecodingTransformer) {
            // FIXME: Consume StartArray
            if (!(targetType instanceof ArrayType)) {
                return panic("Array decoding must produce an array type");
            }
            // FIXME: handle EOF
            this.emitLine("reader.Read();");
            this.emitLine("var ", variableName, " = new List<", this.csType(targetType.items), ">();");
            this.emitLine("while (reader.TokenType != JsonToken.EndArray)");
            this.emitBlock(() => {
                this.emitDecodeTransformer(
                    xfer.itemTransformer,
                    xfer.itemTargetType,
                    v => this.emitLine(variableName, ".Add(", v, ");"),
                    "arrayItem"
                );
                // FIXME: handle EOF
                this.emitLine("reader.Read();");
            });
            let result: Sourcelike = variableName;
            if (!this._options.useList) {
                result = [result, ".ToArray()"];
            }
            emitFinish(result);
            return true;
        } else if (xfer instanceof DecodingChoiceTransformer) {
            this.emitDecoderSwitch(() => {
                const nullTransformer = xfer.nullTransformer;
                if (nullTransformer !== undefined) {
                    this.emitTokenCase("Null");
                    this.indent(() => {
                        const allHandled = this.emitDecodeTransformer(nullTransformer, targetType, emitFinish, "null");
                        if (!allHandled) {
                            this.emitLine("break");
                        }
                    });
                }
                this.emitDecoderTransformerCase(
                    ["Number"],
                    "integerValue",
                    xfer.integerTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["Number"],
                    // xfer.integerTransformer === undefined ? ["Integer", "Float"] : ["Float"],
                    "doubleValue",
                    xfer.doubleTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["True", "False"],
                    "boolValue",
                    xfer.boolTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    // ["String", "Date"],
                    ["String"],
                    "stringValue",
                    xfer.stringTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["StartObject"],
                    "objectValue",
                    xfer.objectTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["StartArray"],
                    "arrayValue",
                    xfer.arrayTransformer,
                    targetType,
                    emitFinish
                );
            });
            return false;
        } else {
            return panic("Unknown transformer");
        }
    }

    private stringCaseValue(t: Type, stringCase: string): Sourcelike {
        if (t.kind === "string") {
            return ['"', utf16StringEscape(stringCase), '"'];
        } else if (t instanceof EnumType) {
            return [this.nameForNamedType(t), ".", this.nameForEnumCase(t, stringCase)];
        }
        return panic(`Type ${t.kind} does not have string cases`);
    }

    private emitTransformer(
        variable: Sourcelike,
        xfer: Transformer,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void
    ): boolean {
        function directTargetType(continuation: Transformer | undefined): Type {
            if (continuation === undefined) {
                return targetType;
            }
            return followTargetType(continuation.sourceType);
        }

        if (xfer instanceof ChoiceTransformer) {
            const caseXfers = xfer.transformers;
            if (caseXfers.length > 1 && caseXfers.every(caseXfer => caseXfer instanceof StringMatchTransformer)) {
                this.emitLine("switch (", variable, ")");
                this.emitBlock(() => {
                    for (const caseXfer of caseXfers) {
                        const matchXfer = caseXfer as StringMatchTransformer;
                        const value = this.stringCaseValue(
                            followTargetType(matchXfer.sourceType),
                            matchXfer.stringCase
                        );
                        this.emitLine("case ", value, ":");
                        this.indent(() => {
                            const allDone = this.emitTransformer(
                                variable,
                                matchXfer.transformer,
                                targetType,
                                emitFinish
                            );
                            if (!allDone) {
                                this.emitLine("break;");
                            }
                        });
                    }
                });
                // FIXME: Can we check for exhaustiveness?  For enums it should be easy.
                return false;
            } else {
                for (const caseXfer of caseXfers) {
                    this.emitTransformer(variable, caseXfer, targetType, emitFinish);
                }
            }
        } else if (xfer instanceof UnionMemberMatchTransformer) {
            const memberType = xfer.memberType;
            const maybeNullable = nullableFromUnion(xfer.sourceType);
            let test: Sourcelike;
            let member: Sourcelike;
            if (maybeNullable !== null) {
                if (memberType.kind === "null") {
                    test = [variable, " == null"];
                    member = "null";
                } else {
                    test = [variable, " != null"];
                    member = variable;
                }
            } else if (memberType.kind === "null") {
                test = [variable, ".IsNull"];
                member = "null";
            } else {
                const memberName = this.nameForUnionMember(xfer.sourceType, memberType);
                member = [variable, ".", memberName];
                test = [member, " != null"];
            }
            if (memberType.kind !== "null" && isValueType(memberType)) {
                member = [member, ".Value"];
            }
            this.emitLine("if (", test, ")");
            this.emitBlock(() => this.emitTransformer(member, xfer.transformer, targetType, emitFinish));
        } else if (xfer instanceof StringMatchTransformer) {
            const value = this.stringCaseValue(followTargetType(xfer.sourceType), xfer.stringCase);
            this.emitLine("if (", variable, " == ", value, ")");
            this.emitBlock(() => this.emitTransformer(variable, xfer.transformer, targetType, emitFinish));
        } else if (xfer instanceof EncodingTransformer) {
            const converter = this.converterForType(xfer.sourceType);
            if (converter !== undefined) {
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine("converter.WriteJson(writer, ", variable, ", serializer);");
            } else {
                this.emitLine(this.serializeValueCode(variable), ";");
            }
            emitFinish([]);
            return true;
        } else if (xfer instanceof ArrayEncodingTransformer) {
            this.emitLine("writer.WriteStartArray();");
            const itemVariable = "arrayItem";
            this.emitLine("foreach (var ", itemVariable, " in ", variable, ")");
            this.emitBlock(() => {
                this.emitTransformer(itemVariable, xfer.itemTransformer, xfer.itemTargetType, () => {
                    return;
                });
            });
            this.emitLine("writer.WriteEndArray();");
            emitFinish([]);
            return true;
        } else if (xfer instanceof ParseStringTransformer) {
            const immediateTargetType = xfer.consumer === undefined ? targetType : xfer.consumer.sourceType;
            switch (immediateTargetType.kind) {
                case "date-time":
                    this.emitLine("DateTimeOffset dt;");
                    this.emitLine("if (DateTimeOffset.TryParse(", variable, ", out dt))");
                    this.emitBlock(() => this.emitConsume("dt", xfer.consumer, targetType, emitFinish));
                    break;
                case "uuid":
                    this.emitLine("Guid guid;");
                    this.emitLine("if (Guid.TryParse(", variable, ", out guid))");
                    this.emitBlock(() => this.emitConsume("guid", xfer.consumer, targetType, emitFinish));
                    break;
                case "uri":
                    this.emitLine("try");
                    this.emitBlock(() => {
                        // this.emitLine("var uri = new Uri(", variable, ");");
                        // The default value about:blank should never happen, but this way we avoid a null reference warning.
                        this.emitLine('var uri = new Uri("about:blank");');
                        this.emitLine("if (!string.IsNullOrEmpty(stringValue))");
                        this.emitBlock(() => {
                            this.emitLine("uri = new Uri(", variable, ");");
                        });
                        this.emitConsume("uri", xfer.consumer, targetType, emitFinish);
                    });
                    this.emitLine("catch (UriFormatException) {}");
                    break;
                case "integer":
                    this.emitLine("long l;");
                    this.emitLine("if (Int64.TryParse(", variable, ", out l))");
                    this.emitBlock(() => this.emitConsume("l", xfer.consumer, targetType, emitFinish));
                    break;
                case "bool":
                    this.emitLine("bool b;");
                    this.emitLine("if (Boolean.TryParse(", variable, ", out b))");
                    this.emitBlock(() => this.emitConsume("b", xfer.consumer, targetType, emitFinish));
                    break;
                default:
                    return panic(`Parsing string to ${immediateTargetType.kind} not supported`);
            }
        } else if (xfer instanceof StringifyTransformer) {
            switch (xfer.sourceType.kind) {
                case "date-time":
                    return this.emitConsume(
                        [variable, '.ToString("o", System.Globalization.CultureInfo.InvariantCulture)'],
                        xfer.consumer,
                        targetType,
                        emitFinish
                    );
                case "uuid":
                    return this.emitConsume(
                        [variable, '.ToString("D", System.Globalization.CultureInfo.InvariantCulture)'],
                        xfer.consumer,
                        targetType,
                        emitFinish
                    );
                case "integer":
                case "uri":
                    return this.emitConsume([variable, ".ToString()"], xfer.consumer, targetType, emitFinish);
                case "bool":
                    this.emitLine("var boolString = ", variable, ' ? "true" : "false";');
                    return this.emitConsume("boolString", xfer.consumer, targetType, emitFinish);
                default:
                    return panic(`Stringifying ${xfer.sourceType.kind} not supported`);
            }
        } else if (xfer instanceof StringProducerTransformer) {
            const value = this.stringCaseValue(directTargetType(xfer.consumer), xfer.result);
            return this.emitConsume(value, xfer.consumer, targetType, emitFinish);
        } else if (xfer instanceof MinMaxLengthCheckTransformer) {
            const min = xfer.minLength;
            const max = xfer.maxLength;
            const conditions: Sourcelike[] = [];

            if (min !== undefined) {
                conditions.push([variable, ".Length >= ", min.toString()]);
            }
            if (max !== undefined) {
                conditions.push([variable, ".Length <= ", max.toString()]);
            }
            this.emitLine("if (", arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        } else if (xfer instanceof MinMaxValueTransformer) {
            const min = xfer.minimum;
            const max = xfer.maximum;
            const conditions: Sourcelike[] = [];

            if (min !== undefined) {
                conditions.push([variable, " >= ", min.toString()]);
            }
            if (max !== undefined) {
                conditions.push([variable, " <= ", max.toString()]);
            }
            this.emitLine("if (", arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        } else if (xfer instanceof UnionInstantiationTransformer) {
            if (!(targetType instanceof UnionType)) {
                return panic("Union instantiation transformer must produce a union type");
            }
            const maybeNullable = nullableFromUnion(targetType);
            if (maybeNullable !== null) {
                emitFinish(variable);
            } else {
                const unionName = this.nameForNamedType(targetType);
                let initializer: Sourcelike;
                if (xfer.sourceType.kind === "null") {
                    initializer = " ";
                } else {
                    const memberName = this.nameForUnionMember(targetType, xfer.sourceType);
                    initializer = [" ", memberName, " = ", variable, " "];
                }
                emitFinish(["new ", unionName, " {", initializer, "}"]);
            }
            return true;
        } else {
            return panic("Unknown transformer");
        }
        return false;
    }

    private emitTransformation(converterName: Name, t: Type): void {
        const xf = defined(transformationForType(t));
        const reverse = xf.reverse;
        const targetType = xf.targetType;
        const xfer = xf.transformer;
        const csType = this.csType(targetType);
        // const haveNullable = isValueType(targetType);

        // if (haveNullable) {
        //     converterName = ['Nullable', converterName];
        //     csType = [csType, "?"];
        // }
        this.emitType(
            undefined,
            AccessModifier.Internal,
            "class",
            converterName,
            ["JsonConverter<", csType, ">"],
            () => {
                let canConvertExpr: Sourcelike = ["t == typeof(", csType, ")"];
                this.emitCanConvert(canConvertExpr);
                this.ensureBlankLine();
                this.emitReadJson(() => {
                    // FIXME: It's unsatisfying that we need this.  The reason is that we not
                    // only match T, but also T?.  If we didn't, then the T in T? would not be
                    // deserialized with our converter but with the default one.  Can we check
                    // whether the type is a nullable?
                    // FIXME: This could duplicate one of the cases handled below in
                    // `emitDecodeTransformer`.
                    // if (haveNullable && !(targetType instanceof UnionType)) {
                    //     this.emitLine("if (reader.TokenType == JsonTokenType.Null) return null;");
                    // }

                    const allHandled = this.emitDecodeTransformer(xfer, targetType, v =>
                        this.emitLine("return ", v, ";")
                    );
                    if (!allHandled) {
                        this.emitThrow(['"Cannot unmarshal type ', csType, '"']);
                    }
                }, csType);
                this.ensureBlankLine();
                this.emitWriteJson(
                    "value",
                    () => {
                        // FIXME: See above.
                        // if (haveNullable && !(targetType instanceof UnionType)) {
                        //     this.emitLine("if (value == null)");
                        //     this.emitBlock(() => {
                        //         this.emitLine("writer.WriteNullValue();");
                        //         this.emitLine("return;");
                        //     });
                        // }

                        const allHandled = this.emitTransformer("value", reverse.transformer, reverse.targetType, () =>
                            this.emitLine("return;")
                        );
                        if (!allHandled) {
                            this.emitThrow(['"Cannot marshal type ', csType, '"']);
                        }
                    },
                    csType
                );
                this.ensureBlankLine();
                this.emitLine("public static readonly ", converterName, " Singleton = new ", converterName, "();");
            }
        );
    }

    protected emitRequiredHelpers(): void {
        if (this._needHelpers) {
            this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitFromJsonForTopLevel(t, n));
            this.ensureBlankLine();
            this.emitSerializeClass();
        }
        if (this._needHelpers || (this._needAttributes && (this.haveNamedUnions || this.haveEnums))) {
            this.ensureBlankLine();
            this.emitConverterClass();
            this.forEachTransformation("leading-and-interposing", (n, t) => this.emitTransformation(n, t));
            this.emitMultiline(`
public class DateOnlyConverter : JsonConverter<DateOnly>
{
    private readonly string serializationFormat;
    public DateOnlyConverter() : this(null) { }

    public DateOnlyConverter(string? serializationFormat)
    {
        this.serializationFormat = serializationFormat ?? "yyyy-MM-dd";
    }

    public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var value = reader.GetString();
        return DateOnly.Parse(value!);
    }

    public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToString(serializationFormat));
}

public class TimeOnlyConverter : JsonConverter<TimeOnly>
{
    private readonly string serializationFormat;

    public TimeOnlyConverter() : this(null) { }

    public TimeOnlyConverter(string? serializationFormat)
    {
        this.serializationFormat = serializationFormat ?? "HH:mm:ss.fff";
    }

    public override TimeOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var value = reader.GetString();
        return TimeOnly.Parse(value!);
    }

    public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToString(serializationFormat));
}

internal class IsoDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
{
    public override bool CanConvert(Type t) => t == typeof(DateTimeOffset);

    private const string DefaultDateTimeFormat = "yyyy'-'MM'-'dd'T'HH':'mm':'ss.FFFFFFFK";

    private DateTimeStyles _dateTimeStyles = DateTimeStyles.RoundtripKind;
    private string? _dateTimeFormat;
    private CultureInfo? _culture;

    public DateTimeStyles DateTimeStyles
    {
        get => _dateTimeStyles;
        set => _dateTimeStyles = value;
    }

    public string? DateTimeFormat
    {
        get => _dateTimeFormat ?? string.Empty;
        set => _dateTimeFormat = (string.IsNullOrEmpty(value)) ? null : value;
    }

    public CultureInfo Culture
    {
        get => _culture ?? CultureInfo.CurrentCulture;
        set => _culture = value;
    }

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
    {
        string text;


        if ((_dateTimeStyles & DateTimeStyles.AdjustToUniversal) == DateTimeStyles.AdjustToUniversal
            || (_dateTimeStyles & DateTimeStyles.AssumeUniversal) == DateTimeStyles.AssumeUniversal)
        {
            value = value.ToUniversalTime();
        }

        text = value.ToString(_dateTimeFormat ?? DefaultDateTimeFormat, Culture);

        writer.WriteStringValue(text);
    }

    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        string? dateText = reader.GetString();
        
        if (string.IsNullOrEmpty(dateText) == false)
        {
            if (!string.IsNullOrEmpty(_dateTimeFormat))
            {
                return DateTimeOffset.ParseExact(dateText, _dateTimeFormat, Culture, _dateTimeStyles);
            }
            else
            {
                return DateTimeOffset.Parse(dateText, Culture, _dateTimeStyles);
            }
        }
        else
        {
            return default(DateTimeOffset);
        }
    }


    public static readonly IsoDateTimeOffsetConverter Singleton = new IsoDateTimeOffsetConverter();
}`);
        }
    }

    protected needNamespace(): boolean {
        return this._needNamespaces;
    }
}
