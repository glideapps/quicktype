import { Map } from "immutable";

import { TypeKind, Type, ArrayType, MapType, EnumType, UnionType, ClassType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { Sourcelike, maybeAnnotated } from "../Source";
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
} from "../support/Strings";
import { Name, Namer, funPrefixNamer, DependencyName } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption, StringOption, Option, OptionValues, getOptionValues } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { defined, assert, assertNever } from "../support/Support";
import { RenderContext } from "../Renderer";

export const javaOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    // FIXME: Do this via a configurable named eventually.
    packageName: new StringOption("package", "Generated package name", "NAME", "io.quicktype")
};

export class JavaTargetLanguage extends TargetLanguage {
    constructor() {
        super("Java", ["java"], "java");
    }

    protected getOptions(): Option<any>[] {
        return [javaOptions.packageName, javaOptions.justTypes];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): JavaRenderer {
        return new JavaRenderer(this, renderContext, getOptionValues(javaOptions, untypedOptionValues));
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
    "Override",
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

const typeNamingFunction = funPrefixNamer("types", n => javaNameStyle(true, false, n));
const propertyNamingFunction = funPrefixNamer("properties", n => javaNameStyle(false, false, n));
const enumCaseNamingFunction = funPrefixNamer("enum-cases", n => javaNameStyle(true, true, n));

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

export class JavaRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;
    private _gettersAndSettersForPropertyName: Map<Name, [Name, Name]>;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof javaOptions>
    ) {
        super(targetLanguage, renderContext);
        this._gettersAndSettersForPropertyName = Map();
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return typeNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return propertyNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return propertyNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return enumCaseNamingFunction;
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

    protected makeNamesForPropertyGetterAndSetter(
        _c: ClassType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        name: Name
    ): [Name, Name] {
        const getterName = new DependencyName(propertyNamingFunction, name.order, lookup => `get_${lookup(name)}`);
        const setterName = new DependencyName(propertyNamingFunction, name.order, lookup => `set_${lookup(name)}`);
        return [getterName, setterName];
    }

    protected makePropertyDependencyNames(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        name: Name
    ): Name[] {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(c, className, p, jsonName, name);
        this._gettersAndSettersForPropertyName = this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }

    private fieldOrMethodName(methodName: string, topLevelName: Name): Sourcelike {
        if (this.topLevels.size === 1) {
            return methodName;
        }
        return [topLevelName, capitalize(methodName)];
    }

    private methodName(prefix: string, suffix: string, topLevelName: Name): Sourcelike {
        if (this.topLevels.size === 1) {
            return [prefix, suffix];
        }
        return [prefix, topLevelName, suffix];
    }

    private decoderName(topLevelName: Name): Sourcelike {
        return this.fieldOrMethodName("fromJsonString", topLevelName);
    }

    private encoderName(topLevelName: Name): Sourcelike {
        return this.fieldOrMethodName("toJsonString", topLevelName);
    }

    private readerGetterName(topLevelName: Name): Sourcelike {
        return this.methodName("get", "ObjectReader", topLevelName);
    }

    private writerGetterName(topLevelName: Name): Sourcelike {
        return this.methodName("get", "ObjectWriter", topLevelName);
    }

    protected startFile(basename: Sourcelike): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.java`;
    }

    protected finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected emitPackageAndImports(imports: string[]): void {
        const allImports = ["java.util.Map"].concat(this._options.justTypes ? [] : imports);
        this.emitLine("package ", this._options.packageName, ";");
        this.ensureBlankLine();
        for (const pkg of allImports) {
            this.emitLine("import ", pkg, ";");
        }
    }

    protected emitFileHeader(fileName: Sourcelike, imports: string[]): void {
        this.startFile(fileName);
        this.ensureBlankLine();
        this.emitPackageAndImports(imports);
        this.ensureBlankLine();
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected javaType(reference: boolean, t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Object"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Object"),
            _boolType => (reference ? "Boolean" : "boolean"),
            _integerType => (reference ? "Long" : "long"),
            _doubleType => (reference ? "Double" : "double"),
            _stringType => "String",
            arrayType => [this.javaType(false, arrayType.items, withIssues), "[]"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.javaType(true, mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.javaType(true, nullable, withIssues);
                return this.nameForNamedType(unionType);
            }
        );
    }

    protected javaTypeWithoutGenerics(reference: boolean, t: Type): Sourcelike {
        if (t instanceof ArrayType) {
            return [this.javaTypeWithoutGenerics(false, t.items), "[]"];
        } else if (t instanceof MapType) {
            return "Map";
        } else if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable !== null) return this.javaTypeWithoutGenerics(true, nullable);
            return this.nameForNamedType(t);
        } else {
            return this.javaType(reference, t);
        }
    }

    protected emitClassAttributes(c: ClassType, _className: Name): void {
        if (c.getProperties().isEmpty() && !this._options.justTypes) {
            this.emitLine("@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE)");
        }
    }

    protected emitAccessorAttributes(
        _c: ClassType,
        _className: Name,
        _propertyName: Name,
        jsonName: string,
        _p: ClassProperty,
        _isSetter: boolean
    ): void {
        if (!this._options.justTypes) {
            this.emitLine('@JsonProperty("', stringEscape(jsonName), '")');
        }
    }

    protected importsForType(t: ClassType | UnionType | EnumType): string[] {
        if (t instanceof ClassType) {
            return ["com.fasterxml.jackson.annotation.*"];
        }
        if (t instanceof UnionType) {
            return [
                "java.io.IOException",
                "com.fasterxml.jackson.core.*",
                "com.fasterxml.jackson.databind.*",
                "com.fasterxml.jackson.databind.annotation.*"
            ];
        }
        if (t instanceof EnumType) {
            return ["java.io.IOException", "com.fasterxml.jackson.annotation.*"];
        }
        return assertNever(t);
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitFileHeader(className, this.importsForType(c));
        this.emitDescription(this.descriptionForType(c));
        this.emitClassAttributes(c, className);
        this.emitBlock(["public class ", className], () => {
            this.forEachClassProperty(c, "none", (name, _, p) => {
                this.emitLine("private ", this.javaType(false, p.type, true), " ", name, ";");
            });
            this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, p) => {
                this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                const [getterName, setterName] = defined(this._gettersAndSettersForPropertyName.get(name));
                this.emitAccessorAttributes(c, className, name, jsonName, p, false);
                const rendered = this.javaType(false, p.type);
                this.emitLine("public ", rendered, " ", getterName, "() { return ", name, "; }");
                this.emitAccessorAttributes(c, className, name, jsonName, p, true);
                this.emitLine("public void ", setterName, "(", rendered, " value) { this.", name, " = value; }");
            });
        });
        this.finishFile();
    }

    protected unionField(
        u: UnionType,
        t: Type,
        withIssues: boolean = false
    ): { fieldType: Sourcelike; fieldName: Sourcelike } {
        const fieldType = this.javaType(true, t, withIssues);
        // FIXME: "Value" should be part of the name.
        const fieldName = [this.nameForUnionMember(u, t), "Value"];
        return { fieldType, fieldName };
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        const tokenCase = (tokenType: string): void => {
            this.emitLine("case ", tokenType, ":");
        };

        const emitNullDeserializer = (): void => {
            tokenCase("VALUE_NULL");
            this.indent(() => this.emitLine("break;"));
        };

        const emitDeserializeType = (t: Type): void => {
            const { fieldName } = this.unionField(u, t);
            const rendered = this.javaTypeWithoutGenerics(true, t);
            this.emitLine("value.", fieldName, " = jsonParser.readValueAs(", rendered, ".class);");
            this.emitLine("break;");
        };

        const emitDeserializer = (tokenTypes: string[], kind: TypeKind): void => {
            const t = u.findMember(kind);
            if (t === undefined) return;

            for (const tokenType of tokenTypes) {
                tokenCase(tokenType);
            }
            this.indent(() => emitDeserializeType(t));
        };

        const emitDoubleSerializer = (): void => {
            const t = u.findMember("double");
            if (t === undefined) return;

            if (u.findMember("integer") === undefined) tokenCase("VALUE_NUMBER_INT");
            tokenCase("VALUE_NUMBER_FLOAT");
            this.indent(() => emitDeserializeType(t));
        };

        this.emitFileHeader(unionName, this.importsForType(u));
        this.emitDescription(this.descriptionForType(u));
        if (!this._options.justTypes) {
            this.emitLine("@JsonDeserialize(using = ", unionName, ".Deserializer.class)");
            this.emitLine("@JsonSerialize(using = ", unionName, ".Serializer.class)");
        }
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        this.emitBlock(["public class ", unionName], () => {
            nonNulls.forEach(t => {
                const { fieldType, fieldName } = this.unionField(u, t, true);
                this.emitLine("public ", fieldType, " ", fieldName, ";");
            });
            if (this._options.justTypes) return;
            this.ensureBlankLine();
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
                        if (maybeNull !== null) emitNullDeserializer();
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
            this.ensureBlankLine();
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
                            const { fieldName } = this.unionField(u, t, true);
                            this.emitBlock(["if (obj.", fieldName, " != null)"], () => {
                                this.emitLine("jsonGenerator.writeObject(obj.", fieldName, ");");
                                this.emitLine("return;");
                            });
                        });
                        if (maybeNull !== null) {
                            this.emitLine("jsonGenerator.writeNull();");
                        } else {
                            this.emitLine('throw new IOException("', unionName, ' must not be null");');
                        }
                    }
                );
            });
        });
        this.finishFile();
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitFileHeader(enumName, this.importsForType(e));
        this.emitDescription(this.descriptionForType(e));
        const caseNames: Sourcelike[] = [];
        this.forEachEnumCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        caseNames.push(";");
        this.emitBlock(["public enum ", enumName], () => {
            this.emitLine(caseNames);
            this.ensureBlankLine();
            this.emitLine("@JsonValue");
            this.emitBlock("public String toValue()", () => {
                this.emitLine("switch (this) {");
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ': return "', stringEscape(jsonName), '";');
                });
                this.emitLine("}");
                this.emitLine("return null;");
            });
            this.ensureBlankLine();
            this.emitLine("@JsonCreator");
            this.emitBlock(["public static ", enumName, " forValue(String value) throws IOException"], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine('if (value.equals("', stringEscape(jsonName), '")) return ', name, ";");
                });
                this.emitLine('throw new IOException("Cannot deserialize ', enumName, '");');
            });
        });
        this.finishFile();
    }

    protected emitConverterClass(): void {
        this.startFile("Converter");
        this.ensureBlankLine();
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitCommentLines([
                "To use this code, add the following Maven dependency to your project:",
                "",
                "    com.fasterxml.jackson.core : jackson-databind : 2.9.0",
                "",
                "Import this package:",
                ""
            ]);
        }
        this.emitLine("//     import ", this._options.packageName, ".Converter;");
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
        this.ensureBlankLine();
        this.emitPackageAndImports([
            "java.io.IOException",
            "com.fasterxml.jackson.databind.*",
            "com.fasterxml.jackson.core.JsonProcessingException"
        ]);
        this.ensureBlankLine();
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
                this.ensureBlankLine();
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
                this.ensureBlankLine();
                this.emitBlock(
                    ["private static void ", this.methodName("instantiate", "Mapper", topLevelName), "()"],
                    () => {
                        const renderedForClass = this.javaTypeWithoutGenerics(false, topLevelType);
                        this.emitLine("ObjectMapper mapper = new ObjectMapper();");
                        this.emitLine(readerName, " = mapper.reader(", renderedForClass, ".class);");
                        this.emitLine(writerName, " = mapper.writerFor(", renderedForClass, ".class);");
                    }
                );
                this.ensureBlankLine();
                this.emitBlock(["private static ObjectReader ", this.readerGetterName(topLevelName), "()"], () => {
                    this.emitLine(
                        "if (",
                        readerName,
                        " == null) ",
                        this.methodName("instantiate", "Mapper", topLevelName),
                        "();"
                    );
                    this.emitLine("return ", readerName, ";");
                });
                this.ensureBlankLine();
                this.emitBlock(["private static ObjectWriter ", this.writerGetterName(topLevelName), "()"], () => {
                    this.emitLine(
                        "if (",
                        writerName,
                        " == null) ",
                        this.methodName("instantiate", "Mapper", topLevelName),
                        "();"
                    );
                    this.emitLine("return ", writerName, ";");
                });
            });
        });
        this.finishFile();
    }

    protected emitSourceStructure(): void {
        if (!this._options.justTypes) {
            this.emitConverterClass();
        }
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n)
        );
    }
}
