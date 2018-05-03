import { OrderedSet, Map, Set } from "immutable";
import * as handlebars from "handlebars";

import { TypeKind, Type, EnumType, UnionType, ClassType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { TypeGraph } from "../TypeGraph";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    camelCase
} from "../Strings";
import { intercalate, defined, assert, panic, StringMap } from "../Support";
import { Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { StringOption, EnumOption, Option, BooleanOption } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { StringTypeMapping } from "../TypeBuilder";
import {
    followTargetType,
    transformationForType,
    Transformer,
    DecodingTransformer,
    UnionInstantiationTransformer,
    ChoiceTransformer,
    UnionMemberMatchTransformer,
    EncodingTransformer
} from "../Transformers";

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
    const supportedKinds: TypeKind[] = ["integer", "double", "bool", "string", "class"];
    return u.members.every(t => supportedKinds.indexOf(t.kind) >= 0);
}

export default class CSharpTargetLanguage extends TargetLanguage {
    private readonly _listOption = new EnumOption("array-type", "Use T[] or List<T>", [
        ["array", false],
        ["list", true]
    ]);
    private readonly _denseOption = new EnumOption(
        "density",
        "Property density",
        [["normal", false], ["dense", true]],
        "normal",
        "secondary"
    );
    private readonly _featuresOption = new EnumOption("features", "Output features", [
        ["complete", { helpers: true, attributes: true }],
        ["attributes-only", { helpers: false, attributes: true }],
        ["just-types", { helpers: false, attributes: false }]
    ]);
    // FIXME: Do this via a configurable named eventually.
    private readonly _namespaceOption = new StringOption("namespace", "Generated namespace", "NAME", "QuickType");
    private readonly _versionOption = new EnumOption<Version>(
        "csharp-version",
        "C# version",
        [["5", 5], ["6", 6]],
        "6",
        "secondary"
    );
    private readonly _checkRequiredOption = new BooleanOption(
        "check-required",
        "Fail if required properties are missing",
        false
    );
    private readonly _typeForAnyOption = new EnumOption<CSharpTypeForAny>(
        "any-type",
        'Type to use for "any"',
        [["object", "object"], ["dynamic", "dynamic"]],
        "object",
        "secondary"
    );
    private readonly _useDecimalOption = new EnumOption(
        "number-type",
        "Type to use for numbers",
        [["double", false], ["decimal", true]],
        "double",
        "secondary"
    );

    constructor() {
        super("C#", ["cs", "csharp"], "cs");
    }

    protected getOptions(): Option<any>[] {
        return [
            this._namespaceOption,
            this._versionOption,
            this._denseOption,
            this._listOption,
            this._useDecimalOption,
            this._featuresOption,
            this._checkRequiredOption,
            this._typeForAnyOption
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

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return NewtonsoftCSharpRenderer;
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
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        protected readonly namespaceName: string,
        private readonly _version: Version,
        protected readonly dense: boolean,
        private readonly _useList: boolean,
        private readonly _useDecimal: boolean,
        private readonly _typeForAny: CSharpTypeForAny
    ) {
        super(targetLanguage, graph, leadingComments);
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
        return this._useDecimal ? "decimal" : "double";
    }

    protected csType(t: Type, follow: (t: Type) => Type = followTargetType, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            follow(t),
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, this._typeForAny),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, this._typeForAny),
            _boolType => "bool",
            _integerType => "long",
            _doubleType => this.doubleType,
            _stringType => "string",
            arrayType => {
                const itemsType = this.csType(arrayType.items, follow, withIssues);
                if (this._useList) {
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
        const csType = this.csType(t, followTargetType, withIssues);
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

    protected attributesForProperty(_property: ClassProperty, _jsonName: string): Sourcelike[] | undefined {
        return undefined;
    }

    protected emitDescriptionBlock(lines: string[]): void {
        const start = "/// <summary>";
        if (this.dense) {
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
                if (c.getProperties().isEmpty()) return;
                const blankLines = this.blankLinesBetweenAttributes() ? "interposing" : "none";
                let columns: Sourcelike[][] = [];
                let isFirstProperty = true;
                let previousDescription: string[] | undefined = undefined;
                this.forEachClassProperty(c, blankLines, (name, jsonName, p) => {
                    const t = followTargetType(p.type);
                    const csType = p.isOptional ? this.nullableCSType(t, true) : this.csType(t, noFollow, true);
                    const attributes = this.attributesForProperty(p, jsonName);
                    const description = this.descriptionForClassProperty(c, jsonName);
                    const property = ["public ", csType, " ", name, " { get; set; }"];
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
                    } else if (this.dense && attributes.length > 0) {
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
        const nonNulls = removeNullFromUnion(u)[1];
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

    protected emitExpressionMember(declare: Sourcelike, define: Sourcelike): void {
        if (this._version === 5) {
            this.emitLine(declare);
            this.emitBlock(() => {
                this.emitLine("return ", define, ";");
            });
        } else {
            this.emitLine(declare, " => ", define, ";");
        }
    }

    protected emitTypeSwitch<T extends Sourcelike>(
        types: OrderedSet<T>,
        condition: (t: T) => Sourcelike,
        withBlock: boolean,
        withReturn: boolean,
        f: (t: T) => void
    ): void {
        assert(!withReturn || withBlock, "Can only have return with block");
        types.forEach(t => {
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
        });
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
            this.emitLine("namespace ", this.namespaceName);
            this.emitBlock(() => {
                this.emitUsings();
                this.emitTypesAndSupport();
            });
        } else {
            this.emitUsings();
            this.emitTypesAndSupport();
        }
    }

    protected registerHandlebarsHelpers(context: StringMap): void {
        super.registerHandlebarsHelpers(context);
        handlebars.registerHelper("string_escape", utf16StringEscape);
    }

    protected makeHandlebarsContextForType(t: Type): StringMap {
        const ctx = super.makeHandlebarsContextForType(t);
        ctx.csType = this.sourcelikeToString(this.csType(t));
        return ctx;
    }

    protected makeHandlebarsContextForUnionMember(t: Type, name: Name): StringMap {
        const value = super.makeHandlebarsContextForUnionMember(t, name);
        value.nullableCSType = this.sourcelikeToString(this.nullableCSType(t));
        return value;
    }
}

export class NewtonsoftCSharpRenderer extends CSharpRenderer {
    private _enumExtensionsNames = Map<Name, Name>();

    private readonly _needHelpers: boolean;
    private readonly _needAttributes: boolean;

    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        namespaceName: string,
        version: Version,
        dense: boolean,
        useList: boolean,
        useDecimal: boolean,
        outputFeatures: OutputFeatures,
        private readonly _checkRequiredProperties: boolean,
        typeForAny: CSharpTypeForAny
    ) {
        super(targetLanguage, graph, leadingComments, namespaceName, version, dense, useList, useDecimal, typeForAny);
        this._needHelpers = outputFeatures.helpers;
        this._needAttributes = outputFeatures.attributes;
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
        if (this.dense) {
            forbidden.push("J", "R", "N");
        }
        return super.forbiddenNamesForGlobalNamespace().concat(forbidden);
    }

    protected forbiddenForObjectProperties(c: ClassType, className: Name): ForbiddenWordsInfo {
        const result = super.forbiddenForObjectProperties(c, className);
        result.names = result.names.concat(["ToJson", "FromJson", "Required"]);
        return result;
    }

    protected makeTransformationNamer(): Namer {
        return funPrefixNamer("transformation-namer", n => csNameStyle(`${n}_converter`));
    }

    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];

        const extensionsName = new DependencyName(namingFunction, name.order, lookup => `${lookup(name)}_extensions`);
        this._enumExtensionsNames = this._enumExtensionsNames.set(name, extensionsName);
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

        if (this.dense) {
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
        this.emitLine("//    using ", this.namespaceName, ";");
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
        /*
        for (;;) {
            const name = this.nameForTransformation(t);
            if (name !== undefined) {
                return name;
            }
            if (t instanceof ArrayType) {
                t = t.items;
            } else if (t instanceof MapType) {
                t = t.values;
            } else {
                return undefined;
            }
        }
        */
    }

    protected attributesForProperty(property: ClassProperty, jsonName: string): Sourcelike[] | undefined {
        if (!this._needAttributes) return undefined;

        const attributes: Sourcelike[] = [];

        const jsonProperty = this.dense ? denseJsonPropertyName : "JsonProperty";
        const escapedName = utf16StringEscape(jsonName);
        const isNullable = followTargetType(property.type).isNullable;
        const isOptional = property.isOptional;
        const requiredClass = this.dense ? "R" : "Required";
        const nullValueHandlingClass = this.dense ? "N" : "NullValueHandling";
        const nullValueHandling =
            isOptional && !isNullable ? [", NullValueHandling = ", nullValueHandlingClass, ".Ignore"] : [];
        let required: Sourcelike;
        if (!this._checkRequiredProperties || (isOptional && isNullable)) {
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
        return this._needAttributes && !this.dense;
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
                ["JsonConvert.DeserializeObject<", csType, ">(json, ", this.namespaceName, ".Converter.Settings)"]
            );
        });
    }

    private emitEnumExtension(e: EnumType, enumName: Name): void {
        this.emitType(
            undefined,
            AccessModifier.None,
            "static class",
            defined(this._enumExtensionsNames.get(enumName)),
            this.superclassForType(e),
            () => {
                this.emitLine("public static ", enumName, "? ValueForString(string str)");
                this.emitBlock(() => {
                    this.emitLine("switch (str)");
                    this.emitBlock(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            this.emitLine(
                                'case "',
                                utf16StringEscape(jsonName),
                                '": return ',
                                enumName,
                                ".",
                                name,
                                ";"
                            );
                        });
                        this.emitLine("default: return null;");
                    });
                });
                this.ensureBlankLine();
                this.emitLine("public static ", enumName, " ReadJson(JsonReader reader, JsonSerializer serializer)");
                this.emitBlock(() => {
                    this.emitLine("var str = ", this.deserializeTypeCode("string"), ";");
                    this.emitLine("var maybeValue = ValueForString(str);");
                    this.emitLine("if (maybeValue.HasValue) return maybeValue.Value;");
                    this.emitLine('throw new Exception("Unknown enum case " + str);');
                });
                this.ensureBlankLine();
                this.emitLine(
                    "public static void WriteJson(this ",
                    enumName,
                    " value, JsonWriter writer, JsonSerializer serializer)"
                );
                this.emitBlock(() => {
                    this.emitLine("switch (value)");
                    this.emitBlock(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            this.emitLine(
                                "case ",
                                enumName,
                                ".",
                                name,
                                ": ",
                                this.serializeValueCode(['"', utf16StringEscape(jsonName), '"']),
                                "; break;"
                            );
                        });
                    });
                });
            }
        );
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

    private emitUnionJSONPartial(u: UnionType, unionName: Name): void {
        const emitNullDeserializer = (): void => {
            this.emitTokenCase("Null");
            this.indent(() => this.emitLine("return;"));
        };

        const emitDeserializeType = (t: Type): void => {
            this.emitLine(this.nameForUnionMember(u, t), " = ", this.deserializeTypeCode(this.csType(t)), ";");
            this.emitLine("return;");
        };

        const emitDeserializer = (tokenType: string, kind: TypeKind): void => {
            const t = u.findMember(kind);
            if (t === undefined) return;

            this.emitTokenCase(tokenType);
            this.indent(() => emitDeserializeType(t));
        };

        const emitDoubleDeserializer = (): void => {
            const t = u.findMember("double");
            if (t === undefined) return;

            if (u.findMember("integer") === undefined) this.emitTokenCase("Integer");
            this.emitTokenCase("Float");
            this.indent(() => emitDeserializeType(t));
        };

        const emitStringDeserializer = (): void => {
            const stringTypes = u.stringTypeMembers;
            if (stringTypes.isEmpty()) return;
            this.emitTokenCase("String");
            this.emitTokenCase("Date");
            this.indent(() => {
                if (stringTypes.size === 1) {
                    emitDeserializeType(defined(stringTypes.first()));
                    return;
                }
                this.emitLine("var str = ", this.deserializeTypeCode("string"), ";");
                this.forEachUnionMember(u, stringTypes, "none", null, (fieldName, t) => {
                    if (t instanceof EnumType) {
                        const extension = defined(this._enumExtensionsNames.get(this.nameForNamedType(t)));
                        this.emitLine("var maybeEnum = ", extension, ".ValueForString(str);");
                        this.emitLine("if (maybeEnum.HasValue)");
                        this.emitBlock(() => {
                            this.emitLine(fieldName, " = maybeEnum.Value;");
                            this.emitLine("return;");
                        });
                    } else if (t.kind === "date-time") {
                        this.emitLine("DateTimeOffset  dt;");
                        this.emitLine("if (DateTimeOffset.TryParse(str, out dt))");
                        this.emitBlock(() => {
                            this.emitLine(fieldName, " = dt;");
                            this.emitLine("return;");
                        });
                    } else {
                        return panic(`Unsupported string enum type ${t.kind}`);
                    }
                });
                this.emitLine("break;");
            });
        };

        const [hasNull, nonNulls] = removeNullFromUnion(u);
        this.emitType(undefined, AccessModifier.Public, "partial struct", unionName, this.superclassForType(u), () => {
            this.emitLine("public ", unionName, "(JsonReader reader, JsonSerializer serializer)");
            this.emitBlock(() => {
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, _) => {
                    this.emitLine(fieldName, " = null;");
                });
                this.ensureBlankLine();
                this.emitDecoderSwitch(() => {
                    if (hasNull !== null) emitNullDeserializer();
                    emitDeserializer("Integer", "integer");
                    emitDoubleDeserializer();
                    emitDeserializer("Boolean", "bool");
                    emitDeserializer("StartArray", "array");
                    emitDeserializer("StartObject", "class");
                    emitDeserializer("StartObject", "map");
                    emitStringDeserializer();
                });
                this.emitThrow(['"Cannot convert ', unionName, '"']);
            });
            this.ensureBlankLine();
            this.emitLine("public void WriteJson(JsonWriter writer, JsonSerializer serializer)");
            this.emitBlock(() => {
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, _) => {
                    this.emitLine("if (", fieldName, " != null)");
                    this.emitBlock(() => {
                        this.emitLine(this.serializeValueCode(fieldName), ";");
                        this.emitLine("return;");
                    });
                });
                if (hasNull !== null) {
                    this.emitLine("writer.WriteNull();");
                } else {
                    this.emitThrow('"Union must not be null"');
                }
            });
        });
    }

    private emitSerializeClass(): void {
        // FIXME: Make Serialize a Named
        this.emitType(undefined, AccessModifier.Public, "static class", "Serialize", undefined, () => {
            // Sometimes multiple top-levels will resolve to the same type, so we have to take care
            // not to emit more than one extension method for the same type.
            let seenTypes = Set<Type>();
            this.forEachTopLevel("none", t => {
                // FIXME: Make ToJson a Named
                if (!seenTypes.has(t)) {
                    seenTypes = seenTypes.add(t);
                    this.emitExpressionMember(
                        ["public static string ToJson(this ", this.topLevelResultType(t), " self)"],
                        ["JsonConvert.SerializeObject(self, ", this.namespaceName, ".Converter.Settings)"]
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

    private emitConverterMembers(enumNames: OrderedSet<Name>, unionNames: OrderedSet<Name>): void {
        const allNames = enumNames.union(unionNames);
        const canConvertExprs = allNames.map((n: Name): Sourcelike => ["t == typeof(", n, ")"]);
        const nullableCanConvertExprs = allNames.map((n: Name): Sourcelike => ["t == typeof(", n, "?)"]);
        const canConvertExpr = intercalate(" || ", canConvertExprs.union(nullableCanConvertExprs));
        // FIXME: make Iterable<any, Sourcelike> a Sourcelike, too?
        this.emitCanConvert(canConvertExpr.toArray());
        this.ensureBlankLine();
        this.emitReadJson(() => {
            this.emitTypeSwitch(enumNames, t => ["t == typeof(", t, ")"], false, false, n => {
                const extensionsName = defined(this._enumExtensionsNames.get(n));
                this.emitLine("return ", extensionsName, ".ReadJson(reader, serializer);");
            });
            this.emitTypeSwitch(enumNames, t => ["t == typeof(", t, "?)"], true, false, n => {
                this.emitLine("if (reader.TokenType == JsonToken.Null) return null;");
                const extensionsName = defined(this._enumExtensionsNames.get(n));
                this.emitLine("return ", extensionsName, ".ReadJson(reader, serializer);");
            });
            // FIXME: call the constructor via reflection?
            this.emitTypeSwitch(unionNames, t => ["t == typeof(", t, ") || t == typeof(", t, "?)"], false, false, n => {
                this.emitLine("return new ", n, "(reader, serializer);");
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
        this.ensureBlankLine();
        this.emitWriteJson("value", () => {
            this.emitLine("var t = value.GetType();");
            this.emitTypeSwitch(allNames, t => ["t == typeof(", t, ")"], true, true, n => {
                this.emitLine("((", n, ")value).WriteJson(writer, serializer);");
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
    }

    private emitConverterClass(): void {
        const enumNames = this.enums.map(this.nameForNamedType);
        const unionNames = this.namedUnions.filterNot(needTransformerForUnion).map(this.nameForNamedType);
        const jsonConverter = enumNames.size + unionNames.size > 0;
        // FIXME: Make Converter a Named
        const converterName: Sourcelike = ["Converter"];
        const superclass = jsonConverter ? "JsonConverter" : undefined;
        const staticOrNot = jsonConverter ? "" : "static ";
        this.emitType(undefined, AccessModifier.Internal, [staticOrNot, "class"], converterName, superclass, () => {
            if (jsonConverter) {
                this.emitConverterMembers(enumNames, unionNames);
                this.ensureBlankLine();
            }
            this.emitLine("public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings");
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
                this.emitLine("Converters = {");
                this.indent(() => {
                    if (jsonConverter) {
                        this.emitLine("new Converter(),");
                    }
                    this.typesWithNamedTransformations.forEach(converter => {
                        this.emitLine("new ", converter, "(),");
                    });
                    this.emitLine("new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }");
                });
                this.emitLine(`},`);
            }, true);
        });
    }

    private emitDecoderTransformerCase(tokenCases: string[], xfer: Transformer | undefined, targetType: Type): void {
        if (xfer === undefined) return;

        for (const tokenCase of tokenCases) {
            this.emitTokenCase(tokenCase);
        }

        this.indent(() => {
            const value: Sourcelike = this.deserializeTypeCode(this.csType(xfer.sourceType, noFollow));
            if (xfer instanceof UnionInstantiationTransformer) {
                if (!(targetType instanceof UnionType)) {
                    return panic("Union instantiation transformer must produce a union type");
                }

                this.emitLine(
                    "return new ",
                    this.nameForNamedType(targetType),
                    " { ",
                    this.nameForUnionMember(targetType, xfer.sourceType),
                    " = ",
                    value,
                    " };"
                );
            } else {
                return panic("Unknown transformer");
            }
        });
    }

    private emitDecodeTransformer(xfer: Transformer, targetType: Type): void {
        if (xfer instanceof DecodingTransformer) {
            this.emitDecoderSwitch(() => {
                this.emitDecoderTransformerCase(["Integer"], xfer.integerTransformer, targetType);
                this.emitDecoderTransformerCase(
                    xfer.integerTransformer === undefined ? ["Integer", "Float"] : ["Float"],
                    xfer.doubleTransformer,
                    targetType
                );
                this.emitDecoderTransformerCase(["Boolean"], xfer.boolTransformer, targetType);
                this.emitDecoderTransformerCase(["String", "Date"], xfer.stringTransformer, targetType);
                this.emitDecoderTransformerCase(["StartObject"], xfer.objectTransformer, targetType);
            });

            // FIXME: Put type name into message if there is one
            this.emitThrow('"Cannot convert"');
        } else {
            return panic("Unknown transformer");
        }
    }

    private emitTransformer(variable: Sourcelike, xfer: Transformer, targetType: Type): void {
        if (xfer instanceof ChoiceTransformer) {
            xfer.transformers.forEach(caseXfer => this.emitTransformer(variable, caseXfer, targetType));
        } else if (xfer instanceof UnionMemberMatchTransformer) {
            const memberName = this.nameForUnionMember(xfer.sourceType, xfer.memberType);
            const member: Sourcelike = [variable, ".", memberName];
            this.emitLine("if (", member, " != null)");
            this.emitBlock(() => this.emitTransformer(member, xfer.transformer, targetType));
        } else if (xfer instanceof EncodingTransformer) {
            this.emitLine(this.serializeValueCode(variable), "; return;");
        } else {
            return panic("Unknown transformer");
        }
    }

    private emitTransformation(converterName: Name, t: Type): void {
        const xf = defined(transformationForType(t));
        const targetType = xf.targetType;
        const xfer = xf.transformer;
        this.emitType(undefined, AccessModifier.Internal, "class", converterName, "JsonConverter", () => {
            const csType = this.csType(targetType, noFollow);
            this.emitCanConvert(["t == typeof(", csType, ") || t == typeof(", csType, "?)"]);
            this.ensureBlankLine();
            this.emitReadJson(() => {
                this.emitDecodeTransformer(xfer, targetType);
            });
            this.ensureBlankLine();
            this.emitWriteJson("untypedValue", () => {
                this.emitLine("var value = (", csType, ")untypedValue;");
                this.emitTransformer("value", xf.reverseTransformer, xf.sourceType);

                // FIXME: Only throw if there's the possibility of it not being exhaustive
                // FIXME: Put type name into message if there is one
                this.emitThrow('"Cannot convert"');
            });
        });
    }

    protected emitRequiredHelpers(): void {
        if (this._needHelpers) {
            this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitFromJsonForTopLevel(t, n));
            this.forEachEnum("leading-and-interposing", (e, n) => this.emitEnumExtension(e, n));
            this.forEachUnion("leading-and-interposing", (u, n) => {
                if (needTransformerForUnion(u)) return;
                this.emitUnionJSONPartial(u, n);
            });
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

    protected makeHandlebarsContextForType(t: Type): StringMap {
        const ctx = super.makeHandlebarsContextForType(t);
        if (t.kind === "enum") {
            const name = this.nameForNamedType(t);
            ctx.extensionsName = defined(this.names.get(defined(this._enumExtensionsNames.get(name))));
        }
        return ctx;
    }
}
