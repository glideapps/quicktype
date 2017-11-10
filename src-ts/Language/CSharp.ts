"use strict";

import { List, Collection, OrderedMap, OrderedSet, Map } from "immutable";
import {
    TopLevels,
    Type,
    PrimitiveType,
    ArrayType,
    MapType,
    EnumType,
    UnionType,
    NamedType,
    ClassType,
    matchType,
    nullableFromUnion,
    removeNullFromUnion
} from "../Type";
import { Sourcelike, maybeAnnotated } from "../Source";
import {
    utf16LegalizeCharacters,
    pascalCase,
    startWithLetter,
    utf16StringEscape,
    intercalate,
    defined,
    assertNever
} from "../Support";
import { Namespace, Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import { TypeKind } from "Reykjavik";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TypeScriptTargetLanguage } from "../TargetLanguage";
import { BooleanOption, StringOption, EnumOption } from "../RendererOptions";
import { IssueAnnotationData, anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";

const unicode = require("unicode-properties");

type Version = 5 | 6;
type Features = { helpers: boolean; attributes: boolean };

export default class CSharpTargetLanguage extends TypeScriptTargetLanguage {
    private readonly _listOption: EnumOption<boolean>;
    private readonly _denseOption: EnumOption<boolean>;
    private readonly _featuresOption: EnumOption<Features>;
    private readonly _namespaceOption: StringOption;
    private readonly _versionOption: EnumOption<Version>;

    constructor() {
        const listOption = new EnumOption("array-type", "Use T[] or List<T>", [["array", false], ["list", true]]);
        const denseOption = new EnumOption("density", "Property density", [["normal", false], ["dense", true]]);
        const featuresOption = new EnumOption("features", "Output features", [
            ["complete", { helpers: true, attributes: true }],
            ["attributes-only", { helpers: false, attributes: true }],
            ["just-types", { helpers: false, attributes: false }]
        ]);
        // FIXME: Do this via a configurable named eventually.
        const namespaceOption = new StringOption("namespace", "Generated namespace", "NAME", "QuickType");
        const versionOption = new EnumOption<Version>("csharp-version", "C# version", [["6", 6], ["5", 5]]);
        const options = [namespaceOption, versionOption, denseOption, listOption, featuresOption];
        super("C#", ["cs", "csharp"], "cs", options.map(o => o.definition));
        this._listOption = listOption;
        this._denseOption = denseOption;
        this._featuresOption = featuresOption;
        this._namespaceOption = namespaceOption;
        this._versionOption = versionOption;
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        const { helpers, attributes } = this._featuresOption.getValue(optionValues);
        const renderer = new CSharpRenderer(
            topLevels,
            this._listOption.getValue(optionValues),
            this._denseOption.getValue(optionValues),
            helpers,
            attributes,
            this._namespaceOption.getValue(optionValues),
            this._versionOption.getValue(optionValues)
        );
        return renderer.render();
    }
}

const namingFunction = funPrefixNamer(csNameStyle);

// FIXME: Make a Named?
const denseJsonPropertyName = "J";

function proposeTopLevelDependencyName(names: List<string>): string {
    if (names.size !== 1) throw "Cannot deal with more than one dependency";
    return defined(names.first());
}

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
    const legalized = legalizeName(original);
    const pascaled = pascalCase(legalized);
    return startWithLetter(isStartCharacter, true, pascaled);
}

function isValueType(t: Type): boolean {
    return ["integer", "double", "bool", "enum"].indexOf(t.kind) >= 0;
}

class CSharpRenderer extends ConvenienceRenderer {
    private _enumExtensionsNames = Map<Name, Name>();

    constructor(
        topLevels: TopLevels,
        private readonly _useList: boolean,
        private readonly _dense: boolean,
        private readonly _needHelpers: boolean,
        private readonly _needAttributes: boolean,
        private readonly _namespaceName: string,
        private readonly _version: Version
    ) {
        super(topLevels);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return ["QuickType", "Converter", "JsonConverter", "Type", "Serialize"];
    }

    protected forbiddenForProperties(c: ClassType, classNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [classNamed], namespaces: [] };
    }

    protected topLevelNameStyle(rawName: string): string {
        return csNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return namingFunction;
    }

    protected get propertyNamer(): Namer {
        return namingFunction;
    }

    protected get caseNamer(): Namer {
        return namingFunction;
    }

    nullableFromUnion = (u: UnionType): Type | null => {
        const nullable = nullableFromUnion(u);
        if (!nullable) return null;
        return nullable;
    };

    protected unionNeedsName(u: UnionType): boolean {
        return !this.nullableFromUnion(u);
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        const definedTypes = type.directlyReachableTypes(t => {
            if ((!(t instanceof UnionType) && t.isNamedType()) || (t instanceof UnionType && !nullableFromUnion(t))) {
                return OrderedSet([t]);
            }
            return null;
        });
        if (definedTypes.size > 1) {
            throw "Cannot have more than one defined type per top-level";
        }

        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.

        const first = definedTypes.first();
        if (first === undefined) return null;
        return first;
    }

    protected namedTypeDependencyNames(t: NamedType, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];

        const extensionsName = new DependencyName(
            namingFunction,
            List([name]),
            (names: List<string>) => `${names.first()}Extensions`
        );
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
            anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "object"),
            nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "object"),
            boolType => "bool",
            integerType => "long",
            doubleType => "double",
            stringType => "string",
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
                const nullable = this.nullableFromUnion(unionType);
                if (nullable) return this.nullableCSType(nullable, withIssues);
                return this.nameForNamedType(unionType);
            }
        );
    };

    nullableCSType = (t: Type, withIssues: boolean): Sourcelike => {
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
            this.forEachProperty(c, blankLines, (name, jsonName, t) => {
                const csType = this.csType(t, true);
                const escapedName = utf16StringEscape(jsonName);
                const attribute = ["[", jsonProperty, '("', escapedName, '")]'];
                const property = ["public ", csType, " ", name, " { get; set; }"];
                if (!this._needAttributes) {
                    this.emitLine(property);
                } else if (this._dense) {
                    const indent = maxWidth - escapedName.length + 1;
                    const whitespace = " ".repeat(indent);
                    this.emitLine(attribute, whitespace, property);
                } else {
                    this.emitLine(attribute);
                    this.emitLine(property);
                }
            });
        });
    };

    emitUnionDefinition = (c: UnionType, unionName: Name): void => {
        const [_, nonNulls] = removeNullFromUnion(c);
        this.emitClass(true, [this.partialString, "struct"], unionName, () => {
            nonNulls.forEach((t: Type) => {
                const csType = this.nullableCSType(t, true);
                const field = this.unionFieldName(t);
                this.emitLine("public ", csType, " ", field, ";");
            });
        });
    };

    emitEnumDefinition = (e: EnumType, enumName: Name): void => {
        const caseNames: Sourcelike[] = [];
        this.forEachCase(e, "none", name => {
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
            this.emitLine("public static ", enumName, " ReadJson(JsonReader reader, JsonSerializer serializer)");
            this.emitBlock(() => {
                this.emitLine("switch (serializer.Deserialize<string>(reader))");
                this.emitBlock(() => {
                    this.forEachCase(e, "none", (name, jsonName) => {
                        this.emitLine('case "', utf16StringEscape(jsonName), '": return ', enumName, ".", name, ";");
                    });
                });
                this.emitLine('throw new Exception("Unknown enum case");');
            });
            this.emitNewline();
            this.emitLine(
                "public static void WriteJson(this ",
                enumName,
                " value, JsonWriter writer, JsonSerializer serializer)"
            );
            this.emitBlock(() => {
                this.emitLine("switch (value)");
                this.emitBlock(() => {
                    this.forEachCase(e, "none", (name, jsonName) => {
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
            this.indent(() => this.emitLine("break;"));
        };

        const emitDeserializeType = (t: Type): void => {
            this.emitLine(this.unionFieldName(t), " = serializer.Deserialize<", this.csType(t), ">(reader);");
            this.emitLine("break;");
        };

        const emitDeserializer = (tokenTypes: string[], kind: TypeKind): void => {
            const t = u.findMember(kind);
            if (!t) return;

            for (const tokenType of tokenTypes) {
                tokenCase(tokenType);
            }
            this.indent(() => emitDeserializeType(t));
        };

        const emitDoubleSerializer = (): void => {
            const t = u.findMember("double");
            if (!t) return;

            if (!u.findMember("integer")) tokenCase("Integer");
            tokenCase("Float");
            this.indent(() => emitDeserializeType(t));
        };

        const [hasNull, nonNulls] = removeNullFromUnion(u);
        this.emitClass(true, "partial struct", unionName, () => {
            this.emitLine("public ", unionName, "(JsonReader reader, JsonSerializer serializer)");
            this.emitBlock(() => {
                nonNulls.forEach((t: Type) => {
                    this.emitLine(this.unionFieldName(t), " = null;");
                });
                this.emitNewline();
                this.emitLine("switch (reader.TokenType)");
                this.emitBlock(() => {
                    if (hasNull) emitNullDeserializer();
                    emitDeserializer(["Integer"], "integer");
                    emitDoubleSerializer();
                    emitDeserializer(["Boolean"], "bool");
                    emitDeserializer(["String", "Date"], "string");
                    emitDeserializer(["StartArray"], "array");
                    emitDeserializer(["StartObject"], "class");
                    emitDeserializer(["String"], "enum");
                    emitDeserializer(["StartObject"], "map");
                    this.emitLine('default: throw new Exception("Cannot convert ', unionName, '");');
                });
            });
            this.emitNewline();
            this.emitLine("public void WriteJson(JsonWriter writer, JsonSerializer serializer)");
            this.emitBlock(() => {
                nonNulls.forEach((t: Type) => {
                    const fieldName = this.unionFieldName(t);
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
            this.topLevels.forEach((t: Type, name: string) => {
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
        if (withReturn && !withBlock) throw "Can only have return with block";
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
        this.emitNewline();
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
        this.emitNewline();
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
                this.emitNewline();
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

    protected emitSourceStructure(): void {
        const using = (ns: Sourcelike): void => {
            this.emitLine("using ", ns, ";");
        };

        if (this._needHelpers) {
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
            this.emitLine("//");
        }

        this.emitLine("namespace ", this._namespaceName);
        this.emitBlock(() => {
            for (const ns of ["System", "System.Net", "System.Collections.Generic"]) {
                using(ns);
            }
            if (this._needAttributes || this._needHelpers) {
                this.emitNewline();
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
                this.emitNewline();
                this.emitSerializeClass();
            }
            if (this._needHelpers || this.haveEnums || (this._needAttributes && this.haveNamedUnions)) {
                this.emitNewline();
                this.emitConverterClass();
            }
        });
    }
}
