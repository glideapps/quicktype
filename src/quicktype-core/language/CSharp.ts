import { Type, EnumType, UnionType, ClassType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    camelCase
} from "../support/Strings";
import { defined, assert, panic } from "../support/Support";
import { Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
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
    ParseDateTimeTransformer,
    StringifyDateTimeTransformer
} from "../Transformers";
import { RenderContext } from "../Renderer";
import { arrayIntercalate } from "../support/Containers";

const unicode = require("unicode-properties");

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

function needTransformerForUnion(u: UnionType): boolean {
    return nullableFromUnion(u) === null;
}

export const cSharpOptions = {
    useList: new EnumOption("array-type", "Use T[] or List<T>", [["array", false], ["list", true]]),
    dense: new EnumOption("density", "Property density", [["normal", false], ["dense", true]], "normal", "secondary"),
    // FIXME: Do this via a configurable named eventually.
    namespace: new StringOption("namespace", "Generated namespace", "NAME", "QuickType"),
    version: new EnumOption<Version>("csharp-version", "C# version", [["5", 5], ["6", 6]], "6", "secondary"),
    typeForAny: new EnumOption<CSharpTypeForAny>(
        "any-type",
        'Type to use for "any"',
        [["object", "object"], ["dynamic", "dynamic"]],
        "object",
        "secondary"
    ),
    useDecimal: new EnumOption(
        "number-type",
        "Type to use for numbers",
        [["double", false], ["decimal", true]],
        "double",
        "secondary"
    )
};

export class CSharpTargetLanguage extends TargetLanguage {
    protected getOptions(): Option<any>[] {
        return [
            cSharpOptions.namespace,
            cSharpOptions.version,
            cSharpOptions.dense,
            cSharpOptions.useList,
            cSharpOptions.useDecimal,
            cSharpOptions.typeForAny
        ];
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date-time", time: "date-time", dateTime: "date-time" };
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    needsTransformerForUnion(u: UnionType): boolean {
        return needTransformerForUnion(u);
    }

    get needsTransformerForEnums(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): CSharpRenderer {
        return new CSharpRenderer(this, renderContext, getOptionValues(cSharpOptions, untypedOptionValues));
    }
}

const namingFunction = funPrefixNamer("namer", csNameStyle);

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

function isValueType(t: Type): boolean {
    if (t instanceof UnionType) {
        return nullableFromUnion(t) === null;
    }
    return ["integer", "double", "bool", "enum", "date-time"].indexOf(t.kind) >= 0;
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
        return ["QuickType", "Type", "System", "Console", "Exception", "DateTimeOffset"];
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
        return namingFunction;
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

    protected emitBlock(f: () => void, semicolon: boolean = false): void {
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}", semicolon ? ";" : "");
    }

    protected get doubleType(): string {
        return this._csOptions.useDecimal ? "decimal" : "double";
    }

    protected csType(t: Type, follow: (t: Type) => Type = followTargetType, withIssues: boolean = false): Sourcelike {
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
                if (nullable !== null) return this.nullableCSType(nullable);
                return this.nameForNamedType(unionType);
            },
            {
                dateTimeType: _ => "DateTimeOffset"
            }
        );
    }

    protected nullableCSType(t: Type, withIssues: boolean = false): Sourcelike {
        t = followTargetType(t);
        const csType = this.csType(t, noFollow, withIssues);
        if (isValueType(t)) {
            return [csType, "?"];
        } else {
            return csType;
        }
    }
    protected superclassForType(_t: Type): Sourcelike | undefined {
        return undefined;
    }
    protected emitType(
        description: string[] | undefined,
        accessModifier: AccessModifier,
        declaration: Sourcelike,
        name: Sourcelike,
        superclass: Sourcelike | undefined,
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
        if (superclass === undefined) {
            this.emitLine(declaration, " ", name);
        } else {
            this.emitLine(declaration, " ", name, " : ", superclass);
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
        const t = followTargetType(property.type);
        const csType = property.isOptional ? this.nullableCSType(t, true) : this.csType(t, noFollow, true);
        return ["public ", csType, " ", name, " { get; set; }"];
    }

    protected emitDescriptionBlock(lines: string[]): void {
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
            this.superclassForType(c),
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
            this.superclassForType(u),
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

    protected emitExpressionMember(declare: Sourcelike, define: Sourcelike, isProperty: boolean = false): void {
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
    }
}

export const newtonsoftCSharpOptions = Object.assign({}, cSharpOptions, {
    features: new EnumOption("features", "Output features", [
        ["complete", { helpers: true, attributes: true }],
        ["attributes-only", { helpers: false, attributes: true }],
        ["just-types", { helpers: false, attributes: false }]
    ]),
    checkRequired: new BooleanOption("check-required", "Fail if required properties are missing", false)
});

export class NewtonsoftCSharpTargetLanguage extends CSharpTargetLanguage {
    constructor() {
        super("C#", ["cs", "csharp"], "cs");
    }

    protected getOptions(): Option<any>[] {
        return [
            newtonsoftCSharpOptions.namespace,
            newtonsoftCSharpOptions.version,
            newtonsoftCSharpOptions.dense,
            newtonsoftCSharpOptions.useList,
            newtonsoftCSharpOptions.useDecimal,
            newtonsoftCSharpOptions.features,
            newtonsoftCSharpOptions.checkRequired,
            newtonsoftCSharpOptions.typeForAny
        ];
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): NewtonsoftCSharpRenderer {
        return new NewtonsoftCSharpRenderer(
            this,
            renderContext,
            getOptionValues(newtonsoftCSharpOptions, untypedOptionValues)
        );
    }
}

export class NewtonsoftCSharpRenderer extends CSharpRenderer {
    private readonly _enumExtensionsNames = new Map<Name, Name>();

    private readonly _needHelpers: boolean;
    private readonly _needAttributes: boolean;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof newtonsoftCSharpOptions>
    ) {
        super(targetLanguage, renderContext, _options);
        this._needHelpers = _options.features.helpers;
        this._needAttributes = _options.features.attributes;
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
        return super.forbiddenNamesForGlobalNamespace().concat(forbidden);
    }

    protected forbiddenForObjectProperties(c: ClassType, className: Name): ForbiddenWordsInfo {
        const result = super.forbiddenForObjectProperties(c, className);
        result.names = result.names.concat(["ToJson", "FromJson", "Required"]);
        return result;
    }

    protected makeNameForTransformation(_t: Type, typeName: Name | undefined): Name {
        if (typeName === undefined) {
            return panic("We shouldn't have a transformation for an unnamed type");
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
    }

    protected emitDefaultLeadingComments(): void {
        if (!this._needHelpers) return;

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

    private converterForType(_t: Type): Name | undefined {
        return undefined;
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
        this.emitType(undefined, AccessModifier.Public, [partial, typeKind], name, this.superclassForType(t), () => {
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

    private emitConverterClass(): void {
        // FIXME: Make Converter a Named
        const converterName: Sourcelike = ["Converter"];
        this.emitType(undefined, AccessModifier.Internal, "static class", converterName, undefined, () => {
            this.emitLine("public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings");
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
                this.emitLine("Converters = {");
                this.indent(() => {
                    for (const [_, converter] of this.typesWithNamedTransformations) {
                        this.emitLine("new ", converter, "(),");
                    }
                    this.emitLine("new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }");
                });
                this.emitLine(`},`);
            }, true);
        });
    }

    private emitDecoderTransformerCase(
        tokenCases: string[],
        varName: string,
        xfer: Transformer | undefined,
        targetType: Type
    ): void {
        if (xfer === undefined) return;

        for (const tokenCase of tokenCases) {
            this.emitTokenCase(tokenCase);
        }

        const deserialized = this.deserializeTypeCode(this.csType(xfer.sourceType, followTargetType));
        this.indent(() => {
            this.emitLine("var ", varName, " = ", deserialized, ";");
            const allHandled = this.emitTransformer(varName, xfer, targetType);
            if (!allHandled) {
                this.emitLine("break;");
            }
        });
    }

    private emitConsume(value: Sourcelike, consumer: Transformer | undefined, targetType: Type): boolean {
        if (consumer === undefined) {
            this.emitLine("return ", value, ";");
            return true;
        } else {
            return this.emitTransformer(value, consumer, targetType);
        }
    }

    private emitDecodeTransformer(xfer: Transformer, targetType: Type): boolean {
        if (xfer instanceof DecodingTransformer) {
            this.emitLine("var value = ", this.deserializeTypeCode(this.csType(xfer.sourceType, noFollow)), ";");
            return this.emitConsume("value", xfer.consumer, targetType);
        } else if (xfer instanceof DecodingChoiceTransformer) {
            this.emitDecoderSwitch(() => {
                const nullTransformer = xfer.nullTransformer;
                if (nullTransformer !== undefined) {
                    this.emitTokenCase("Null");
                    this.indent(() => {
                        const allHandled = this.emitTransformer("null", nullTransformer, targetType);
                        if (!allHandled) {
                            this.emitLine("break");
                        }
                    });
                }
                this.emitDecoderTransformerCase(["Integer"], "integerValue", xfer.integerTransformer, targetType);
                this.emitDecoderTransformerCase(
                    xfer.integerTransformer === undefined ? ["Integer", "Float"] : ["Float"],
                    "doubleValue",
                    xfer.doubleTransformer,
                    targetType
                );
                this.emitDecoderTransformerCase(["Boolean"], "boolValue", xfer.boolTransformer, targetType);
                this.emitDecoderTransformerCase(["String", "Date"], "stringValue", xfer.stringTransformer, targetType);
                this.emitDecoderTransformerCase(["StartObject"], "objectValue", xfer.objectTransformer, targetType);
                this.emitDecoderTransformerCase(["StartArray"], "arrayValue", xfer.arrayTransformer, targetType);
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

    private emitTransformer(variable: Sourcelike, xfer: Transformer, targetType: Type): boolean {
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
                            const allDone = this.emitTransformer(variable, matchXfer.transformer, targetType);
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
                    this.emitTransformer(variable, caseXfer, targetType);
                }
            }
        } else if (xfer instanceof UnionMemberMatchTransformer) {
            let test: Sourcelike;
            let member: Sourcelike;
            if (xfer.memberType.kind === "null") {
                test = [variable, ".IsNull"];
                member = "null";
            } else {
                const memberName = this.nameForUnionMember(xfer.sourceType, xfer.memberType);
                member = [variable, ".", memberName];
                test = [member, " != null"];
            }
            this.emitLine("if (", test, ")");
            this.emitBlock(() => this.emitTransformer(member, xfer.transformer, targetType));
        } else if (xfer instanceof StringMatchTransformer) {
            const value = this.stringCaseValue(followTargetType(xfer.sourceType), xfer.stringCase);
            this.emitLine("if (", variable, " == ", value, ")");
            this.emitBlock(() => this.emitTransformer(variable, xfer.transformer, targetType));
        } else if (xfer instanceof EncodingTransformer) {
            this.emitLine(this.serializeValueCode(variable), "; return;");
            return true;
        } else if (xfer instanceof ParseDateTimeTransformer) {
            this.emitLine("DateTimeOffset dt;");
            this.emitLine("if (DateTimeOffset.TryParse(", variable, ", out dt))");
            this.emitBlock(() => this.emitConsume("dt", xfer.consumer, targetType));
        } else if (xfer instanceof StringifyDateTimeTransformer) {
            return this.emitConsume([variable, ".ToString()"], xfer.consumer, targetType);
        } else if (xfer instanceof StringProducerTransformer) {
            const value = this.stringCaseValue(directTargetType(xfer.consumer), xfer.result);
            return this.emitConsume(value, xfer.consumer, targetType);
        } else if (xfer instanceof UnionInstantiationTransformer) {
            if (!(targetType instanceof UnionType)) {
                return panic("Union instantiation transformer must produce a union type");
            }
            const unionName = this.nameForNamedType(targetType);
            let initializer: Sourcelike;
            if (xfer.sourceType.kind === "null") {
                initializer = " ";
            } else {
                const memberName = this.nameForUnionMember(targetType, xfer.sourceType);
                initializer = [" ", memberName, " = ", variable, " "];
            }
            this.emitLine("return new ", unionName, " {", initializer, "};");
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
            const csType = this.csType(targetType, noFollow);
            this.emitCanConvert(["t == typeof(", csType, ") || t == typeof(", csType, "?)"]);
            this.ensureBlankLine();
            this.emitReadJson(() => {
                // FIXME: It's unsatisfying that we need this.  The reason is that we not
                // only match T, but also T?.  If we didn't, then the T in T? would not be
                // deserialized with our converter but with the default one.
                this.emitLine("if (reader.TokenType == JsonToken.Null) return null;");
                const allHandled = this.emitDecodeTransformer(xfer, targetType);
                if (!allHandled) {
                    this.emitThrow(['"Cannot unmarshal type ', csType, '"']);
                }
            });
            this.ensureBlankLine();
            this.emitWriteJson("untypedValue", () => {
                this.emitLine("var value = (", csType, ")untypedValue;");
                const allHandled = this.emitTransformer("value", reverse.transformer, reverse.targetType);
                if (!allHandled) {
                    this.emitThrow(['"Cannot marshal type ', csType, '"']);
                }
            });
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
        }
        this.forEachTransformation("leading-and-interposing", (n, t) => this.emitTransformation(n, t));
    }

    protected needNamespace(): boolean {
        return this._needHelpers || this._needAttributes;
    }
}
