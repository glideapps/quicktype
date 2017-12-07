"use strict";

import { List, Collection, OrderedMap, OrderedSet, Map } from "immutable";
import {
    TypeKind,
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
import { TypeGraph } from "../TypeGraph";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import {
    utf16LegalizeCharacters,
    escapeNonPrintableMapper,
    utf16ConcatMap,
    standardUnicodeHexEscape,
    isAscii,
    isLetter,
    isDigit,
    capitalize,
    splitIntoWords,
    combineWords,
    allUpperWordStyle,
    firstUpperWordStyle,
    allLowerWordStyle
} from "../Strings";
import { intercalate, defined, assertNever, nonNull, assert } from "../Support";
import { Namespace, Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption, StringOption } from "../RendererOptions";
import { IssueAnnotationData, anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";

const unicode = require("unicode-properties");

export default class JavaTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption: BooleanOption;
    private readonly _packageOption: StringOption;

    constructor() {
        const justTypesOption = new BooleanOption("just-types", "Plain types only", false);
        // FIXME: Do this via a configurable named eventually.
        const packageOption = new StringOption("package", "Generated package name", "NAME", "io.quicktype");
        const options = [packageOption, justTypesOption];
        super("Java", ["java"], "java", options.map(o => o.definition));
        this._justTypesOption = justTypesOption;
        this._packageOption = packageOption;
    }

    renderGraph(graph: TypeGraph, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new JavaRenderer(
            graph,
            this._justTypesOption.getValue(optionValues),
            this._packageOption.getValue(optionValues)
        );
        return renderer.render();
    }
}

const keywords = [
    "Object",
    "Class",
    "System",
    "Long",
    "Double",
    "Boolean",
    "String",
    "Map",
    "Exception",
    "IOException",
    "JsonProperty",
    "JsonDeserialize",
    "JsonDeserializer",
    "JsonSerialize",
    "JsonSerializer",
    "JsonParser",
    "JsonProcessingException",
    "DeserializationContext",
    "SerializerProvider",
    "Converter",
    "abstract",
    "continue",
    "for",
    "new",
    "switch",
    "assert",
    "default",
    "goto",
    "package",
    "synchronized",
    "boolean",
    "do",
    "if",
    "private",
    "this",
    "break",
    "double",
    "implements",
    "protected",
    "throw",
    "byte",
    "else",
    "import",
    "public",
    "throws",
    "case",
    "enum",
    "instanceof",
    "return",
    "transient",
    "catch",
    "extends",
    "int",
    "short",
    "try",
    "char",
    "final",
    "interface",
    "static",
    "void",
    "class",
    "finally",
    "long",
    "strictfp",
    "volatile",
    "const",
    "float",
    "native",
    "super",
    "while",
    "null",
    "false",
    "true"
];

const typeNamingFunction = funPrefixNamer(n => javaNameStyle(true, false, n));
const propertyNamingFunction = funPrefixNamer(n => javaNameStyle(false, false, n));
const enumCaseNamingFunction = funPrefixNamer(n => javaNameStyle(true, true, n));

export const stringEscape = utf16ConcatMap(escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape));

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return true; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return isStartCharacter(codePoint) || (isAscii(codePoint) && isDigit(codePoint));
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

// FIXME: Handle acronyms consistently.  In particular, that means that
// we have to use namers to produce the getter and setter names - we can't
// just capitalize and concatenate.
// https://stackoverflow.com/questions/8277355/naming-convention-for-upper-case-abbreviations
function javaNameStyle(startWithUpper: boolean, upperUnderscore: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore ? allUpperWordStyle : startWithUpper ? firstUpperWordStyle : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
}

class JavaRenderer extends ConvenienceRenderer {
    constructor(graph: TypeGraph, private readonly _justTypes: boolean, private readonly _packageName: string) {
        super(graph);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForProperties(c: ClassType, classNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected topLevelNameStyle(rawName: string): string {
        return javaNameStyle(true, false, rawName);
    }

    protected get namedTypeNamer(): Namer {
        return typeNamingFunction;
    }

    protected get propertyNamer(): Namer {
        return propertyNamingFunction;
    }

    protected get caseNamer(): Namer {
        return enumCaseNamingFunction;
    }

    protected unionNeedsName(u: UnionType): boolean {
        return !nullableFromUnion(u);
    }

    // FIXME: This is the same as for C#.
    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        const definedTypes = type.directlyReachableTypes(t => {
            if ((!(t instanceof UnionType) && t.isNamedType()) || (t instanceof UnionType && !nullableFromUnion(t))) {
                return OrderedSet([t]);
            }
            return null;
        });
        assert(definedTypes.size <= 1, "Cannot have more than one defined type per top-level");

        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.

        const first = definedTypes.first();
        if (first === undefined) return null;
        return first;
    }

    fieldOrMethodName = (methodName: string, topLevelName: Name): Sourcelike => {
        if (this.topLevels.size === 1) {
            return methodName;
        }
        return [topLevelName, capitalize(methodName)];
    };

    methodName = (prefix: string, suffix: string, topLevelName: Name): Sourcelike => {
        if (this.topLevels.size === 1) {
            return [prefix, suffix];
        }
        return [prefix, topLevelName, suffix];
    };

    decoderName = (topLevelName: Name): Sourcelike => {
        return this.fieldOrMethodName("fromJsonString", topLevelName);
    };

    encoderName = (topLevelName: Name): Sourcelike => {
        return this.fieldOrMethodName("toJsonString", topLevelName);
    };

    readerGetterName = (topLevelName: Name): Sourcelike => {
        return this.methodName("get", "ObjectReader", topLevelName);
    };

    writerGetterName = (topLevelName: Name): Sourcelike => {
        return this.methodName("get", "ObjectWriter", topLevelName);
    };

    emitFileComment = (filename: Sourcelike): void => {
        this.emitLine("// ", filename, ".java");
    };

    emitPackageAndImports = (imports: string[]): void => {
        const allImports = ["java.util.Map"].concat(this._justTypes ? [] : imports);
        this.emitLine("package ", this._packageName, ";");
        this.emitNewline();
        for (const pkg of allImports) {
            this.emitLine("import ", pkg, ";");
        }
    };

    emitFileHeader = (fileName: Sourcelike, imports: string[]): void => {
        this.emitFileComment(fileName);
        this.emitNewline();
        this.emitPackageAndImports(imports);
        this.emitNewline();
    };

    emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    javaType = (reference: boolean, t: Type, withIssues: boolean = false): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Object"),
            nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Object"),
            boolType => (reference ? "Boolean" : "boolean"),
            integerType => (reference ? "Long" : "long"),
            doubleType => (reference ? "Double" : "double"),
            stringType => "String",
            arrayType => [this.javaType(false, arrayType.items, withIssues), "[]"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.javaType(true, mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable) return this.javaType(true, nullable, withIssues);
                return this.nameForNamedType(unionType);
            }
        );
    };

    javaTypeWithoutGenerics = (reference: boolean, t: Type): Sourcelike => {
        if (t instanceof ArrayType) {
            return [this.javaTypeWithoutGenerics(false, t.items), "[]"];
        } else if (t instanceof MapType) {
            return "Map";
        } else if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable) return this.javaTypeWithoutGenerics(true, nullable);
            return this.nameForNamedType(t);
        } else {
            return this.javaType(reference, t);
        }
    };

    emitClassDefinition = (c: ClassType, className: Name): void => {
        this.emitFileHeader(className, ["com.fasterxml.jackson.annotation.*"]);
        if (c.properties.isEmpty() && !this._justTypes) {
            this.emitLine("@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE)");
        }
        this.emitBlock(["public class ", className], () => {
            this.forEachProperty(c, "none", (name, _, t) => {
                this.emitLine("private ", this.javaType(false, t, true), " ", name, ";");
            });
            this.forEachProperty(c, "leading-and-interposing", (name, jsonName, t) => {
                if (!this._justTypes) this.emitLine('@JsonProperty("', stringEscape(jsonName), '")');
                const rendered = this.javaType(false, t);
                this.emitLine("public ", rendered, " get", modifySource(capitalize, name), "() { return ", name, "; }");
                if (!this._justTypes) this.emitLine('@JsonProperty("', stringEscape(jsonName), '")');
                this.emitLine(
                    "public void set",
                    modifySource(capitalize, name),
                    "(",
                    rendered,
                    " value) { this.",
                    name,
                    " = value; }"
                );
            });
        });
    };

    unionField = (t: Type, withIssues: boolean = false): { fieldType: Sourcelike; fieldName: string } => {
        const fieldType = this.javaType(true, t, withIssues);
        const fieldName = `${this.unionFieldName(t)}Value`;
        return { fieldType, fieldName };
    };

    emitUnionDefinition = (u: UnionType, unionName: Name): void => {
        const tokenCase = (tokenType: string): void => {
            this.emitLine("case ", tokenType, ":");
        };

        const emitNullDeserializer = (): void => {
            tokenCase("VALUE_NULL");
            this.indent(() => this.emitLine("break;"));
        };

        const emitDeserializeType = (t: Type): void => {
            const { fieldName } = this.unionField(t);
            const rendered = this.javaTypeWithoutGenerics(true, t);
            this.emitLine("value.", fieldName, " = jsonParser.readValueAs(", rendered, ".class);");
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

            if (!u.findMember("integer")) tokenCase("VALUE_NUMBER_INT");
            tokenCase("VALUE_NUMBER_FLOAT");
            this.indent(() => emitDeserializeType(t));
        };

        this.emitFileHeader(unionName, [
            "java.io.IOException",
            "com.fasterxml.jackson.core.*",
            "com.fasterxml.jackson.databind.*",
            "com.fasterxml.jackson.databind.annotation.*"
        ]);
        if (!this._justTypes) {
            this.emitLine("@JsonDeserialize(using = ", unionName, ".Deserializer.class)");
            this.emitLine("@JsonSerialize(using = ", unionName, ".Serializer.class)");
        }
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        this.emitBlock(["public class ", unionName], () => {
            nonNulls.forEach(t => {
                const { fieldType, fieldName } = this.unionField(t, true);
                this.emitLine("public ", fieldType, " ", fieldName, ";");
            });
            if (this._justTypes) return;
            this.emitNewline();
            this.emitBlock(["static class Deserializer extends JsonDeserializer<", unionName, ">"], () => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public ",
                        unionName,
                        " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) throws IOException, JsonProcessingException"
                    ],
                    () => {
                        this.emitLine(unionName, " value = new ", unionName, "();");
                        this.emitLine("switch (jsonParser.getCurrentToken()) {");
                        if (maybeNull) emitNullDeserializer();
                        emitDeserializer(["VALUE_NUMBER_INT"], "integer");
                        emitDoubleSerializer();
                        emitDeserializer(["VALUE_TRUE", "VALUE_FALSE"], "bool");
                        emitDeserializer(["VALUE_STRING"], "string");
                        emitDeserializer(["START_ARRAY"], "array");
                        emitDeserializer(["START_OBJECT"], "class");
                        emitDeserializer(["VALUE_STRING"], "enum");
                        emitDeserializer(["START_OBJECT"], "map");
                        this.emitLine('default: throw new IOException("Cannot deserialize ', unionName, '");');
                        this.emitLine("}");
                        this.emitLine("return value;");
                    }
                );
            });
            this.emitNewline();
            this.emitBlock(["static class Serializer extends JsonSerializer<", unionName, ">"], () => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public void serialize(",
                        unionName,
                        " obj, JsonGenerator jsonGenerator, SerializerProvider serializerProvider) throws IOException"
                    ],
                    () => {
                        nonNulls.forEach(t => {
                            const { fieldName } = this.unionField(t, true);
                            this.emitBlock(["if (obj.", fieldName, " != null)"], () => {
                                this.emitLine("jsonGenerator.writeObject(obj.", fieldName, ");");
                                this.emitLine("return;");
                            });
                        });
                        if (maybeNull) {
                            this.emitLine("jsonGenerator.writeNull();");
                        } else {
                            this.emitLine('throw new IOException("', unionName, ' must not be null");');
                        }
                    }
                );
            });
        });
    };

    emitEnumDefinition = (e: EnumType, enumName: Name): void => {
        this.emitFileHeader(enumName, ["java.io.IOException", "com.fasterxml.jackson.annotation.*"]);
        const caseNames: Sourcelike[] = [];
        this.forEachCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        caseNames.push(";");
        this.emitBlock(["public enum ", enumName], () => {
            this.emitLine(caseNames);
            this.emitNewline();
            this.emitLine("@JsonValue");
            this.emitBlock("public String toValue()", () => {
                this.emitLine("switch (this) {");
                this.forEachCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ': return "', stringEscape(jsonName), '";');
                });
                this.emitLine("}");
                this.emitLine("return null;");
            });
            this.emitNewline();
            this.emitLine("@JsonCreator");
            this.emitBlock(["public static ", enumName, " forValue(String value) throws IOException"], () => {
                this.forEachCase(e, "none", (name, jsonName) => {
                    this.emitLine('if (value.equals("', stringEscape(jsonName), '")) return ', name, ";");
                });
                this.emitLine('throw new IOException("Cannot deserialize ', enumName, '");');
            });
        });
    };

    emitConverterClass = (): void => {
        this.emitFileComment("Converter");
        this.emitNewline();
        this.emitMultiline(`// To use this code, add the following Maven dependency to your project:
//
//     com.fasterxml.jackson.core : jackson-databind : 2.9.0
//
// Import this package:
//`);
        this.emitLine("//     import ", this._packageName, ".Converter;");
        this.emitMultiline(`//
// Then you can deserialize a JSON string with
//`);
        this.forEachTopLevel("none", (t, name) => {
            this.emitLine(
                "//     ",
                this.javaType(false, t),
                " data = Converter.",
                this.decoderName(name),
                "(jsonString);"
            );
        });
        this.emitNewline();
        this.emitPackageAndImports([
            "java.io.IOException",
            "com.fasterxml.jackson.databind.*",
            "com.fasterxml.jackson.core.JsonProcessingException"
        ]);
        this.emitNewline();
        this.emitBlock(["public class Converter"], () => {
            this.emitLine("// Serialize/deserialize helpers");
            this.forEachTopLevel("leading-and-interposing", (topLevelType, topLevelName) => {
                const topLevelTypeRendered = this.javaType(false, topLevelType);
                this.emitBlock(
                    [
                        "public static ",
                        topLevelTypeRendered,
                        " ",
                        this.decoderName(topLevelName),
                        "(String json) throws IOException"
                    ],
                    () => {
                        this.emitLine("return ", this.readerGetterName(topLevelName), "().readValue(json);");
                    }
                );
                this.emitNewline();
                this.emitBlock(
                    [
                        "public static String ",
                        this.encoderName(topLevelName),
                        "(",
                        topLevelTypeRendered,
                        " obj) throws JsonProcessingException"
                    ],
                    () => {
                        this.emitLine("return ", this.writerGetterName(topLevelName), "().writeValueAsString(obj);");
                    }
                );
            });
            this.forEachTopLevel("leading-and-interposing", (topLevelType, topLevelName) => {
                const readerName = this.fieldOrMethodName("reader", topLevelName);
                const writerName = this.fieldOrMethodName("writer", topLevelName);
                this.emitLine("private static ObjectReader ", readerName, ";");
                this.emitLine("private static ObjectWriter ", writerName, ";");
                this.emitNewline();
                this.emitBlock(
                    ["private static void ", this.methodName("instantiate", "Mapper", topLevelName), "()"],
                    () => {
                        const renderedForClass = this.javaTypeWithoutGenerics(false, topLevelType);
                        this.emitLine("ObjectMapper mapper = new ObjectMapper();");
                        this.emitLine(readerName, " = mapper.reader(", renderedForClass, ".class);");
                        this.emitLine(writerName, " = mapper.writerFor(", renderedForClass, ".class);");
                    }
                );
                this.emitNewline();
                this.emitBlock(["private static ObjectReader ", this.readerGetterName(topLevelName), "()"], () => {
                    this.emitLine("if (", readerName, " == null) instantiateMapper();");
                    this.emitLine("return ", readerName, ";");
                });
                this.emitNewline();
                this.emitBlock(["private static ObjectWriter ", this.writerGetterName(topLevelName), "()"], () => {
                    this.emitLine("if (", writerName, " == null) instantiateMapper();");
                    this.emitLine("return ", writerName, ";");
                });
            });
        });
    };

    protected emitSourceStructure(): void {
        if (!this._justTypes) {
            this.emitConverterClass();
        }
        this.forEachNamedType(
            "leading-and-interposing",
            false,
            this.emitClassDefinition,
            this.emitEnumDefinition,
            this.emitUnionDefinition
        );
    }
}
