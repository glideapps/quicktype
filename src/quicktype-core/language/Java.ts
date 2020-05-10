import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { DependencyName, funPrefixNamer, Name, Namer } from "../Naming";
import { RenderContext } from "../Renderer";
import { BooleanOption, EnumOption, getOptionValues, Option, OptionValues, StringOption } from "../RendererOptions";
import { maybeAnnotated, Sourcelike } from "../Source";
import { acronymOption, acronymStyle, AcronymStyleOptions } from "../support/Acronyms";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    capitalize,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    isAscii,
    isDigit,
    isLetter,
    splitIntoWords,
    standardUnicodeHexEscape,
    utf16ConcatMap,
    utf16LegalizeCharacters,
} from "../support/Strings";
import { assert, assertNever, defined, panic } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { ArrayType, ClassProperty, ClassType, EnumType, MapType, Type, TypeKind, UnionType } from "../Type";
import { directlyReachableSingleNamedType, matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { StringTypeMapping, TransformedStringTypeKind, PrimitiveStringTypeKind } from "..";

export const javaOptions = {
    useList: new EnumOption(
        "array-type",
        "Use T[] or List<T>",
        [
            ["array", false],
            ["list", true],
        ],
        "array"
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    // FIXME: Do this via a configurable named eventually.
    packageName: new StringOption("package", "Generated package name", "NAME", "io.quicktype"),
    lombok: new BooleanOption("lombok", "Use lombok", false, "primary"),
};

export class JavaTargetLanguage extends TargetLanguage {
    constructor() {
        super("Java", ["java"], "java");
    }

    protected getOptions(): Option<any>[] {
        return [
            javaOptions.useList,
            javaOptions.justTypes,
            javaOptions.acronymStyle,
            javaOptions.packageName,
            javaOptions.lombok,
        ];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): JavaRenderer {
        return new JavaRenderer(this, renderContext, getOptionValues(javaOptions, untypedOptionValues));
    }

    get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        mapping.set("date", "date");
        mapping.set("time", "time");
        mapping.set("date-time", "date-time");
        mapping.set("uuid", "uuid");
        return mapping;
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
    "UUID",
    "OffsetDateTime",
    "OffsetTime",
    "LocalDate",
    "LocalDateTime",
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
    "true",
];

export const stringEscape = utf16ConcatMap(escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape));

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return true; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return isStartCharacter(codePoint) || (isAscii(codePoint) && isDigit(codePoint));
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

export function javaNameStyle(
    startWithUpper: boolean,
    upperUnderscore: boolean,
    original: string,
    acronymsStyle: (s: string) => string = allUpperWordStyle
): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore ? allUpperWordStyle : startWithUpper ? firstUpperWordStyle : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper ? allUpperWordStyle : allLowerWordStyle,
        acronymsStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
}

export class JavaRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name]>();
    private _haveEmittedLeadingComments = false;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof javaOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return this.getNameStyling("typeNamingFunction");
    }

    protected namerForObjectProperty(): Namer {
        return this.getNameStyling("propertyNamingFunction");
    }

    protected makeUnionMemberNamer(): Namer {
        return this.getNameStyling("propertyNamingFunction");
    }

    protected makeEnumCaseNamer(): Namer {
        return this.getNameStyling("enumCaseNamingFunction");
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
        const getterName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `get_${lookup(name)}`
        );
        const setterName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `set_${lookup(name)}`
        );
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
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }

    private getNameStyling(convention: string): Namer {
        const styling: { [key: string]: Namer } = {
            typeNamingFunction: funPrefixNamer("types", (n) =>
                javaNameStyle(true, false, n, acronymStyle(this._options.acronymStyle))
            ),
            propertyNamingFunction: funPrefixNamer("properties", (n) =>
                javaNameStyle(false, false, n, acronymStyle(this._options.acronymStyle))
            ),
            enumCaseNamingFunction: funPrefixNamer("enum-cases", (n) =>
                javaNameStyle(true, true, n, acronymStyle(this._options.acronymStyle))
            ),
        };
        return styling[convention];
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
        // FIXME: Why is this necessary?
        this.ensureBlankLine();
        if (!this._haveEmittedLeadingComments && this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            this.ensureBlankLine();
            this._haveEmittedLeadingComments = true;
        }
    }

    protected finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected emitPackageAndImports(imports: string[]): void {
        this.emitLine("package ", this._options.packageName, ";");
        this.ensureBlankLine();
        for (const pkg of imports) {
            this.emitLine("import ", pkg, ";");
        }
    }

    protected emitFileHeader(fileName: Sourcelike, imports: string[]): void {
        this.startFile(fileName);
        this.emitPackageAndImports(imports);
        this.ensureBlankLine();
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected emitTryCatch(main: () => void, handler: () => void, exception: string = "Exception") {
        this.emitLine("try {");
        this.indent(main);
        this.emitLine("} catch (", exception, " ex) {");
        this.indent(handler);
        this.emitLine("}");
    }

    protected emitIgnoredTryCatchBlock(f: () => void) {
        this.emitTryCatch(f, () => this.emitLine("// Ignored"));
    }

    protected javaType(reference: boolean, t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Object"),
            (_nullType) => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Object"),
            (_boolType) => (reference ? "Boolean" : "boolean"),
            (_integerType) => (reference ? "Long" : "long"),
            (_doubleType) => (reference ? "Double" : "double"),
            (_stringType) => "String",
            (arrayType) => {
                if (this._options.useList) {
                    return ["List<", this.javaType(true, arrayType.items, withIssues), ">"];
                } else {
                    return [this.javaType(false, arrayType.items, withIssues), "[]"];
                }
            },
            (classType) => this.nameForNamedType(classType),
            (mapType) => ["Map<String, ", this.javaType(true, mapType.values, withIssues), ">"],
            (enumType) => this.nameForNamedType(enumType),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.javaType(true, nullable, withIssues);
                return this.nameForNamedType(unionType);
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "time") {
                    return "OffsetTime";
                }
                if (transformedStringType.kind === "date") {
                    return "LocalDate";
                }
                if (transformedStringType.kind === "date-time") {
                    return "OffsetDateTime";
                }
                if (transformedStringType.kind === "uuid") {
                    return "UUID";
                }
                return "String";
            }
        );
    }

    protected javaImport(t: Type): string[] {
        return matchType<string[]>(
            t,
            (_anyType) => [],
            (_nullType) => [],
            (_boolType) => [],
            (_integerType) => [],
            (_doubleType) => [],
            (_stringType) => [],
            (arrayType) => {
                if (this._options.useList) {
                    return [...this.javaImport(arrayType.items), "java.util.List"];
                } else {
                    return [...this.javaImport(arrayType.items)];
                }
            },
            (_classType) => [],
            (mapType) => [...this.javaImport(mapType.values), "java.util.Map"],
            (_enumType) => [],
            (unionType) => {
                const imports: string[] = [];
                unionType.members.forEach((type) => this.javaImport(type).forEach((imp) => imports.push(imp)));
                return imports;
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "time") {
                    return ["java.time.OffsetTime"];
                }
                if (transformedStringType.kind === "date") {
                    return ["java.time.LocalDate"];
                }
                if (transformedStringType.kind === "date-time") {
                    return ["java.time.OffsetDateTime"];
                }
                if (transformedStringType.kind === "uuid") {
                    return ["java.util.UUID"];
                }
                return [];
            }
        );
    }

    protected javaTypeWithoutGenerics(reference: boolean, t: Type): Sourcelike {
        if (t instanceof ArrayType) {
            if (this._options.useList) {
                return ["List<", this.javaTypeWithoutGenerics(true, t.items), ">"];
            } else {
                return [this.javaTypeWithoutGenerics(false, t.items), "[]"];
            }
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
        if (c.getProperties().size === 0 && !this._options.justTypes) {
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
            const imports = [];
            if (!this._options.justTypes) imports.push("com.fasterxml.jackson.annotation.*");
            if (this._options.lombok) imports.push("lombok.Data");
            return imports;
        }
        if (t instanceof UnionType) {
            if (this._options.justTypes) {
                return ["java.io.IOException"];
            }
            return ["java.io.IOException", "com.fasterxml.jackson.core.*"]
                .concat(this._options.useList ? ["com.fasterxml.jackson.core.type.*"] : [])
                .concat(["com.fasterxml.jackson.databind.*", "com.fasterxml.jackson.databind.annotation.*"]);
        }
        if (t instanceof EnumType) {
            if (this._options.justTypes) {
                return ["java.io.IOException"];
            } else {
                return ["java.io.IOException", "com.fasterxml.jackson.annotation.*"];
            }
        }
        return assertNever(t);
    }

    protected importsForClass(c: ClassType): string[] {
        const imports: string[] = [];
        this.forEachClassProperty(c, "none", (_name, _jsonName, p) => {
            this.javaImport(p.type).forEach((imp) => imports.push(imp));
        });
        imports.sort();
        return [...new Set(imports)];
    }

    protected importsForUnionMembers(u: UnionType): string[] {
        const imports: string[] = [];
        const [, nonNulls] = removeNullFromUnion(u);
        this.forEachUnionMember(u, nonNulls, "none", null, (_fieldName, t) => {
            this.javaImport(t).forEach((imp) => imports.push(imp));
        });
        if (imports.some((imp) => imp.includes("Time") || imp.includes("Date")))
            imports.push("java.time.format.DateTimeFormatter");
        if (imports.some((imp) => imp.includes("DateTime")))
            imports.push("java.time.ZoneOffset", "java.time.LocalDateTime");
        imports.sort();
        return [...new Set(imports)];
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        let imports = [...this.importsForType(c), ...this.importsForClass(c)];

        this.emitFileHeader(className, imports);
        this.emitDescription(this.descriptionForType(c));
        this.emitClassAttributes(c, className);
        if (this._options.lombok) {
            this.emitLine("@Data");
        }
        this.emitBlock(["public class ", className], () => {
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                if (this._options.lombok) {
                    this.emitAccessorAttributes(c, className, name, jsonName, p, false);
                }
                this.emitLine("private ", this.javaType(false, p.type, true), " ", name, ";");
            });
            if (!this._options.lombok) {
                this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, p) => {
                    this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                    const [getterName, setterName] = defined(this._gettersAndSettersForPropertyName.get(name));
                    this.emitAccessorAttributes(c, className, name, jsonName, p, false);
                    const rendered = this.javaType(false, p.type);
                    this.emitLine("public ", rendered, " ", getterName, "() { return ", name, "; }");
                    this.emitAccessorAttributes(c, className, name, jsonName, p, true);
                    this.emitLine("public void ", setterName, "(", rendered, " value) { this.", name, " = value; }");
                });
            }
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
        const stringBasedObjects: TypeKind[] = ["uuid", "time", "date", "date-time"];

        const tokenCase = (tokenType: string): void => {
            this.emitLine("case ", tokenType, ":");
        };

        const emitNullDeserializer = (): void => {
            this.indent(() => {
                tokenCase("VALUE_NULL");
                this.indent(() => this.emitLine("break;"));
            });
        };

        const emitDeserializerCodeForStringObjects = (
            fieldName: Sourcelike,
            kind: TypeKind,
            parseFrom: string
        ): void => {
            switch (kind) {
                case "date":
                    this.emitLine("value.", fieldName, " = LocalDate.parse(", parseFrom, ");");

                    break;
                case "time":
                    this.emitLine("value.", fieldName, " = OffsetTime.parse(", parseFrom, ");");

                    break;
                case "date-time":
                    this.emitTryCatch(
                        () => {
                            this.emitLine(
                                "value.",
                                fieldName,
                                " = OffsetDateTime.parse(",
                                parseFrom,
                                '.replace(" ", "T"));'
                            );
                        },
                        () => {
                            this.emitLine(
                                "value.",
                                fieldName,
                                " = LocalDateTime.parse(",
                                parseFrom,
                                '.replace(" ", "T")).atOffset(ZoneOffset.UTC);'
                            );
                        }
                    );
                    break;
                case "uuid":
                    this.emitLine("value.", fieldName, " = UUID.fromString(", parseFrom, ");");

                    break;
                default:
                    return panic("Requested type isnt an object!");
            }
        };

        const emitDeserializeType = (t: Type, variableFieldName: string = ""): void => {
            const { fieldName } = this.unionField(u, t);
            const rendered = this.javaTypeWithoutGenerics(true, t);
            if (this._options.useList && t instanceof ArrayType) {
                this.emitLine(
                    "value.",
                    fieldName,
                    " = jsonParser.readValueAs(new TypeReference<",
                    rendered,
                    ">() {});"
                );
                this.emitLine("break;");
            } else if (stringBasedObjects.some((stringBasedTypeKind) => t.kind === stringBasedTypeKind)) {
                emitDeserializerCodeForStringObjects(fieldName, t.kind, variableFieldName);
            } else if (t.kind === "string") {
                this.emitLine("value.", fieldName, " = ", variableFieldName, ";");
            } else if (t.kind === "enum") {
                const { fieldType } = this.unionField(u, t, true);
                this.emitLine("value.", fieldName, " = ", fieldType, ".forValue(", variableFieldName, ");");
            } else {
                this.emitLine("value.", fieldName, " = jsonParser.readValueAs(", rendered, ".class);");
                this.emitLine("break;");
            }
        };

        const emitDeserializer = (tokenTypes: string[], kind: TypeKind): void => {
            const t = u.findMember(kind);
            if (t === undefined) return;

            this.indent(() => {
                for (const tokenType of tokenTypes) {
                    tokenCase(tokenType);
                }
                this.indent(() => emitDeserializeType(t));
            });
        };

        // To deserialize string based objects we have use a custom string parser
        const emitStringDeserializer = () => {
            // string must be the last one, because it's the default behaviour
            const enumType = u.findMember("enum");
            const stringType = u.findMember("string");

            // If no string deserialization is required return
            if (
                stringBasedObjects.every((kind) => u.findMember(kind) === undefined) &&
                stringType === undefined &&
                enumType === undefined
            )
                return;

            this.indent(() => {
                tokenCase("VALUE_STRING");

                this.indent(() => {
                    const fromVariable = "string";
                    this.emitLine("String " + fromVariable + " = jsonParser.readValueAs(String.class);");

                    stringBasedObjects.forEach((kind) => {
                        const type = u.findMember(kind);
                        if (type !== undefined) {
                            this.emitIgnoredTryCatchBlock(() => {
                                emitDeserializeType(type, fromVariable);
                            });
                        }
                    });

                    if (enumType !== undefined) {
                        this.emitIgnoredTryCatchBlock(() => {
                            emitDeserializeType(enumType, fromVariable);
                        });
                    }

                    // String should be the last one if exists, because it cannot fail, unlike the parsers.
                    if (stringType !== undefined) {
                        emitDeserializeType(stringType, fromVariable);
                    }
                    this.emitLine("break;");
                });
            });
        };

        const emitNumberDeserializer = (): void => {
            const integerType = u.findMember("integer");
            const doubleType = u.findMember("double");
            if (doubleType === undefined && integerType === undefined) return;

            this.indent(() => {
                tokenCase("VALUE_NUMBER_INT");
                if (integerType !== undefined) {
                    this.indent(() => emitDeserializeType(integerType));
                }
                if (doubleType !== undefined) {
                    tokenCase("VALUE_NUMBER_FLOAT");
                    this.indent(() => emitDeserializeType(doubleType));
                }
            });
        };

        const customObjectSerializer: TypeKind[] = ["time", "date", "date-time"];

        const serializerCodeForType = (type: Type): string => {
            switch (type.kind) {
                case "date":
                    return ".format(DateTimeFormatter.ISO_DATE)";
                case "time":
                    return ".format(DateTimeFormatter.ISO_OFFSET_TIME)";
                case "date-time":
                    return ".format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)";
                default:
                    return panic("Requested type doesn't have custom serializer!");
            }
        };

        const emitSerializeType = (t: Type): void => {
            const { fieldName } = this.unionField(u, t, true);
            this.emitBlock(["if (obj.", fieldName, " != null)"], () => {
                if (customObjectSerializer.some((customSerializerType) => t.kind === customSerializerType)) {
                    this.emitLine("jsonGenerator.writeObject(obj.", fieldName, serializerCodeForType(t), ");");
                } else {
                    this.emitLine("jsonGenerator.writeObject(obj.", fieldName, ");");
                }
                this.emitLine("return;");
            });
        };

        const imports = [...this.importsForType(u), ...this.importsForUnionMembers(u)];

        this.emitFileHeader(unionName, imports);
        this.emitDescription(this.descriptionForType(u));
        if (!this._options.justTypes) {
            this.emitLine("@JsonDeserialize(using = ", unionName, ".Deserializer.class)");
            this.emitLine("@JsonSerialize(using = ", unionName, ".Serializer.class)");
        }
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        this.emitBlock(["public class ", unionName], () => {
            for (const t of nonNulls) {
                const { fieldType, fieldName } = this.unionField(u, t, true);
                this.emitLine("public ", fieldType, " ", fieldName, ";");
            }
            if (this._options.justTypes) return;
            this.ensureBlankLine();
            this.emitBlock(["static class Deserializer extends JsonDeserializer<", unionName, ">"], () => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public ",
                        unionName,
                        " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) throws IOException, JsonProcessingException",
                    ],
                    () => {
                        this.emitLine(unionName, " value = new ", unionName, "();");
                        this.emitLine("switch (jsonParser.currentToken()) {");
                        if (maybeNull !== null) emitNullDeserializer();
                        emitNumberDeserializer();
                        emitDeserializer(["VALUE_TRUE", "VALUE_FALSE"], "bool");
                        emitStringDeserializer();
                        emitDeserializer(["START_ARRAY"], "array");
                        emitDeserializer(["START_OBJECT"], "class");
                        emitDeserializer(["START_OBJECT"], "map");
                        this.indent(() =>
                            this.emitLine('default: throw new IOException("Cannot deserialize ', unionName, '");')
                        );
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
                        " obj, JsonGenerator jsonGenerator, SerializerProvider serializerProvider) throws IOException",
                    ],
                    () => {
                        for (const t of nonNulls) {
                            emitSerializeType(t);
                        }
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
        this.forEachEnumCase(e, "none", (name) => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        caseNames.push(";");
        this.emitBlock(["public enum ", enumName], () => {
            this.emitLine(caseNames);
            this.ensureBlankLine();

            if (!this._options.justTypes) {
                this.emitLine("@JsonValue");
            }
            this.emitBlock("public String toValue()", () => {
                this.emitLine("switch (this) {");
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ': return "', stringEscape(jsonName), '";');
                });
                this.emitLine("}");
                this.emitLine("return null;");
            });
            this.ensureBlankLine();

            if (!this._options.justTypes) {
                this.emitLine("@JsonCreator");
            }
            this.emitBlock(["public static ", enumName, " forValue(String value) throws IOException"], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine('if (value.equals("', stringEscape(jsonName), '")) return ', name, ";");
                });
                this.emitLine('throw new IOException("Cannot deserialize ', enumName, '");');
            });
        });
        this.finishFile();
    }

    protected emitOffsetDateTimeConverterAndRegister(): void {
        this.emitLine("SimpleModule module = new SimpleModule();");
        this.emitLine("module.addDeserializer(OffsetDateTime.class, new JsonDeserializer<OffsetDateTime>() {");
        this.indent(() => {
            this.emitLine("@Override");
            this.emitBlock(
                "public OffsetDateTime deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) throws IOException, JsonProcessingException",
                () => {
                    this.emitLine("String value = jsonParser.getText();");
                    this.emitTryCatch(
                        () => this.emitLine('return OffsetDateTime.parse(value.replace(" ", "T"));'),
                        () =>
                            this.emitLine(
                                'return LocalDateTime.parse(value.replace(" ", "T")).atOffset(ZoneOffset.UTC);'
                            )
                    );
                }
            );
        });
        this.emitLine("});");
        this.emitLine("mapper.registerModule(module);");
    }

    protected emitConverterClass(): void {
        this.startFile("Converter");
        this.emitCommentLines([
            "To use this code, add the following Maven dependency to your project:",
            "",
            this._options.lombok ? "    org.projectlombok : lombok : 1.18.2" : "",
            "    com.fasterxml.jackson.core     : jackson-databind          : 2.9.0",
            "    com.fasterxml.jackson.datatype : jackson-datatype-jsr310   : 2.9.0",
            "",
            "Import this package:",
            "",
        ]);
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
            "com.fasterxml.jackson.databind.module.SimpleModule", // If java 8
            "com.fasterxml.jackson.core.JsonParser", // If java 8
            "com.fasterxml.jackson.core.JsonProcessingException",
            "java.util.*",
            "java.time.LocalDateTime", // If java 8
            "java.time.OffsetDateTime", // If java 8
            "java.time.ZoneOffset", // If java 8
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
                        "(String json) throws IOException",
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
                        " obj) throws JsonProcessingException",
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
                        this.emitLine("mapper.findAndRegisterModules();");
                        this.emitLine("mapper.configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);");
                        this.emitOffsetDateTimeConverterAndRegister();
                        this.emitLine(readerName, " = mapper.readerFor(", renderedForClass, ".class);");
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
