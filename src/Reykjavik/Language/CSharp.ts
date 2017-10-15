"use strict";

import { Set, List, Map, OrderedSet } from "immutable";
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
    removeNullFromUnion,
    allClassesAndUnions
} from "../Type";
import { Source, Sourcelike, newline } from "../Source";
import {
    legalizeCharacters,
    camelCase,
    startWithLetter,
    stringEscape,
    intercalate
} from "../Utils";
import {
    Namespace,
    Named,
    SimpleNamed,
    FixedNamed,
    NamingFunction,
    keywordNamespace,
    assignNames,
    countingNamingFunction
} from "../Naming";
import { PrimitiveTypeKind, TypeKind } from "Reykjavik";
import { Renderer, RenderResult } from "../Renderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanRendererOption, StringRendererOption, EnumRendererOption } from "../Options";

const unicode = require("unicode-properties");

type Version = 5 | 6;

class CSharpTargetLanguage extends TargetLanguage {
    readonly listOption: EnumRendererOption<boolean>;
    readonly denseOption: EnumRendererOption<boolean>;
    readonly pocoOption: BooleanRendererOption;
    readonly namespaceOption: StringRendererOption;
    readonly versionOption: EnumRendererOption<Version>;

    constructor() {
        const listOption = new EnumRendererOption("array-type", "Use T[] or List<T>", [
            ["array", false],
            ["list", true]
        ]);
        const denseOption = new EnumRendererOption("density", "Property density", [
            ["normal", false],
            ["dense", true]
        ]);
        const pocoOption = new BooleanRendererOption("just-types", "Plain objects only", false);
        // FIXME: Do this via a configurable named eventually.
        const namespaceOption = new StringRendererOption(
            "namespace",
            "Generated namespace",
            "NAME",
            "QuickType"
        );
        const versionOption = new EnumRendererOption<Version>("csharp-version", "C# version", [
            ["6", 6],
            ["5", 5]
        ]);
        const options = [namespaceOption, versionOption, denseOption, listOption, pocoOption];
        super("new C#", ["newcs"], "ncs", "csharp", options);
        this.listOption = listOption;
        this.denseOption = denseOption;
        this.pocoOption = pocoOption;
        this.namespaceOption = namespaceOption;
        this.versionOption = versionOption;
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new CSharpRenderer(
            topLevels,
            this.listOption.getValue(optionValues),
            this.denseOption.getValue(optionValues),
            this.pocoOption.getValue(optionValues),
            this.namespaceOption.getValue(optionValues),
            this.versionOption.getValue(optionValues)
        );
        return renderer.render();
    }
}

export const cSharpTargetLanguage: TargetLanguage = new CSharpTargetLanguage();

const forbiddenNames = ["QuickType", "Converter", "JsonConverter", "Type", "Serialize"];

const denseJsonPropertyName = "J";

function proposeTopLevelDependencyName(names: List<string>): string {
    if (names.size !== 1) throw "Cannot deal with more than one dependency";
    return names.first();
}

function isStartCharacter(c: string): boolean {
    const code = c.charCodeAt(0);
    if (unicode.isAlphabetic(code)) {
        return true;
    }
    return c == "_";
}

function isPartCharacter(c: string): boolean {
    const category: string = unicode.getCategory(c.charCodeAt(0));
    if (["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0) {
        return true;
    }
    return isStartCharacter(c);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function csNameStyle(original: string): string {
    const legalized = legalizeName(original);
    const cameled = camelCase(legalized);
    return startWithLetter(isStartCharacter, true, cameled);
}

function isValueType(t: Type): boolean {
    if (t instanceof PrimitiveType) {
        return ["integer", "double", "bool"].indexOf(t.kind) >= 0;
    }
    return false;
}

class CSharpRenderer extends Renderer {
    readonly useList: boolean;
    readonly dense: boolean;
    readonly poco: boolean;
    readonly namespaceName: string;
    readonly version: Version;

    readonly globalNamespace: Namespace;
    readonly topLevelNameds: Map<string, Named>;
    readonly classes: OrderedSet<ClassType>;
    readonly unions: OrderedSet<UnionType>;
    classAndUnionNameds: Map<NamedType, Named>;
    propertyNameds: Map<ClassType, Map<string, Named>>;
    readonly names: Map<Named, string>;

    constructor(
        topLevels: TopLevels,
        useList: boolean,
        dense: boolean,
        poco: boolean,
        namespaceName: string,
        version: Version
    ) {
        super(topLevels);

        this.useList = useList;
        this.dense = dense;
        this.poco = poco;
        this.namespaceName = namespaceName;
        this.version = version;

        this.globalNamespace = keywordNamespace("global", forbiddenNames);
        const { classes, unions } = allClassesAndUnions(topLevels);
        this.classes = classes;
        this.unions = unions.filter((u: UnionType) => !nullableFromUnion(u)).toSet();
        this.classAndUnionNameds = Map();
        this.propertyNameds = Map();
        this.topLevelNameds = topLevels.map(this.namedFromTopLevel).toMap();
        classes.forEach((c: ClassType) => {
            const named = this.addClassOrUnionNamed(c);
            this.addPropertyNameds(c, named);
        });
        this.unions.forEach((u: UnionType) => this.addClassOrUnionNamed(u));
        this.names = assignNames(OrderedSet([this.globalNamespace]));
    }

    namedFromTopLevel = (type: Type, name: string): FixedNamed => {
        // FIXME: leave the name as-is?
        const proposed = csNameStyle(name);
        const named = new FixedNamed(this.globalNamespace, proposed);

        const definedTypes = type.directlyReachableNamedTypes;
        if (definedTypes.size > 1) {
            throw "Cannot have more than one defined type per top-level";
        }

        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.

        if (definedTypes.size === 1) {
            const definedType = definedTypes.first();
            this.classAndUnionNameds = this.classAndUnionNameds.set(definedType, named);
        }

        return named;
    };

    addClassOrUnionNamed = (type: NamedType): Named => {
        if (this.classAndUnionNameds.has(type)) {
            return this.classAndUnionNameds.get(type);
        }
        const name = type.names.combined;
        const named = new SimpleNamed(
            this.globalNamespace,
            name,
            countingNamingFunction,
            csNameStyle(name)
        );
        this.classAndUnionNameds = this.classAndUnionNameds.set(type, named);
        return named;
    };

    addPropertyNameds = (c: ClassType, classNamed: Named): void => {
        const ns = new Namespace(c.names.combined, this.globalNamespace, Set(), Set([classNamed]));
        const nameds = c.properties
            .map((t: Type, name: string) => {
                return new SimpleNamed(ns, name, countingNamingFunction, csNameStyle(name));
            })
            .toMap();
        this.propertyNameds = this.propertyNameds.set(c, nameds);
    };

    emitBlock = (f: () => void, semicolon: boolean = false): void => {
        this.emitLine("{");
        this.indent(f);
        this.emitLine(["}", semicolon ? ";" : ""]);
    };

    csType = (t: Type): Sourcelike => {
        if (t instanceof PrimitiveType) {
            switch (t.kind) {
                case "any":
                    return "object"; // FIXME: add issue annotation
                case "null":
                    return "object"; // FIXME: add issue annotation
                case "bool":
                    return "bool";
                case "integer":
                    return "long";
                case "double":
                    return "double";
                case "string":
                    return "string";
            }
        } else if (t instanceof ArrayType) {
            const itemsType = this.csType(t.items);
            if (this.useList) {
                return ["List<", itemsType, ">"];
            } else {
                return [itemsType, "[]"];
            }
        } else if (t instanceof ClassType) {
            return this.classAndUnionNameds.get(t);
        } else if (t instanceof MapType) {
            return ["Dictionary<string, ", this.csType(t.values), ">"];
        } else if (t instanceof UnionType) {
            const nonNull = nullableFromUnion(t);
            if (nonNull) return this.nullableCSType(nonNull);
            return this.classAndUnionNameds.get(t);
        }
        throw "Unknown type";
    };

    typeNameForUnionMember = (t: Type): string => {
        if (t instanceof PrimitiveType) {
            switch (t.kind) {
                case "any":
                    return "anything";
                case "null":
                    return "null";
                case "bool":
                    return "bool";
                case "integer":
                    return "long";
                case "double":
                    return "double";
                case "string":
                    return "string";
            }
        } else if (t instanceof ArrayType) {
            return this.typeNameForUnionMember(t.items) + "_array";
        } else if (t instanceof ClassType) {
            return this.names.get(this.classAndUnionNameds.get(t));
        } else if (t instanceof MapType) {
            return this.typeNameForUnionMember(t.values), "_map";
        } else if (t instanceof UnionType) {
            return "union";
        }
        throw "Unknown type";
    };

    nullableCSType = (t: Type): Sourcelike => {
        const csType = this.csType(t);
        if (isValueType(t)) {
            return [csType, "?"];
        } else {
            return csType;
        }
    };

    emitClass = (declaration: Sourcelike, name: Sourcelike, emitter: () => void): void => {
        this.emitLine(["public ", declaration, " ", name]);
        this.emitBlock(emitter);
    };

    get partialString(): string {
        return this.poco ? "" : "partial ";
    }

    emitClassDefinition = (c: ClassType): void => {
        const jsonProperty = this.dense ? denseJsonPropertyName : "JsonProperty";
        const propertyNameds = this.propertyNameds.get(c);
        this.emitClass([this.partialString, "class"], this.classAndUnionNameds.get(c), () => {
            const maxWidth = c.properties.map((_, name: string) => stringEscape(name).length).max();
            const withBlankLines = !this.poco && !this.dense;
            this.forEach(c.properties, withBlankLines, false, (t: Type, name: string) => {
                const named = propertyNameds.get(name);
                const escapedName = stringEscape(name);
                const attribute = ["[", jsonProperty, '("', escapedName, '")]'];
                const property = ["public ", this.csType(t), " ", named, " { get; set; }"];
                if (this.poco) {
                    this.emitLine(property);
                } else if (this.dense) {
                    const indent = maxWidth - escapedName.length + 1;
                    const whitespace = " ".repeat(indent);
                    this.emitLine([attribute, whitespace, property]);
                } else {
                    this.emitLine(attribute);
                    this.emitLine(property);
                }
            });
        });
    };

    unionFieldName = (t: Type): string => {
        return csNameStyle(this.typeNameForUnionMember(t));
    };

    emitUnionDefinition = (c: UnionType): void => {
        const [_, nonNulls] = removeNullFromUnion(c);
        this.emitClass([this.partialString, "struct"], this.classAndUnionNameds.get(c), () => {
            nonNulls.forEach((t: Type) => {
                const csType = this.nullableCSType(t);
                const field = this.unionFieldName(t);
                this.emitLine(["public ", csType, " ", field, ";"]);
            });
        });
    };

    emitExpressionMember(declare: Sourcelike, define: Sourcelike): void {
        if (this.version === 5) {
            this.emitLine(declare);
            this.emitBlock(() => {
                this.emitLine(["return ", define, ";"]);
            });
        } else {
            this.emitLine([declare, " => ", define, ";"]);
        }
    }

    emitFromJsonForTopLevel = (t: Type, name: string): void => {
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
        this.emitClass([partial, typeKind], this.topLevelNameds.get(name), () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(
                ["public static ", csType, " FromJson(string json)"],
                ["JsonConvert.DeserializeObject<", csType, ">(json, Converter.Settings)"]
            );
        });
    };

    emitUnionJSONPartial = (u: UnionType): void => {
        const tokenCase = (tokenType: string): void => {
            this.emitLine(["case JsonToken.", tokenType, ":"]);
        };

        const emitNullDeserializer = (): void => {
            tokenCase("Null");
            this.indent(() => this.emitLine("break;"));
        };

        const emitDeserializeType = (t: Type): void => {
            this.emitLine([
                this.unionFieldName(t),
                " = serializer.Deserialize<",
                this.csType(t),
                ">(reader);"
            ]);
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
        const named = this.classAndUnionNameds.get(u);
        this.emitClass("partial struct", named, () => {
            this.emitLine(["public ", named, "(JsonReader reader, JsonSerializer serializer)"]);
            this.emitBlock(() => {
                nonNulls.forEach((t: Type) => {
                    this.emitLine([this.unionFieldName(t), " = null;"]);
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
                    this.emitLine(['default: throw new Exception("Cannot convert ', named, '");']);
                });
            });
            this.emitNewline();
            this.emitLine("public void WriteJson(JsonWriter writer, JsonSerializer serializer)");
            this.emitBlock(() => {
                nonNulls.forEach((t: Type) => {
                    const fieldName = this.unionFieldName(t);
                    this.emitLine(["if (", fieldName, " != null)"]);
                    this.emitBlock(() => {
                        this.emitLine(["serializer.Serialize(writer, ", fieldName, ");"]);
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

    emitUnionConverterMembers = (): void => {
        const nameds = this.unions.map((u: UnionType) => this.classAndUnionNameds.get(u)).toSet();
        const canConvertExpr = intercalate(
            " || ",
            nameds.map((n: Named): Sourcelike => ["t == typeof(", n, ")"])
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
            nameds.forEach((n: Named) => {
                this.emitLine(["if (t == typeof(", n, "))"]);
                this.indent(() => this.emitLine(["return new ", n, "(reader, serializer);"]));
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
        this.emitNewline();
        this.emitLine(
            "public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)"
        );
        this.emitBlock(() => {
            this.emitLine("var t = value.GetType();");
            nameds.forEach((n: Named) => {
                this.emitLine(["if (t == typeof(", n, "))"]);
                this.emitBlock(() => {
                    this.emitLine(["((", n, ")value).WriteJson(writer, serializer);"]);
                    this.emitLine("return;");
                });
            });
            this.emitLine('throw new Exception("Unknown type");');
        });
    };

    emitConverterClass = (): void => {
        const haveUnions = this.unions.size > 0;
        // FIXME: Make Converter a Named
        let converterName: Sourcelike = ["Converter"];
        if (haveUnions) converterName = converterName.concat([": JsonConverter"]);
        this.emitClass("class", converterName, () => {
            if (haveUnions) {
                this.emitUnionConverterMembers();
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

    render(): RenderResult {
        const using = (ns: Sourcelike): void => {
            this.emitLine(["using ", ns, ";"]);
        };
        // FIXME: Use configurable namespace
        this.emitLine(["namespace ", this.namespaceName]);
        this.emitBlock(() => {
            for (const ns of ["System", "System.Net", "System.Collections.Generic"]) {
                using(ns);
            }
            if (!this.poco) {
                this.emitNewline();
                using("Newtonsoft.Json");
                if (this.dense) {
                    using([denseJsonPropertyName, " = Newtonsoft.Json.JsonPropertyAttribute"]);
                }
            }
            this.forEachWithLeadingAndInterposedBlankLines(this.classes, this.emitClassDefinition);
            this.forEachWithLeadingAndInterposedBlankLines(this.unions, this.emitUnionDefinition);
            if (!this.poco) {
                this.emitNewline();
                this.topLevels.forEach(this.emitFromJsonForTopLevel);
                this.forEachWithLeadingAndInterposedBlankLines(
                    this.unions,
                    this.emitUnionJSONPartial
                );
                this.emitNewline();
                this.emitSerializeClass();
                this.emitNewline();
                this.emitConverterClass();
            }
        });
        return { source: this.finishedSource(), names: this.names };
    }
}
