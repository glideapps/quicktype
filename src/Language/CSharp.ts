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
import { Sourcelike, maybeAnnotated } from "../Source";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle
} from "../Strings";
import { intercalate, defined, assert, panic, StringMap } from "../Support";
import { Namespace, Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { StringOption, EnumOption } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { StringTypeMapping } from "../TypeBuilder";

const unicode = require("unicode-properties");
const lodash = require("lodash");

type Version = 5 | 6;
type OutputFeatures = { helpers: boolean; attributes: boolean };

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
        this.setOptions([
            this._namespaceOption,
            this._versionOption,
            this._denseOption,
            this._listOption,
            this._featuresOption
        ]);
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date-time", time: "date-time", dateTime: "date-time" };
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return CSharpRenderer;
    }
}

const namingFunction = funPrefixNamer(csNameStyle);

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

class CSharpRenderer extends ConvenienceRenderer {
    private _enumExtensionsNames = Map<Name, Name>();
    private readonly _needHelpers: boolean;
    private readonly _needAttributes: boolean;

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _namespaceName: string,
        private readonly _version: Version,
        private readonly _dense: boolean,
        private readonly _useList: boolean,
        outputFeatures: OutputFeatures
    ) {
        super(graph, leadingComments);
        this._needHelpers = outputFeatures.helpers;
        this._needAttributes = outputFeatures.attributes;
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return ["QuickType", "Converter", "JsonConverter", "Type", "Serialize"];
    }

    protected forbiddenForClassProperties(_: ClassType, classNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [classNamed], namespaces: [] };
    }

    protected topLevelNameStyle(rawName: string): string {
        return csNameStyle(rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected makeClassPropertyNamer(): Namer {
        return namingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return namingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return namingFunction;
    }

    protected unionNeedsName(u: UnionType): boolean {
        return !nullableFromUnion(u);
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.
        return directlyReachableSingleNamedType(type);
    }

    protected namedTypeDependencyNames(t: Type, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];

        const extensionsName = new DependencyName(namingFunction, lookup => `${lookup(name)}_extensions`);
        this._enumExtensionsNames = this._enumExtensionsNames.set(name, extensionsName);
        return [extensionsName];
    }

    emitBlock = (f: () => void, semicolon: boolean = false): void => {
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}", semicolon ? ";" : "");
    };

    csType = (t: Type, withIssues: boolean = false): Sourcelike => {
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
                if (nullable) return this.nullableCSType(nullable);
                return this.nameForNamedType(unionType);
            },
            {
                dateTimeType: _ => "DateTime"
            }
        );
    };

    nullableCSType = (t: Type): Sourcelike => {
        const csType = this.csType(t);
        if (isValueType(t)) {
            return [csType, "?"];
        } else {
            return csType;
        }
    };

    emitClass = (isPublic: boolean, declaration: Sourcelike, name: Sourcelike, emitter: () => void): void => {
        if (isPublic) {
            declaration = ["public ", declaration];
        }
        this.emitLine(declaration, " ", name);
        this.emitBlock(emitter);
    };

    get partialString(): string {
        return this._needHelpers ? "partial " : "";
    }

    emitClassDefinition = (c: ClassType, className: Name): void => {
        const jsonProperty = this._dense ? denseJsonPropertyName : "JsonProperty";
        this.emitClass(true, [this.partialString, "class"], className, () => {
            if (c.properties.isEmpty()) return;
            const maxWidth = defined(c.properties.map((_, name: string) => utf16StringEscape(name).length).max());
            const blankLines = this._needAttributes && !this._dense ? "interposing" : "none";
            this.forEachClassProperty(c, blankLines, (name, jsonName, t) => {
                const csType = this.csType(t, true);
                const escapedName = utf16StringEscape(jsonName);
                const attribute = ["[", jsonProperty, '("', escapedName, '")]'];
                const property = ["public ", csType, " ", name, " { get; set; }"];
                if (!this._needAttributes) {
                    this.emitLine(property);
                } else if (this._dense) {
                    const indent = maxWidth - escapedName.length + 1;
                    const whitespace = lodash.repeat(" ", indent);
                    this.emitLine(attribute, whitespace, property);
                } else {
                    this.emitLine(attribute);
                    this.emitLine(property);
                }
            });
        });
    };

    emitUnionDefinition = (u: UnionType, unionName: Name): void => {
        const nonNulls = removeNullFromUnion(u)[1];
        this.emitClass(true, [this.partialString, "struct"], unionName, () => {
            this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                const csType = this.nullableCSType(t);
                this.emitLine("public ", csType, " ", fieldName, ";");
            });
        });
    };

    emitEnumDefinition = (e: EnumType, enumName: Name): void => {
        const caseNames: Sourcelike[] = [];
        this.forEachEnumCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        this.emitLine("public enum ", enumName, " { ", caseNames, " };");
    };

    emitExpressionMember(declare: Sourcelike, define: Sourcelike): void {
        if (this._version === 5) {
            this.emitLine(declare);
            this.emitBlock(() => {
                this.emitLine("return ", define, ";");
            });
        } else {
            this.emitLine(declare, " => ", define, ";");
        }
    }

    emitFromJsonForTopLevel = (t: Type, name: Name): void => {
        let partial: string;
        let typeKind: string;
        const definedType = this.namedTypeToNameForTopLevel(t);
        if (definedType) {
            partial = "partial ";
            typeKind = definedType instanceof ClassType ? "class" : "struct";
        } else {
            partial = "";
            typeKind = "class";
        }
        const csType = this.csType(t);
        this.emitClass(true, [partial, typeKind], name, () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(
                ["public static ", csType, " FromJson(string json)"],
                ["JsonConvert.DeserializeObject<", csType, ">(json, Converter.Settings)"]
            );
        });
    };

    emitEnumExtension = (e: EnumType, enumName: Name): void => {
        this.emitClass(false, "static class", defined(this._enumExtensionsNames.get(enumName)), () => {
            this.emitLine("public static ", enumName, "? ValueForString(string str)");
            this.emitBlock(() => {
                this.emitLine("switch (str)");
                this.emitBlock(() => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        this.emitLine('case "', utf16StringEscape(jsonName), '": return ', enumName, ".", name, ";");
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
        });
    };

    emitUnionJSONPartial = (u: UnionType, unionName: Name): void => {
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
            if (!t) return;

            tokenCase(tokenType);
            this.indent(() => emitDeserializeType(t));
        };

        const emitDoubleDeserializer = (): void => {
            const t = u.findMember("double");
            if (!t) return;

            if (!u.findMember("integer")) tokenCase("Integer");
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
                        this.emitLine("DateTime dt;");
                        this.emitLine("if (System.DateTime.TryParse(str, out dt))");
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
        this.emitClass(true, "partial struct", unionName, () => {
            this.emitLine("public ", unionName, "(JsonReader reader, JsonSerializer serializer)");
            this.emitBlock(() => {
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, _) => {
                    this.emitLine(fieldName, " = null;");
                });
                this.ensureBlankLine();
                this.emitLine("switch (reader.TokenType)");
                this.emitBlock(() => {
                    if (hasNull) emitNullDeserializer();
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
                if (hasNull) {
                    this.emitLine("writer.WriteNull();");
                } else {
                    this.emitLine('throw new Exception("Union must not be null");');
                }
            });
        });
    };

    emitSerializeClass = (): void => {
        // FIXME: Make Serialize a Named
        this.emitClass(true, "static class", "Serialize", () => {
            this.topLevels.forEach((t: Type, _: string) => {
                // FIXME: Make ToJson a Named
                this.emitExpressionMember(
                    ["public static string ToJson(this ", this.csType(t), " self)"],
                    "JsonConvert.SerializeObject(self, Converter.Settings)"
                );
            });
        });
    };

    emitTypeSwitch<T extends Sourcelike>(
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

    emitConverterMembers = (): void => {
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
    };

    emitConverterClass = (): void => {
        const jsonConverter = this.haveEnums || this.haveNamedUnions;
        // FIXME: Make Converter a Named
        let converterName: Sourcelike = ["Converter"];
        if (jsonConverter) converterName = converterName.concat([": JsonConverter"]);
        this.emitClass(true, "class", converterName, () => {
            if (jsonConverter) {
                this.emitConverterMembers();
                this.ensureBlankLine();
            }
            this.emitLine("public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings");
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
                if (this.haveNamedUnions || this.haveEnums) {
                    this.emitLine("Converters = { new Converter() },");
                }
            }, true);
        });
    };

    private emitTypesAndSupport = (): void => {
        const using = (ns: Sourcelike): void => {
            this.emitLine("using ", ns, ";");
        };

        if (this._needAttributes || this._needHelpers) {
            for (const ns of ["System", "System.Net", "System.Collections.Generic"]) {
                using(ns);
            }
            this.ensureBlankLine();
            using("Newtonsoft.Json");
            if (this._dense) {
                using([denseJsonPropertyName, " = Newtonsoft.Json.JsonPropertyAttribute"]);
            }
        }
        this.forEachClass("leading-and-interposing", this.emitClassDefinition);
        this.forEachEnum("leading-and-interposing", this.emitEnumDefinition);
        this.forEachUnion("leading-and-interposing", this.emitUnionDefinition);
        if (this._needHelpers) {
            this.forEachTopLevel("leading-and-interposing", this.emitFromJsonForTopLevel);
            this.forEachEnum("leading-and-interposing", this.emitEnumExtension);
            this.forEachUnion("leading-and-interposing", this.emitUnionJSONPartial);
            this.ensureBlankLine();
            this.emitSerializeClass();
        }
        if (this._needHelpers || (this._needAttributes && (this.haveNamedUnions || this.haveEnums))) {
            this.ensureBlankLine();
            this.emitConverterClass();
        }
    };

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines("// ", this.leadingComments);
        } else if (this._needHelpers) {
            this.emitLine(
                "// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do",
                this.topLevels.size === 1 ? "" : " one of these",
                ":"
            );
            this.emitLine("//");
            this.emitLine("//    using ", this._namespaceName, ";");
            this.forEachTopLevel("none", (_, topLevelName) => {
                this.emitLine("//");
                this.emitLine("//    var data = ", topLevelName, ".FromJson(jsonString);");
            });
        }

        this.ensureBlankLine();
        if (this._needHelpers || this._needAttributes) {
            this.emitLine("namespace ", this._namespaceName);
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
        if (t.kind === "enum") {
            const name = this.nameForNamedType(t);
            ctx.extensionsName = defined(this.names.get(defined(this._enumExtensionsNames.get(name))));
        }
        return ctx;
    }

    protected makeHandlebarsContextForUnionMember(t: Type, name: Name): StringMap {
        const value = super.makeHandlebarsContextForUnionMember(t, name);
        value.nullableCSType = this.sourcelikeToString(this.nullableCSType(t));
        return value;
    }
}
