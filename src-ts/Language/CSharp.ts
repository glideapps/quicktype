"use strict";

import { List, Collection, OrderedMap } from "immutable";
import {
    TopLevels,
    Type,
    PrimitiveType,
    ArrayType,
    MapType,
    UnionType,
    NamedType,
    ClassType,
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
import { Namespace, Name, Namer, funPrefixNamer } from "../Naming";
import { PrimitiveTypeKind, TypeKind } from "Reykjavik";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TypeScriptTargetLanguage } from "../TargetLanguage";
import { BooleanOption, StringOption, EnumOption } from "../RendererOptions";
import {
    IssueAnnotationData,
    anyTypeIssueAnnotation,
    nullTypeIssueAnnotation
} from "../Annotation";

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
        const listOption = new EnumOption("array-type", "Use T[] or List<T>", [
            ["array", false],
            ["list", true]
        ]);
        const denseOption = new EnumOption("density", "Property density", [
            ["normal", false],
            ["dense", true]
        ]);
        const featuresOption = new EnumOption("features", "Output features", [
            ["complete", { helpers: true, attributes: true }],
            ["attributes-only", { helpers: false, attributes: true }],
            ["just-types", { helpers: false, attributes: false }]
        ]);
        // FIXME: Do this via a configurable named eventually.
        const namespaceOption = new StringOption(
            "namespace",
            "Generated namespace",
            "NAME",
            "QuickType"
        );
        const versionOption = new EnumOption<Version>("csharp-version", "C# version", [
            ["6", 6],
            ["5", 5]
        ]);
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
    return ["integer", "double", "bool"].indexOf(t.kind) >= 0;
}

class CSharpRenderer extends ConvenienceRenderer {
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

    protected forbiddenForProperties(
        c: ClassType,
        classNamed: Name
    ): { names: Name[]; namespaces: Namespace[] } {
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

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        const definedTypes = type.directlyReachableNamedTypes;
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

    emitBlock = (f: () => void, semicolon: boolean = false): void => {
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}", semicolon ? ";" : "");
    };

    csType = (t: Type, withIssues: boolean = false): Sourcelike => {
        if (t instanceof PrimitiveType) {
            switch (t.kind) {
                case "any":
                    return maybeAnnotated(withIssues, anyTypeIssueAnnotation, "object");
                case "null":
                    return maybeAnnotated(withIssues, nullTypeIssueAnnotation, "object");
                case "bool":
                    return "bool";
                case "integer":
                    return "long";
                case "double":
                    return "double";
                case "string":
                    return "string";
                default:
                    assertNever(t.kind);
            }
        } else if (t instanceof ArrayType) {
            const itemsType = this.csType(t.items, withIssues);
            if (this._useList) {
                return ["List<", itemsType, ">"];
            } else {
                return [itemsType, "[]"];
            }
        } else if (t instanceof ClassType) {
            return this.nameForNamedType(t);
        } else if (t instanceof MapType) {
            return ["Dictionary<string, ", this.csType(t.values, withIssues), ">"];
        } else if (t instanceof UnionType) {
            const nonNull = nullableFromUnion(t);
            if (nonNull) return this.nullableCSType(nonNull, withIssues);
            return this.nameForNamedType(t);
        }
        throw "Unknown type";
    };

    nullableCSType = (t: Type, withIssues: boolean): Sourcelike => {
        const csType = this.csType(t);
        if (isValueType(t)) {
            return [csType, "?"];
        } else {
            return csType;
        }
    };

    emitClass = (declaration: Sourcelike, name: Sourcelike, emitter: () => void): void => {
        this.emitLine("public ", declaration, " ", name);
        this.emitBlock(emitter);
    };

    get partialString(): string {
        return this._needHelpers ? "partial " : "";
    }

    emitClassDefinition = (c: ClassType, className: Name): void => {
        const jsonProperty = this._dense ? denseJsonPropertyName : "JsonProperty";
        this.emitClass([this.partialString, "class"], className, () => {
            if (c.properties.isEmpty()) return;
            const maxWidth = defined(
                c.properties.map((_, name: string) => utf16StringEscape(name).length).max()
            );
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
        this.emitClass([this.partialString, "struct"], unionName, () => {
            nonNulls.forEach((t: Type) => {
                const csType = this.nullableCSType(t, true);
                const field = this.unionFieldName(t);
                this.emitLine("public ", csType, " ", field, ";");
            });
        });
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
        const definedTypes = t.directlyReachableNamedTypes;
        if (definedTypes.isEmpty()) {
            partial = "";
            typeKind = "class";
        } else {
            partial = "partial ";
            typeKind = definedTypes.first() instanceof ClassType ? "class" : "struct";
        }
        const csType = this.csType(t);
        this.emitClass([partial, typeKind], name, () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(
                ["public static ", csType, " FromJson(string json)"],
                ["JsonConvert.DeserializeObject<", csType, ">(json, Converter.Settings)"]
            );
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
            this.emitLine(
                this.unionFieldName(t),
                " = serializer.Deserialize<",
                this.csType(t),
                ">(reader);"
            );
            this.emitLine("break;");
        };

        const emitPrimitiveDeserializer = (tokenTypes: string[], kind: PrimitiveTypeKind): void => {
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

        const emitGenericDeserializer = (kind: TypeKind, tokenType: string): void => {
            const t = u.findMember(kind);
            if (!t) return;

            tokenCase(tokenType);
            this.indent(() => emitDeserializeType(t));
        };

        const [hasNull, nonNulls] = removeNullFromUnion(u);
        this.emitClass("partial struct", unionName, () => {
            this.emitLine("public ", unionName, "(JsonReader reader, JsonSerializer serializer)");
            this.emitBlock(() => {
                nonNulls.forEach((t: Type) => {
                    this.emitLine(this.unionFieldName(t), " = null;");
                });
                this.emitNewline();
                this.emitLine("switch (reader.TokenType)");
                this.emitBlock(() => {
                    if (hasNull) emitNullDeserializer();
                    emitPrimitiveDeserializer(["Integer"], "integer");
                    emitDoubleSerializer();
                    emitPrimitiveDeserializer(["Boolean"], "bool");
                    emitPrimitiveDeserializer(["String", "Date"], "string");
                    emitGenericDeserializer("array", "StartArray");
                    emitGenericDeserializer("class", "StartObject");
                    emitGenericDeserializer("map", "StartObject");
                    this.emitLine(
                        'default: throw new Exception("Cannot convert ',
                        unionName,
                        '");'
                    );
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
        this.emitClass("static class", "Serialize", () => {
            this.topLevels.forEach((t: Type, name: string) => {
                // FIXME: Make ToJson a Named
                this.emitExpressionMember(
                    ["public static string ToJson(this ", this.csType(t), " self)"],
                    "JsonConvert.SerializeObject(self, Converter.Settings)"
                );
            });
        });
    };

    emitUnionConverterMembers = (unions: Collection<any, UnionType>): void => {
        const names = unions.map((u: UnionType) => this.nameForNamedType(u)).toOrderedSet();
        const canConvertExpr = intercalate(
            " || ",
            names.map((n: Name): Sourcelike => ["t == typeof(", n, ")"])
        );
        // FIXME: make Iterable<any, Sourcelike> a Sourcelike, too?
        this.emitExpressionMember(
            "public override bool CanConvert(Type t)",
            canConvertExpr.toArray()
        );
        this.emitNewline();
        this.emitLine(
            "public override object ReadJson(JsonReader reader, Type t, object existingValue, JsonSerializer serializer)"
        );
        this.emitBlock(() => {
            // FIXME: call the constructor via reflection?
            names.forEach((n: Name) => {
                this.emitLine("if (t == typeof(", n, "))");
                this.indent(() => this.emitLine("return new ", n, "(reader, serializer);"));
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
        this.emitNewline();
        this.emitLine(
            "public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)"
        );
        this.emitBlock(() => {
            this.emitLine("var t = value.GetType();");
            names.forEach((n: Name) => {
                this.emitLine("if (t == typeof(", n, "))");
                this.emitBlock(() => {
                    this.emitLine("((", n, ")value).WriteJson(writer, serializer);");
                    this.emitLine("return;");
                });
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
    };

    emitConverterClass = (): void => {
        const unions = this.namedUnions;
        const haveUnions = !unions.isEmpty();
        // FIXME: Make Converter a Named
        let converterName: Sourcelike = ["Converter"];
        if (haveUnions) converterName = converterName.concat([": JsonConverter"]);
        this.emitClass("class", converterName, () => {
            if (haveUnions) {
                this.emitUnionConverterMembers(unions);
                this.emitNewline();
            }
            this.emitLine(
                "public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings"
            );
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
                if (haveUnions) {
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
            this.forEachUnion("leading-and-interposing", this.emitUnionDefinition);
            if (this._needHelpers) {
                this.forEachTopLevel("leading-and-interposing", this.emitFromJsonForTopLevel);
                this.forEachUnion("leading-and-interposing", this.emitUnionJSONPartial);
                this.emitNewline();
                this.emitSerializeClass();
            }
            if (this._needHelpers || (this._needAttributes && this.haveNamedUnions)) {
                this.emitNewline();
                this.emitConverterClass();
            }
        });
    }
}
