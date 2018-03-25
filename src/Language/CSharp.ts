"use strict";

import { OrderedSet, Map } from "immutable";
import * as handlebars from "handlebars";

import {
    TypeKind,
    Type,
    EnumType,
    UnionType,
    ClassType,
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
    directlyReachableSingleNamedType
} from "../Type";
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
import { StringOption, EnumOption, Option } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { StringTypeMapping } from "../TypeBuilder";

const unicode = require("unicode-properties");

export type Version = 5 | 6;
export type OutputFeatures = { helpers: boolean; attributes: boolean };

export enum AccessModifier {
    None,
    Public,
    Internal
}

export default class CSharpTargetLanguage extends TargetLanguage {
    private readonly _listOption = new EnumOption("array-type", "Use T[] or List<T>", [
        ["array", false],
        ["list", true]
    ]);
    private readonly _denseOption = new EnumOption("density", "Property density", [["normal", false], ["dense", true]]);
    private readonly _featuresOption = new EnumOption("features", "Output features", [
        ["complete", { helpers: true, attributes: true }],
        ["attributes-only", { helpers: false, attributes: true }],
        ["just-types", { helpers: false, attributes: false }]
    ]);
    // FIXME: Do this via a configurable named eventually.
    private readonly _namespaceOption = new StringOption("namespace", "Generated namespace", "NAME", "QuickType");
    private readonly _versionOption = new EnumOption<Version>("csharp-version", "C# version", [["6", 6], ["5", 5]]);

    constructor() {
        super("C#", ["cs", "csharp"], "cs");
    }

    protected getOptions(): Option<any>[] {
        return [this._namespaceOption, this._versionOption, this._denseOption, this._listOption, this._featuresOption];
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date-time", time: "date-time", dateTime: "date-time" };
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
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
    return ["integer", "double", "bool", "enum", "date-time"].indexOf(t.kind) >= 0;
}

export class CSharpRenderer extends ConvenienceRenderer {
    protected readonly needHelpers: boolean;
    protected readonly needAttributes: boolean;

    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        protected readonly namespaceName: string,
        private readonly _version: Version,
        protected readonly dense: boolean,
        private readonly _useList: boolean,
        outputFeatures: OutputFeatures
    ) {
        super(targetLanguage, graph, leadingComments);
        this.needHelpers = outputFeatures.helpers;
        this.needAttributes = outputFeatures.attributes;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["QuickType", "Type", "System", "Console", "Exception"];
    }

    protected forbiddenForClassProperties(_: ClassType, classNamed: Name): ForbiddenWordsInfo {
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

    protected topLevelNameStyle(rawName: string): string {
        return csNameStyle(rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForClassProperty(): Namer {
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

    protected csType(t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "object"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "object"),
            _boolType => "bool",
            _integerType => "long",
            _doubleType => "double",
            _stringType => "string",
            arrayType => {
                const itemsType = this.csType(arrayType.items, withIssues);
                if (this._useList) {
                    return ["List<", itemsType, ">"];
                } else {
                    return [itemsType, "[]"];
                }
            },
            classType => this.nameForNamedType(classType),
            mapType => ["Dictionary<string, ", this.csType(mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.nullableCSType(nullable);
                return this.nameForNamedType(unionType);
            },
            {
                dateTimeType: _ => "System.DateTimeOffset"
            }
        );
    }

    protected nullableCSType(t: Type): Sourcelike {
        const csType = this.csType(t);
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

    protected attributeForProperty(_jsonName: string): Sourcelike | undefined {
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

    private emitClassDefinition(c: ClassType, className: Name): void {
        this.emitType(
            this.descriptionForType(c),
            AccessModifier.Public,
            "partial class",
            className,
            this.superclassForType(c),
            () => {
                if (c.properties.isEmpty()) return;
                const blankLines = this.needAttributes && !this.dense ? "interposing" : "none";
                let columns: Sourcelike[][] = [];
                let isFirstProperty = true;
                let previousDescription: string[] | undefined = undefined;
                this.forEachClassProperty(c, blankLines, (name, jsonName, p) => {
                    const csType = this.csType(p.type, true);
                    const attribute = this.attributeForProperty(jsonName);
                    const description = this.descriptionForClassProperty(c, jsonName);
                    const property = ["public ", csType, " ", name, " { get; set; }"];
                    if (!this.needAttributes) {
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
                    } else if (this.dense && attribute !== undefined) {
                        const comment = description === undefined ? "" : ` // ${description.join("; ")}`;
                        columns.push([attribute, " ", property, comment]);
                    } else {
                        this.emitDescription(description);
                        if (attribute !== undefined) {
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
        for (const ns of ["System", "System.Collections.Generic", "System.Net"]) {
            this.emitUsing(ns);
        }
    }

    protected emitRequiredHelpers(): void {
        return;
    }

    private emitTypesAndSupport = (): void => {
        if (this.needAttributes || this.needHelpers) {
            this.emitUsings();
        }
        this.forEachClass("leading-and-interposing", (c, name) => this.emitClassDefinition(c, name));
        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnionDefinition(u, name));
        this.emitRequiredHelpers();
    };

    protected emitDefaultLeadingComments(): void {
        return;
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (this.needHelpers) {
            this.emitDefaultLeadingComments();
        }

        this.ensureBlankLine();
        if (this.needHelpers || this.needAttributes) {
            this.emitLine("namespace ", this.namespaceName);
            this.emitBlock(this.emitTypesAndSupport);
        } else {
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

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return super
            .forbiddenNamesForGlobalNamespace()
            .concat([
                "Converter",
                "JsonConverter",
                "JsonSerializer",
                "JsonWriter",
                "JsonToken",
                "Serialize",
                "Newtonsoft",
                "MetadataPropertyHandling",
                "DateParseHandling"
            ]);
    }

    protected forbiddenForClassProperties(c: ClassType, className: Name): ForbiddenWordsInfo {
        const result = super.forbiddenForClassProperties(c, className);
        result.names = result.names.concat(["ToJson", "FromJson"]);
        return result;
    }

    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];

        const extensionsName = new DependencyName(namingFunction, name.order, lookup => `${lookup(name)}_extensions`);
        this._enumExtensionsNames = this._enumExtensionsNames.set(name, extensionsName);
        return [extensionsName];
    }

    protected emitUsings(): void {
        super.emitUsings();
        this.ensureBlankLine();

        for (const ns of ["System.Globalization", "Newtonsoft.Json", "Newtonsoft.Json.Converters"]) {
            this.emitUsing(ns);
        }

        if (this.dense) {
            this.emitUsing([denseJsonPropertyName, " = Newtonsoft.Json.JsonPropertyAttribute"]);
        }
    }

    protected emitDefaultLeadingComments(): void {
        this.emitLine(
            "// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do",
            this.topLevels.size === 1 ? "" : " one of these",
            ":"
        );
        this.emitLine("//");
        this.emitLine("//    using ", this.namespaceName, ";");
        this.emitLine("//");
        this.forEachTopLevel("none", (_, topLevelName) => {
            this.emitLine(
                "//    var ",
                modifySource(camelCase, topLevelName),
                " = ",
                topLevelName,
                ".FromJson(jsonString);"
            );
        });
    }

    protected attributeForProperty(jsonName: string): Sourcelike {
        const jsonProperty = this.dense ? denseJsonPropertyName : "JsonProperty";
        const escapedName = utf16StringEscape(jsonName);
        return ["[", jsonProperty, '("', escapedName, '")]'];
    }

    private emitFromJsonForTopLevel(t: Type, name: Name): void {
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
        const csType = this.csType(t);
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
                    this.emitLine("var str = serializer.Deserialize<string>(reader);");
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
                                ': serializer.Serialize(writer, "',
                                utf16StringEscape(jsonName),
                                '"); break;'
                            );
                        });
                    });
                });
            }
        );
    }

    private emitUnionJSONPartial(u: UnionType, unionName: Name): void {
        const tokenCase = (tokenType: string): void => {
            this.emitLine("case JsonToken.", tokenType, ":");
        };

        const emitNullDeserializer = (): void => {
            tokenCase("Null");
            this.indent(() => this.emitLine("return;"));
        };

        const emitDeserializeType = (t: Type): void => {
            this.emitLine(this.nameForUnionMember(u, t), " = serializer.Deserialize<", this.csType(t), ">(reader);");
            this.emitLine("return;");
        };

        const emitDeserializer = (tokenType: string, kind: TypeKind): void => {
            const t = u.findMember(kind);
            if (t === undefined) return;

            tokenCase(tokenType);
            this.indent(() => emitDeserializeType(t));
        };

        const emitDoubleDeserializer = (): void => {
            const t = u.findMember("double");
            if (t === undefined) return;

            if (u.findMember("integer") === undefined) tokenCase("Integer");
            tokenCase("Float");
            this.indent(() => emitDeserializeType(t));
        };

        const emitStringDeserializer = (): void => {
            const stringTypes = u.stringTypeMembers;
            if (stringTypes.isEmpty()) return;
            tokenCase("String");
            tokenCase("Date");
            this.indent(() => {
                if (stringTypes.size === 1) {
                    emitDeserializeType(defined(stringTypes.first()));
                    return;
                }
                this.emitLine("var str = serializer.Deserialize<string>(reader);");
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
                        this.emitLine("System.DateTimeOffset  dt;");
                        this.emitLine("if (System.DateTimeOffset .TryParse(str, out dt))");
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
                this.emitLine("switch (reader.TokenType)");
                this.emitBlock(() => {
                    if (hasNull !== null) emitNullDeserializer();
                    emitDeserializer("Integer", "integer");
                    emitDoubleDeserializer();
                    emitDeserializer("Boolean", "bool");
                    emitDeserializer("StartArray", "array");
                    emitDeserializer("StartObject", "class");
                    emitDeserializer("StartObject", "map");
                    emitStringDeserializer();
                });
                this.emitLine('throw new Exception("Cannot convert ', unionName, '");');
            });
            this.ensureBlankLine();
            this.emitLine("public void WriteJson(JsonWriter writer, JsonSerializer serializer)");
            this.emitBlock(() => {
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, _) => {
                    this.emitLine("if (", fieldName, " != null)");
                    this.emitBlock(() => {
                        this.emitLine("serializer.Serialize(writer, ", fieldName, ");");
                        this.emitLine("return;");
                    });
                });
                if (hasNull !== null) {
                    this.emitLine("writer.WriteNull();");
                } else {
                    this.emitLine('throw new Exception("Union must not be null");');
                }
            });
        });
    }

    private emitSerializeClass(): void {
        // FIXME: Make Serialize a Named
        this.emitType(undefined, AccessModifier.Public, "static class", "Serialize", undefined, () => {
            this.topLevels.forEach((t: Type, _: string) => {
                // FIXME: Make ToJson a Named
                this.emitExpressionMember(
                    ["public static string ToJson(this ", this.csType(t), " self)"],
                    ["JsonConvert.SerializeObject(self, ", this.namespaceName, ".Converter.Settings)"]
                );
            });
        });
    }

    private emitConverterMembers(): void {
        const enumNames = this.enums.map(this.nameForNamedType);
        const unionNames = this.namedUnions.map(this.nameForNamedType);
        const allNames = enumNames.union(unionNames);
        const canConvertExprs = allNames.map((n: Name): Sourcelike => ["t == typeof(", n, ")"]);
        const nullableCanConvertExprs = enumNames.map((n: Name): Sourcelike => ["t == typeof(", n, "?)"]);
        const canConvertExpr = intercalate(" || ", canConvertExprs.union(nullableCanConvertExprs));
        // FIXME: make Iterable<any, Sourcelike> a Sourcelike, too?
        this.emitExpressionMember("public override bool CanConvert(Type t)", canConvertExpr.toArray());
        this.ensureBlankLine();
        this.emitLine(
            "public override object ReadJson(JsonReader reader, Type t, object existingValue, JsonSerializer serializer)"
        );
        this.emitBlock(() => {
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
            this.emitTypeSwitch(unionNames, t => ["t == typeof(", t, ")"], false, false, n => {
                this.emitLine("return new ", n, "(reader, serializer);");
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
        this.ensureBlankLine();
        this.emitLine("public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)");
        this.emitBlock(() => {
            this.emitLine("var t = value.GetType();");
            this.emitTypeSwitch(allNames, t => ["t == typeof(", t, ")"], true, true, n => {
                this.emitLine("((", n, ")value).WriteJson(writer, serializer);");
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
    }

    private emitConverterClass(): void {
        const jsonConverter = this.haveEnums || this.haveNamedUnions;
        // FIXME: Make Converter a Named
        let converterName: Sourcelike = ["Converter"];
        if (jsonConverter) converterName = converterName.concat([": JsonConverter"]);
        this.emitType(undefined, AccessModifier.Internal, "class", converterName, undefined, () => {
            if (jsonConverter) {
                this.emitConverterMembers();
                this.ensureBlankLine();
            }
            this.emitLine("public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings");
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
                if (this.haveNamedUnions || this.haveEnums) {
                    this.emitMultiline(`Converters = { 
    new Converter(),
    new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }
},`);
                } else {
                    this.emitMultiline(`Converters = { 
    new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }
},`);
                }
            }, true);
        });
    }

    protected emitRequiredHelpers(): void {
        if (this.needHelpers) {
            this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitFromJsonForTopLevel(t, n));
            this.forEachEnum("leading-and-interposing", (e, n) => this.emitEnumExtension(e, n));
            this.forEachUnion("leading-and-interposing", (u, n) => this.emitUnionJSONPartial(u, n));
            this.ensureBlankLine();
            this.emitSerializeClass();
        }
        if (this.needHelpers || (this.needAttributes && (this.haveNamedUnions || this.haveEnums))) {
            this.ensureBlankLine();
            this.emitConverterClass();
        }
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
