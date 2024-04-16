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
    utf16LegalizeCharacters
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
            ["list", true]
        ],
        "array"
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    dateTimeProvider: new EnumOption(
        "datetime-provider",
        "Date time provider type",
        [
            ["java8", "java8"],
            ["legacy", "legacy"]
        ],
        "java8"
    ),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    // FIXME: Do this via a configurable named eventually.
    packageName: new StringOption("package", "Generated package name", "NAME", "io.quicktype"),
    lombok: new BooleanOption("lombok", "Use lombok", false, "primary"),
    lombokCopyAnnotations: new BooleanOption("lombok-copy-annotations", "Copy accessor annotations", true, "secondary")
};

export class JavaTargetLanguage<
    DisplayName extends string = "Java",
    Names extends readonly string[] = readonly ["java"],
    Extension extends string = "java"
> extends TargetLanguage<DisplayName, Names, Extension> {
    constructor(
        displayName = "Java" as DisplayName,
        names = ["java"] as unknown as Names,
        extension = "java" as Extension
    ) {
        super(displayName, names, extension);
    }

    protected getOptions(): Option<any>[] {
        return [
            javaOptions.useList,
            javaOptions.justTypes,
            javaOptions.dateTimeProvider,
            javaOptions.acronymStyle,
            javaOptions.packageName,
            javaOptions.lombok,
            javaOptions.lombokCopyAnnotations
        ];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): JavaRenderer {
        const options = getOptionValues(javaOptions, untypedOptionValues);
        if (options.justTypes) {
            return new JavaRenderer(this, renderContext, options);
        }
        return new JacksonRenderer(this, renderContext, options);
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

const javaKeywords = [
    "_", // as of release 9, '_' is a keyword, and may not be used as an identifier
    "Object",
    "Class",
    "System",
    "Long",
    "Double",
    "Boolean",
    "String",
    "List",
    "Map",
    "UUID",
    "Exception",
    "IOException",
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

abstract class JavaDateTimeProvider {
    constructor(
        protected readonly _renderer: JavaRenderer,
        protected readonly _className: string
    ) {}
    abstract keywords: string[];

    abstract dateTimeImports: string[];
    abstract dateImports: string[];
    abstract timeImports: string[];
    abstract converterImports: string[];

    abstract dateTimeType: string;
    abstract dateType: string;
    abstract timeType: string;

    abstract dateTimeJacksonAnnotations: string[];
    abstract dateJacksonAnnotations: string[];
    abstract timeJacksonAnnotations: string[];

    abstract emitDateTimeConverters(): void;

    public shouldEmitDateTimeConverter = true;
    public shouldEmitTimeConverter = true;
    public shouldEmitDateConverter = true;

    abstract convertStringToDateTime(variable: Sourcelike): Sourcelike;
    abstract convertStringToTime(variable: Sourcelike): Sourcelike;
    abstract convertStringToDate(variable: Sourcelike): Sourcelike;

    abstract convertDateTimeToString(variable: Sourcelike): Sourcelike;
    abstract convertTimeToString(variable: Sourcelike): Sourcelike;
    abstract convertDateToString(variable: Sourcelike): Sourcelike;
}

class Java8DateTimeProvider extends JavaDateTimeProvider {
    keywords = [
        "LocalDate",
        "OffsetDateTime",
        "OffsetTime",
        "ZoneOffset",
        "ZonedDateTime",
        "DateTimeFormatter",
        "DateTimeFormatterBuilder",
        "ChronoField"
    ];

    dateTimeImports: string[] = ["java.time.OffsetDateTime"];
    dateImports: string[] = ["java.time.LocalDate"];
    timeImports: string[] = ["java.time.OffsetTime"];
    converterImports: string[] = [
        "java.time.LocalDate",
        "java.time.OffsetDateTime",
        "java.time.OffsetTime",
        "java.time.ZoneOffset",
        "java.time.ZonedDateTime",
        "java.time.format.DateTimeFormatter",
        "java.time.format.DateTimeFormatterBuilder",
        "java.time.temporal.ChronoField"
    ];

    dateTimeType = "OffsetDateTime";
    dateType = "LocalDate";
    timeType = "OffsetTime";

    dateTimeJacksonAnnotations: string[] = [];
    dateJacksonAnnotations: string[] = [];
    timeJacksonAnnotations: string[] = [];

    emitDateTimeConverters(): void {
        this._renderer.ensureBlankLine();
        this._renderer.emitLine(
            "private static final DateTimeFormatter DATE_TIME_FORMATTER = new DateTimeFormatterBuilder()"
        );
        this._renderer.indent(() =>
            this._renderer.indent(() => {
                this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_DATE_TIME)");
                this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_OFFSET_DATE_TIME)");
                this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_INSTANT)");
                this._renderer.emitLine('.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SX"))');
                this._renderer.emitLine('.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ssX"))');
                this._renderer.emitLine('.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))');
                this._renderer.emitLine(".toFormatter()");
                this._renderer.emitLine(".withZone(ZoneOffset.UTC);");
            })
        );
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static OffsetDateTime parseDateTimeString(String str)", () => {
            this._renderer.emitLine(
                "return ZonedDateTime.from(Converter.DATE_TIME_FORMATTER.parse(str)).toOffsetDateTime();"
            );
        });

        this._renderer.ensureBlankLine();
        this._renderer.emitLine(
            "private static final DateTimeFormatter TIME_FORMATTER = new DateTimeFormatterBuilder()"
        );
        this._renderer.indent(() =>
            this._renderer.indent(() => {
                this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_TIME)");
                this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_OFFSET_TIME)");
                this._renderer.emitLine(".parseDefaulting(ChronoField.YEAR, 2020)");
                this._renderer.emitLine(".parseDefaulting(ChronoField.MONTH_OF_YEAR, 1)");
                this._renderer.emitLine(".parseDefaulting(ChronoField.DAY_OF_MONTH, 1)");
                this._renderer.emitLine(".toFormatter()");
                this._renderer.emitLine(".withZone(ZoneOffset.UTC);");
            })
        );
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static OffsetTime parseTimeString(String str)", () => {
            this._renderer.emitLine(
                "return ZonedDateTime.from(Converter.TIME_FORMATTER.parse(str)).toOffsetDateTime().toOffsetTime();"
            );
        });
    }

    convertStringToDateTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseDateTimeString(", variable, ")"];
    }

    convertStringToTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseTimeString(", variable, ")"];
    }

    convertStringToDate(variable: Sourcelike): Sourcelike {
        return ["LocalDate.parse(", variable, ")"];
    }

    convertDateTimeToString(variable: Sourcelike): Sourcelike {
        return [variable, ".format(java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME)"];
    }

    convertTimeToString(variable: Sourcelike): Sourcelike {
        return [variable, ".format(java.time.format.DateTimeFormatter.ISO_OFFSET_TIME)"];
    }

    convertDateToString(variable: Sourcelike): Sourcelike {
        return [variable, ".format(java.time.format.DateTimeFormatter.ISO_DATE)"];
    }
}

class JavaLegacyDateTimeProvider extends JavaDateTimeProvider {
    keywords = ["SimpleDateFormat", "Date"];

    dateTimeImports: string[] = ["java.util.Date"];
    dateImports: string[] = ["java.util.Date"];
    timeImports: string[] = ["java.util.Date"];
    converterImports: string[] = ["java.util.Date", "java.text.SimpleDateFormat"];

    dateTimeType = "Date";
    dateType = "Date";
    timeType = "Date";

    dateTimeJacksonAnnotations: string[] = ['@JsonFormat(pattern = "yyyy-MM-dd\'T\'HH:mm:ssX", timezone = "UTC")'];
    dateJacksonAnnotations: string[] = ['@JsonFormat(pattern = "yyyy-MM-dd")'];
    timeJacksonAnnotations: string[] = ['@JsonFormat(pattern = "HH:mm:ssX", timezone = "UTC")'];

    emitDateTimeConverters(): void {
        this._renderer.ensureBlankLine();
        this._renderer.emitLine("private static final String[] DATE_TIME_FORMATS = {");
        this._renderer.indent(() =>
            this._renderer.indent(() => {
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ss.SX\",");
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ss.S\",");
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ssX\",");
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ss\",");
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss.SX",');
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss.S",');
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ssX",');
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss",');
                this._renderer.emitLine('"HH:mm:ss.SZ",');
                this._renderer.emitLine('"HH:mm:ss.S",');
                this._renderer.emitLine('"HH:mm:ssZ",');
                this._renderer.emitLine('"HH:mm:ss",');
                this._renderer.emitLine('"yyyy-MM-dd",');
            })
        );
        this._renderer.emitLine("};");
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static Date parseAllDateTimeString(String str)", () => {
            this._renderer.emitBlock("for (String format : DATE_TIME_FORMATS)", () => {
                this._renderer.emitIgnoredTryCatchBlock(() => {
                    this._renderer.emitLine("return new SimpleDateFormat(format).parse(str);");
                });
            });
            this._renderer.emitLine("return null;");
        });

        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static String serializeDateTime(Date datetime)", () => {
            this._renderer.emitLine("return new SimpleDateFormat(\"yyyy-MM-dd'T'hh:mm:ssZ\").format(datetime);");
        });

        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static String serializeDate(Date datetime)", () => {
            this._renderer.emitLine('return new SimpleDateFormat("yyyy-MM-dd").format(datetime);');
        });

        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static String serializeTime(Date datetime)", () => {
            this._renderer.emitLine('return new SimpleDateFormat("hh:mm:ssZ").format(datetime);');
        });
    }

    shouldEmitTimeConverter = false;
    shouldEmitDateConverter = false;

    convertStringToDateTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }

    convertStringToTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }

    convertStringToDate(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }

    convertDateTimeToString(variable: Sourcelike): Sourcelike {
        return [this._className, ".serializeDateTime(", variable, ")"];
    }

    convertTimeToString(variable: Sourcelike): Sourcelike {
        return [this._className, ".serializeTime(", variable, ")"];
    }

    convertDateToString(variable: Sourcelike): Sourcelike {
        return [this._className, ".serializeDate(", variable, ")"];
    }
}

export class JavaRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name]>();
    private _haveEmittedLeadingComments = false;
    protected readonly _dateTimeProvider: JavaDateTimeProvider;
    protected readonly _converterClassname: string = "Converter";
    protected readonly _converterKeywords: string[] = [];

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _options: OptionValues<typeof javaOptions>
    ) {
        super(targetLanguage, renderContext);

        switch (_options.dateTimeProvider) {
            default:
            case "java8":
                this._dateTimeProvider = new Java8DateTimeProvider(this, this._converterClassname);
                break;
            case "legacy":
                this._dateTimeProvider = new JavaLegacyDateTimeProvider(this, this._converterClassname);
                break;
        }
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        const keywords = [
            ...javaKeywords,
            ...this._converterKeywords,
            this._converterClassname,
            ...this._dateTimeProvider.keywords
        ];
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
            lookup => `get_${lookup(name)}`
        );
        const setterName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `set_${lookup(name)}`
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
            typeNamingFunction: funPrefixNamer("types", n =>
                javaNameStyle(true, false, n, acronymStyle(this._options.acronymStyle))
            ),
            propertyNamingFunction: funPrefixNamer("properties", n =>
                javaNameStyle(false, false, n, acronymStyle(this._options.acronymStyle))
            ),
            enumCaseNamingFunction: funPrefixNamer("enum-cases", n =>
                javaNameStyle(true, true, n, acronymStyle(this._options.acronymStyle))
            )
        };
        return styling[convention];
    }

    protected fieldOrMethodName(methodName: string, topLevelName: Name): Sourcelike {
        if (this.topLevels.size === 1) {
            return methodName;
        }
        return [topLevelName, capitalize(methodName)];
    }

    protected methodName(prefix: string, suffix: string, topLevelName: Name): Sourcelike {
        if (this.topLevels.size === 1) {
            return [prefix, suffix];
        }
        return [prefix, topLevelName, suffix];
    }

    protected decoderName(topLevelName: Name): Sourcelike {
        return this.fieldOrMethodName("fromJsonString", topLevelName);
    }

    protected encoderName(topLevelName: Name): Sourcelike {
        return this.fieldOrMethodName("toJsonString", topLevelName);
    }

    protected readerGetterName(topLevelName: Name): Sourcelike {
        return this.methodName("get", "ObjectReader", topLevelName);
    }

    protected writerGetterName(topLevelName: Name): Sourcelike {
        return this.methodName("get", "ObjectWriter", topLevelName);
    }

    protected startFile(basename: Sourcelike): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.java`;
        // FIXME: Why is this necessary?
        this.ensureBlankLine();
        if (!this._haveEmittedLeadingComments && this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
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

    public emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, { lineStart: " * ", beforeComment: "/**", afterComment: " */" });
    }

    public emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    public emitTryCatch(main: () => void, handler: () => void, exception = "Exception") {
        this.emitLine("try {");
        this.indent(main);
        this.emitLine("} catch (", exception, " ex) {");
        this.indent(handler);
        this.emitLine("}");
    }

    public emitIgnoredTryCatchBlock(f: () => void) {
        this.emitTryCatch(f, () => this.emitLine("// Ignored"));
    }

    protected javaType(reference: boolean, t: Type, withIssues = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Object"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Object"),
            _boolType => (reference ? "Boolean" : "boolean"),
            _integerType => (reference ? "Long" : "long"),
            _doubleType => (reference ? "Double" : "double"),
            _stringType => "String",
            arrayType => {
                if (this._options.useList) {
                    return ["List<", this.javaType(true, arrayType.items, withIssues), ">"];
                } else {
                    return [this.javaType(false, arrayType.items, withIssues), "[]"];
                }
            },
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.javaType(true, mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.javaType(true, nullable, withIssues);
                return this.nameForNamedType(unionType);
            },
            transformedStringType => {
                if (transformedStringType.kind === "time") {
                    return this._dateTimeProvider.timeType;
                }
                if (transformedStringType.kind === "date") {
                    return this._dateTimeProvider.dateType;
                }
                if (transformedStringType.kind === "date-time") {
                    return this._dateTimeProvider.dateTimeType;
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
            _anyType => [],
            _nullType => [],
            _boolType => [],
            _integerType => [],
            _doubleType => [],
            _stringType => [],
            arrayType => {
                if (this._options.useList) {
                    return [...this.javaImport(arrayType.items), "java.util.List"];
                } else {
                    return [...this.javaImport(arrayType.items)];
                }
            },
            _classType => [],
            mapType => [...this.javaImport(mapType.values), "java.util.Map"],
            _enumType => [],
            unionType => {
                const imports: string[] = [];
                unionType.members.forEach(type => this.javaImport(type).forEach(imp => imports.push(imp)));
                return imports;
            },
            transformedStringType => {
                if (transformedStringType.kind === "time") {
                    return this._dateTimeProvider.timeImports;
                }
                if (transformedStringType.kind === "date") {
                    return this._dateTimeProvider.dateImports;
                }
                if (transformedStringType.kind === "date-time") {
                    return this._dateTimeProvider.dateTimeImports;
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
                return ["List"];
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

    protected emitClassAttributes(_c: ClassType, _className: Name): void {
        if (this._options.lombok) {
            this.emitLine("@lombok.Data");
        }
    }

    protected annotationsForAccessor(
        _c: ClassType,
        _className: Name,
        _propertyName: Name,
        _jsonName: string,
        _p: ClassProperty,
        _isSetter: boolean
    ): string[] {
        return [];
    }

    protected importsForType(t: ClassType | UnionType | EnumType): string[] {
        if (t instanceof ClassType) {
            return [];
        }
        if (t instanceof UnionType) {
            return ["java.io.IOException"];
        }
        if (t instanceof EnumType) {
            return ["java.io.IOException"];
        }
        return assertNever(t);
    }

    protected importsForClass(c: ClassType): string[] {
        const imports: string[] = [];
        this.forEachClassProperty(c, "none", (_name, _jsonName, p) => {
            this.javaImport(p.type).forEach(imp => imports.push(imp));
        });
        imports.sort();
        return [...new Set(imports)];
    }

    protected importsForUnionMembers(u: UnionType): string[] {
        const imports: string[] = [];
        const [, nonNulls] = removeNullFromUnion(u);
        this.forEachUnionMember(u, nonNulls, "none", null, (_fieldName, t) => {
            this.javaImport(t).forEach(imp => imports.push(imp));
        });
        imports.sort();
        return [...new Set(imports)];
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        let imports = [...this.importsForType(c), ...this.importsForClass(c)];

        this.emitFileHeader(className, imports);
        this.emitDescription(this.descriptionForType(c));
        this.emitClassAttributes(c, className);
        this.emitBlock(["public class ", className], () => {
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                if (this._options.lombok && this._options.lombokCopyAnnotations) {
                    const getter = this.annotationsForAccessor(c, className, name, jsonName, p, false);
                    const setter = this.annotationsForAccessor(c, className, name, jsonName, p, true);
                    if (getter.length !== 0) {
                        this.emitLine("@lombok.Getter(onMethod_ = {" + getter.join(", ") + "})");
                    }
                    if (setter.length !== 0) {
                        this.emitLine("@lombok.Setter(onMethod_ = {" + setter.join(", ") + "})");
                    }
                }
                this.emitLine("private ", this.javaType(false, p.type, true), " ", name, ";");
            });
            if (!this._options.lombok) {
                this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, p) => {
                    this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                    const [getterName, setterName] = defined(this._gettersAndSettersForPropertyName.get(name));
                    const rendered = this.javaType(false, p.type);
                    this.annotationsForAccessor(c, className, name, jsonName, p, false).forEach(annotation =>
                        this.emitLine(annotation)
                    );
                    this.emitLine("public ", rendered, " ", getterName, "() { return ", name, "; }");
                    this.annotationsForAccessor(c, className, name, jsonName, p, true).forEach(annotation =>
                        this.emitLine(annotation)
                    );
                    this.emitLine("public void ", setterName, "(", rendered, " value) { this.", name, " = value; }");
                });
            }
        });
        this.finishFile();
    }

    protected unionField(u: UnionType, t: Type, withIssues = false): { fieldType: Sourcelike; fieldName: Sourcelike } {
        const fieldType = this.javaType(true, t, withIssues);
        // FIXME: "Value" should be part of the name.
        const fieldName = [this.nameForUnionMember(u, t), "Value"];
        return { fieldType, fieldName };
    }

    protected emitUnionAttributes(_u: UnionType, _unionName: Name): void {
        // empty
    }

    protected emitUnionSerializer(_u: UnionType, _unionName: Name): void {
        // empty
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        const imports = [...this.importsForType(u), ...this.importsForUnionMembers(u)];

        this.emitFileHeader(unionName, imports);
        this.emitDescription(this.descriptionForType(u));
        const [, nonNulls] = removeNullFromUnion(u);

        this.emitUnionAttributes(u, unionName);
        this.emitBlock(["public class ", unionName], () => {
            for (const t of nonNulls) {
                const { fieldType, fieldName } = this.unionField(u, t, true);
                this.emitLine("public ", fieldType, " ", fieldName, ";");
            }
            this.emitUnionSerializer(u, unionName);
        });
        this.finishFile();
    }

    protected emitEnumSerializationAttributes(_e: EnumType) {
        // Empty
    }

    protected emitEnumDeserializationAttributes(_e: EnumType) {
        // Empty
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

            this.emitEnumSerializationAttributes(e);
            this.emitBlock("public String toValue()", () => {
                this.emitLine("switch (this) {");
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        this.emitLine("case ", name, ': return "', stringEscape(jsonName), '";');
                    });
                });
                this.emitLine("}");
                this.emitLine("return null;");
            });
            this.ensureBlankLine();

            this.emitEnumDeserializationAttributes(e);
            this.emitBlock(["public static ", enumName, " forValue(String value) throws IOException"], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine('if (value.equals("', stringEscape(jsonName), '")) return ', name, ";");
                });
                this.emitLine('throw new IOException("Cannot deserialize ', enumName, '");');
            });
        });
        this.finishFile();
    }

    protected emitSourceStructure(): void {
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n)
        );
    }
}

export class JacksonRenderer extends JavaRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        options: OptionValues<typeof javaOptions>
    ) {
        super(targetLanguage, renderContext, options);
    }

    protected readonly _converterKeywords: string[] = [
        "JsonProperty",
        "JsonDeserialize",
        "JsonDeserializer",
        "JsonSerialize",
        "JsonSerializer",
        "JsonParser",
        "JsonProcessingException",
        "DeserializationContext",
        "SerializerProvider"
    ];

    protected emitClassAttributes(c: ClassType, _className: Name): void {
        if (c.getProperties().size === 0)
            this.emitLine("@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE)");

        super.emitClassAttributes(c, _className);
    }

    protected annotationsForAccessor(
        _c: ClassType,
        _className: Name,
        _propertyName: Name,
        jsonName: string,
        p: ClassProperty,
        _isSetter: boolean
    ): string[] {
        const superAnnotations = super.annotationsForAccessor(_c, _className, _propertyName, jsonName, p, _isSetter);

        const annotations: string[] = ['@JsonProperty("' + stringEscape(jsonName) + '")'];

        switch (p.type.kind) {
            case "date-time":
                this._dateTimeProvider.dateTimeJacksonAnnotations.forEach(annotation => annotations.push(annotation));
                break;
            case "date":
                this._dateTimeProvider.dateJacksonAnnotations.forEach(annotation => annotations.push(annotation));
                break;
            case "time":
                this._dateTimeProvider.timeJacksonAnnotations.forEach(annotation => annotations.push(annotation));
                break;
            default:
                break;
        }

        return [...superAnnotations, ...annotations];
    }

    protected importsForType(t: ClassType | UnionType | EnumType): string[] {
        if (t instanceof ClassType) {
            const imports = super.importsForType(t);
            imports.push("com.fasterxml.jackson.annotation.*");
            return imports;
        }
        if (t instanceof UnionType) {
            const imports = super.importsForType(t);
            imports.push(
                "java.io.IOException",
                "com.fasterxml.jackson.core.*",
                "com.fasterxml.jackson.databind.*",
                "com.fasterxml.jackson.databind.annotation.*"
            );
            if (this._options.useList) {
                imports.push("com.fasterxml.jackson.core.type.*");
            }
            return imports;
        }
        if (t instanceof EnumType) {
            const imports = super.importsForType(t);
            imports.push("com.fasterxml.jackson.annotation.*");
            return imports;
        }
        return assertNever(t);
    }

    protected emitUnionAttributes(_u: UnionType, unionName: Name): void {
        this.emitLine("@JsonDeserialize(using = ", unionName, ".Deserializer.class)");
        this.emitLine("@JsonSerialize(using = ", unionName, ".Serializer.class)");
    }

    protected emitUnionSerializer(u: UnionType, unionName: Name): void {
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
                    this.emitLine(
                        "value.",
                        fieldName,
                        " = ",
                        this._dateTimeProvider.convertStringToDate(parseFrom),
                        ";"
                    );

                    break;
                case "time":
                    this.emitLine(
                        "value.",
                        fieldName,
                        " = ",
                        this._dateTimeProvider.convertStringToTime(parseFrom),
                        ";"
                    );

                    break;
                case "date-time":
                    this.emitLine(
                        "value.",
                        fieldName,
                        " = ",
                        this._dateTimeProvider.convertStringToDateTime(parseFrom),
                        ";"
                    );
                    break;
                case "uuid":
                    this.emitLine("value.", fieldName, " = UUID.fromString(", parseFrom, ");");

                    break;
                default:
                    return panic("Requested type isnt an object!");
            }
        };

        const emitDeserializeType = (t: Type, variableFieldName = ""): void => {
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
            } else if (stringBasedObjects.some(stringBasedTypeKind => t.kind === stringBasedTypeKind)) {
                emitDeserializerCodeForStringObjects(fieldName, t.kind, variableFieldName);
            } else if (t.kind === "string") {
                this.emitLine("value.", fieldName, " = ", variableFieldName, ";");
            } else if (t.kind === "enum") {
                const { fieldType } = this.unionField(u, t, true);
                this.emitLine("value.", fieldName, " = ", fieldType, ".forValue(", variableFieldName, ");");
            } else {
                this.emitLine("value.", fieldName, " = jsonParser.readValueAs(", rendered, ".class);");
            }
        };

        const emitDeserializer = (tokenTypes: string[], kind: TypeKind): void => {
            const t = u.findMember(kind);
            if (t === undefined) return;

            this.indent(() => {
                for (const tokenType of tokenTypes) {
                    tokenCase(tokenType);
                }
                this.indent(() => {
                    emitDeserializeType(t);
                    this.emitLine("break;");
                });
            });
        };

        const emitStringDeserializer = () => {
            const enumType = u.findMember("enum");
            const stringType = u.findMember("string");

            if (
                stringBasedObjects.every(kind => u.findMember(kind) === undefined) &&
                stringType === undefined &&
                enumType === undefined
            )
                return;

            this.indent(() => {
                tokenCase("VALUE_STRING");

                this.indent(() => {
                    const fromVariable = "string";
                    this.emitLine("String " + fromVariable + " = jsonParser.readValueAs(String.class);");

                    stringBasedObjects.forEach(kind => {
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
                    this.indent(() => {
                        emitDeserializeType(integerType);
                        this.emitLine("break;");
                    });
                }
                if (doubleType !== undefined) {
                    tokenCase("VALUE_NUMBER_FLOAT");
                    this.indent(() => {
                        emitDeserializeType(doubleType);
                        this.emitLine("break;");
                    });
                }
            });
        };

        const customObjectSerializer: TypeKind[] = ["time", "date", "date-time"];

        const serializerCodeForType = (type: Type, fieldName: Sourcelike): Sourcelike => {
            switch (type.kind) {
                case "date":
                    return this._dateTimeProvider.convertDateToString(fieldName);
                case "time":
                    return this._dateTimeProvider.convertTimeToString(fieldName);
                case "date-time":
                    return this._dateTimeProvider.convertDateTimeToString(fieldName);
                default:
                    return panic("Requested type doesn't have custom serializer code!");
            }
        };

        const emitSerializeType = (t: Type): void => {
            let { fieldName } = this.unionField(u, t, true);

            this.emitBlock(["if (obj.", fieldName, " != null)"], () => {
                if (customObjectSerializer.some(customSerializerType => t.kind === customSerializerType)) {
                    this.emitLine("jsonGenerator.writeObject(", serializerCodeForType(t, ["obj.", fieldName]), ");");
                } else {
                    this.emitLine("jsonGenerator.writeObject(obj.", fieldName, ");");
                }
                this.emitLine("return;");
            });
        };

        const [maybeNull, nonNulls] = removeNullFromUnion(u);

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
                    " obj, JsonGenerator jsonGenerator, SerializerProvider serializerProvider) throws IOException"
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
    }

    protected emitEnumSerializationAttributes(_e: EnumType) {
        this.emitLine("@JsonValue");
    }

    protected emitEnumDeserializationAttributes(_e: EnumType) {
        this.emitLine("@JsonCreator");
    }

    protected emitOffsetDateTimeConverterModule(): void {
        this.emitLine("SimpleModule module = new SimpleModule();");

        if (this._dateTimeProvider.shouldEmitDateTimeConverter) {
            this.emitLine(
                "module.addDeserializer(",
                this._dateTimeProvider.dateTimeType,
                ".class, new JsonDeserializer<",
                this._dateTimeProvider.dateTimeType,
                ">() {"
            );
            this.indent(() => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public ",
                        this._dateTimeProvider.dateTimeType,
                        " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
                        "throws IOException, JsonProcessingException"
                    ],
                    () => {
                        this.emitLine("String value = jsonParser.getText();");
                        this.emitLine("return ", this._dateTimeProvider.convertStringToDateTime("value"), ";");
                    }
                );
            });
            this.emitLine("});");
        }

        if (!this._dateTimeProvider.shouldEmitTimeConverter) {
            this.emitLine(
                "module.addDeserializer(",
                this._dateTimeProvider.timeType,
                ".class, new JsonDeserializer<",
                this._dateTimeProvider.timeType,
                ">() {"
            );
            this.indent(() => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public ",
                        this._dateTimeProvider.timeType,
                        " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
                        "throws IOException, JsonProcessingException"
                    ],
                    () => {
                        this.emitLine("String value = jsonParser.getText();");
                        this.emitLine("return ", this._dateTimeProvider.convertStringToTime("value"), ";");
                    }
                );
            });
            this.emitLine("});");
        }

        if (!this._dateTimeProvider.shouldEmitDateConverter) {
            this.emitLine(
                "module.addDeserializer(",
                this._dateTimeProvider.dateType,
                ".class, new JsonDeserializer<",
                this._dateTimeProvider.dateType,
                ">() {"
            );
            this.indent(() => {
                this.emitLine("@Override");
                this.emitBlock(
                    [
                        "public ",
                        this._dateTimeProvider.dateType,
                        " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
                        "throws IOException, JsonProcessingException"
                    ],
                    () => {
                        this.emitLine("String value = jsonParser.getText();");
                        this.emitLine("return ", this._dateTimeProvider.convertStringToDate("value"), ";");
                    }
                );
            });
            this.emitLine("});");
        }

        this.emitLine("mapper.registerModule(module);");
    }

    protected emitConverterClass(): void {
        this.startFile(this._converterClassname);
        this.emitCommentLines([
            "To use this code, add the following Maven dependency to your project:",
            "",
            this._options.lombok ? "    org.projectlombok : lombok : 1.18.2" : "",
            "    com.fasterxml.jackson.core     : jackson-databind          : 2.9.0",
            this._options.dateTimeProvider === "java8"
                ? "    com.fasterxml.jackson.datatype : jackson-datatype-jsr310   : 2.9.0"
                : "",
            "",
            "Import this package:",
            ""
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
        const imports = [
            "java.io.IOException",
            "com.fasterxml.jackson.databind.*",
            "com.fasterxml.jackson.databind.module.SimpleModule",
            "com.fasterxml.jackson.core.JsonParser",
            "com.fasterxml.jackson.core.JsonProcessingException",
            "java.util.*"
        ].concat(this._dateTimeProvider.converterImports);
        this.emitPackageAndImports(imports);
        this.ensureBlankLine();
        this.emitBlock(["public class Converter"], () => {
            this.emitLine("// Date-time helpers");
            this._dateTimeProvider.emitDateTimeConverters();

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
                        this.emitLine("mapper.findAndRegisterModules();");
                        this.emitLine("mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);");
                        this.emitLine("mapper.configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);");
                        this.emitOffsetDateTimeConverterModule();
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
        this.emitConverterClass();
        super.emitSourceStructure();
    }
}
