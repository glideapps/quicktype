"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Annotation_1 = require("../Annotation");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Naming_1 = require("../Naming");
const RendererOptions_1 = require("../RendererOptions");
const Source_1 = require("../Source");
const Acronyms_1 = require("../support/Acronyms");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const TargetLanguage_1 = require("../TargetLanguage");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
exports.javaOptions = {
    useList: new RendererOptions_1.EnumOption("array-type", "Use T[] or List<T>", [
        ["array", false],
        ["list", true],
    ], "array"),
    justTypes: new RendererOptions_1.BooleanOption("just-types", "Plain types only", false),
    dateTimeProvider: new RendererOptions_1.EnumOption("datetime-provider", "Date time provider type", [
        ["java8", "java8"],
        ["legacy", "legacy"]
    ], "java8"),
    acronymStyle: Acronyms_1.acronymOption(Acronyms_1.AcronymStyleOptions.Pascal),
    // FIXME: Do this via a configurable named eventually.
    packageName: new RendererOptions_1.StringOption("package", "Generated package name", "NAME", "io.quicktype"),
    lombok: new RendererOptions_1.BooleanOption("lombok", "Use lombok", false, "primary"),
    lombokCopyAnnotations: new RendererOptions_1.BooleanOption("lombok-copy-annotations", "Copy accessor annotations", true, "secondary"),
};
class JavaTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Java", ["java"], "java");
    }
    getOptions() {
        return [
            exports.javaOptions.useList,
            exports.javaOptions.justTypes,
            exports.javaOptions.dateTimeProvider,
            exports.javaOptions.acronymStyle,
            exports.javaOptions.packageName,
            exports.javaOptions.lombok,
            exports.javaOptions.lombokCopyAnnotations,
        ];
    }
    get supportsUnionsWithBothNumberTypes() {
        return true;
    }
    makeRenderer(renderContext, untypedOptionValues) {
        const options = RendererOptions_1.getOptionValues(exports.javaOptions, untypedOptionValues);
        if (options.justTypes) {
            return new JavaRenderer(this, renderContext, options);
        }
        return new JacksonRenderer(this, renderContext, options);
    }
    get stringTypeMapping() {
        const mapping = new Map();
        mapping.set("date", "date");
        mapping.set("time", "time");
        mapping.set("date-time", "date-time");
        mapping.set("uuid", "uuid");
        return mapping;
    }
}
exports.JavaTargetLanguage = JavaTargetLanguage;
const javaKeywords = [
    "Object",
    "Class",
    "System",
    "Long",
    "Double",
    "Boolean",
    "String",
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
    "true",
];
exports.stringEscape = Strings_1.utf16ConcatMap(Strings_1.escapeNonPrintableMapper(Strings_1.isAscii, Strings_1.standardUnicodeHexEscape));
function isStartCharacter(codePoint) {
    if (codePoint === 0x5f)
        return true; // underscore
    return Strings_1.isAscii(codePoint) && Strings_1.isLetter(codePoint);
}
function isPartCharacter(codePoint) {
    return isStartCharacter(codePoint) || (Strings_1.isAscii(codePoint) && Strings_1.isDigit(codePoint));
}
const legalizeName = Strings_1.utf16LegalizeCharacters(isPartCharacter);
function javaNameStyle(startWithUpper, upperUnderscore, original, acronymsStyle = Strings_1.allUpperWordStyle) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, upperUnderscore ? Strings_1.allUpperWordStyle : startWithUpper ? Strings_1.firstUpperWordStyle : Strings_1.allLowerWordStyle, upperUnderscore ? Strings_1.allUpperWordStyle : Strings_1.firstUpperWordStyle, upperUnderscore || startWithUpper ? Strings_1.allUpperWordStyle : Strings_1.allLowerWordStyle, acronymsStyle, upperUnderscore ? "_" : "", isStartCharacter);
}
exports.javaNameStyle = javaNameStyle;
class JavaDateTimeProvider {
    constructor(_renderer, _className) {
        this._renderer = _renderer;
        this._className = _className;
        this.shouldEmitDateTimeConverter = true;
        this.shouldEmitTimeConverter = true;
        this.shouldEmitDateConverter = true;
    }
}
class Java8DateTimeProvider extends JavaDateTimeProvider {
    constructor() {
        super(...arguments);
        this.keywords = [
            "LocalDate",
            "OffsetDateTime",
            "OffsetTime",
            "ZoneOffset",
            "ZonedDateTime",
            "DateTimeFormatter",
            "DateTimeFormatterBuilder",
            "ChronoField"
        ];
        this.dateTimeImports = ["java.time.OffsetDateTime"];
        this.dateImports = ["java.time.LocalDate"];
        this.timeImports = ["java.time.OffsetTime"];
        this.converterImports = [
            "java.time.LocalDate",
            "java.time.OffsetDateTime",
            "java.time.OffsetTime",
            "java.time.ZoneOffset",
            "java.time.ZonedDateTime",
            "java.time.format.DateTimeFormatter",
            "java.time.format.DateTimeFormatterBuilder",
            "java.time.temporal.ChronoField"
        ];
        this.dateTimeType = "OffsetDateTime";
        this.dateType = "LocalDate";
        this.timeType = "OffsetTime";
        this.dateTimeJacksonAnnotations = [];
        this.dateJacksonAnnotations = [];
        this.timeJacksonAnnotations = [];
    }
    emitDateTimeConverters() {
        this._renderer.ensureBlankLine();
        this._renderer.emitLine("private static final DateTimeFormatter DATE_TIME_FORMATTER = new DateTimeFormatterBuilder()");
        this._renderer.indent(() => this._renderer.indent(() => {
            this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_DATE_TIME)");
            this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_OFFSET_DATE_TIME)");
            this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_INSTANT)");
            this._renderer.emitLine('.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SX"))');
            this._renderer.emitLine('.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ssX"))');
            this._renderer.emitLine('.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))');
            this._renderer.emitLine(".toFormatter()");
            this._renderer.emitLine(".withZone(ZoneOffset.UTC);");
        }));
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static OffsetDateTime parseDateTimeString(String str)", () => {
            this._renderer.emitLine("return ZonedDateTime.from(Converter.DATE_TIME_FORMATTER.parse(str)).toOffsetDateTime();");
        });
        this._renderer.ensureBlankLine();
        this._renderer.emitLine("private static final DateTimeFormatter TIME_FORMATTER = new DateTimeFormatterBuilder()");
        this._renderer.indent(() => this._renderer.indent(() => {
            this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_TIME)");
            this._renderer.emitLine(".appendOptional(DateTimeFormatter.ISO_OFFSET_TIME)");
            this._renderer.emitLine(".parseDefaulting(ChronoField.YEAR, 2020)");
            this._renderer.emitLine(".parseDefaulting(ChronoField.MONTH_OF_YEAR, 1)");
            this._renderer.emitLine(".parseDefaulting(ChronoField.DAY_OF_MONTH, 1)");
            this._renderer.emitLine(".toFormatter()");
            this._renderer.emitLine(".withZone(ZoneOffset.UTC);");
        }));
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock("public static OffsetTime parseTimeString(String str)", () => {
            this._renderer.emitLine("return ZonedDateTime.from(Converter.TIME_FORMATTER.parse(str)).toOffsetDateTime().toOffsetTime();");
        });
    }
    convertStringToDateTime(variable) {
        return [this._className, ".parseDateTimeString(", variable, ")"];
    }
    convertStringToTime(variable) {
        return [this._className, ".parseTimeString(", variable, ")"];
    }
    convertStringToDate(variable) {
        return ["LocalDate.parse(", variable, ")"];
    }
    convertDateTimeToString(variable) {
        return [variable, ".format(java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME)"];
    }
    convertTimeToString(variable) {
        return [variable, ".format(java.time.format.DateTimeFormatter.ISO_OFFSET_TIME)"];
    }
    convertDateToString(variable) {
        return [variable, ".format(java.time.format.DateTimeFormatter.ISO_DATE)"];
    }
}
class JavaLegacyDateTimeProvider extends JavaDateTimeProvider {
    constructor() {
        super(...arguments);
        this.keywords = [
            "SimpleDateFormat",
            "Date",
        ];
        this.dateTimeImports = ["java.util.Date"];
        this.dateImports = ["java.util.Date"];
        this.timeImports = ["java.util.Date"];
        this.converterImports = [
            "java.util.Date",
            "java.text.SimpleDateFormat",
        ];
        this.dateTimeType = "Date";
        this.dateType = "Date";
        this.timeType = "Date";
        this.dateTimeJacksonAnnotations = ['@JsonFormat(pattern = "yyyy-MM-dd\'T\'HH:mm:ssX", timezone = "UTC")'];
        this.dateJacksonAnnotations = ['@JsonFormat(pattern = "yyyy-MM-dd")'];
        this.timeJacksonAnnotations = ['@JsonFormat(pattern = "HH:mm:ssX", timezone = "UTC")'];
        this.shouldEmitTimeConverter = false;
        this.shouldEmitDateConverter = false;
    }
    emitDateTimeConverters() {
        this._renderer.ensureBlankLine();
        this._renderer.emitLine("private static final String[] DATE_TIME_FORMATS = {");
        this._renderer.indent(() => this._renderer.indent(() => {
            this._renderer.emitLine('"yyyy-MM-dd\'T\'HH:mm:ss.SX",');
            this._renderer.emitLine('"yyyy-MM-dd\'T\'HH:mm:ss.S",');
            this._renderer.emitLine('"yyyy-MM-dd\'T\'HH:mm:ssX",');
            this._renderer.emitLine('"yyyy-MM-dd\'T\'HH:mm:ss",');
            this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss.SX",');
            this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss.S",');
            this._renderer.emitLine('"yyyy-MM-dd HH:mm:ssX",');
            this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss",');
            this._renderer.emitLine('"HH:mm:ss.SZ",');
            this._renderer.emitLine('"HH:mm:ss.S",');
            this._renderer.emitLine('"HH:mm:ssZ",');
            this._renderer.emitLine('"HH:mm:ss",');
            this._renderer.emitLine('"yyyy-MM-dd",');
        }));
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
            this._renderer.emitLine('return new SimpleDateFormat("yyyy-MM-dd\'T\'hh:mm:ssZ").format(datetime);');
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
    convertStringToDateTime(variable) {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }
    convertStringToTime(variable) {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }
    convertStringToDate(variable) {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }
    convertDateTimeToString(variable) {
        return [this._className, ".serializeDateTime(", variable, ")"];
    }
    convertTimeToString(variable) {
        return [this._className, ".serializeTime(", variable, ")"];
    }
    convertDateToString(variable) {
        return [this._className, ".serializeDate(", variable, ")"];
    }
}
class JavaRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
        this._gettersAndSettersForPropertyName = new Map();
        this._haveEmittedLeadingComments = false;
        this._converterClassname = "Converter";
        this._converterKeywords = [];
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
    forbiddenNamesForGlobalNamespace() {
        const keywords = [...javaKeywords, ...this._converterKeywords, this._converterClassname, ...this._dateTimeProvider.keywords];
        return keywords;
    }
    forbiddenForObjectProperties(_c, _className) {
        return { names: [], includeGlobalForbidden: true };
    }
    makeNamedTypeNamer() {
        return this.getNameStyling("typeNamingFunction");
    }
    namerForObjectProperty() {
        return this.getNameStyling("propertyNamingFunction");
    }
    makeUnionMemberNamer() {
        return this.getNameStyling("propertyNamingFunction");
    }
    makeEnumCaseNamer() {
        return this.getNameStyling("enumCaseNamingFunction");
    }
    unionNeedsName(u) {
        return TypeUtils_1.nullableFromUnion(u) === null;
    }
    namedTypeToNameForTopLevel(type) {
        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.
        return TypeUtils_1.directlyReachableSingleNamedType(type);
    }
    makeNamesForPropertyGetterAndSetter(_c, _className, _p, _jsonName, name) {
        const getterName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, (lookup) => `get_${lookup(name)}`);
        const setterName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, (lookup) => `set_${lookup(name)}`);
        return [getterName, setterName];
    }
    makePropertyDependencyNames(c, className, p, jsonName, name) {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(c, className, p, jsonName, name);
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }
    getNameStyling(convention) {
        const styling = {
            typeNamingFunction: Naming_1.funPrefixNamer("types", (n) => javaNameStyle(true, false, n, Acronyms_1.acronymStyle(this._options.acronymStyle))),
            propertyNamingFunction: Naming_1.funPrefixNamer("properties", (n) => javaNameStyle(false, false, n, Acronyms_1.acronymStyle(this._options.acronymStyle))),
            enumCaseNamingFunction: Naming_1.funPrefixNamer("enum-cases", (n) => javaNameStyle(true, true, n, Acronyms_1.acronymStyle(this._options.acronymStyle))),
        };
        return styling[convention];
    }
    fieldOrMethodName(methodName, topLevelName) {
        if (this.topLevels.size === 1) {
            return methodName;
        }
        return [topLevelName, Strings_1.capitalize(methodName)];
    }
    methodName(prefix, suffix, topLevelName) {
        if (this.topLevels.size === 1) {
            return [prefix, suffix];
        }
        return [prefix, topLevelName, suffix];
    }
    decoderName(topLevelName) {
        return this.fieldOrMethodName("fromJsonString", topLevelName);
    }
    encoderName(topLevelName) {
        return this.fieldOrMethodName("toJsonString", topLevelName);
    }
    readerGetterName(topLevelName) {
        return this.methodName("get", "ObjectReader", topLevelName);
    }
    writerGetterName(topLevelName) {
        return this.methodName("get", "ObjectWriter", topLevelName);
    }
    startFile(basename) {
        Support_1.assert(this._currentFilename === undefined, "Previous file wasn't finished");
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
    finishFile() {
        super.finishFile(Support_1.defined(this._currentFilename));
        this._currentFilename = undefined;
    }
    emitPackageAndImports(imports) {
        this.emitLine("package ", this._options.packageName, ";");
        this.ensureBlankLine();
        for (const pkg of imports) {
            this.emitLine("import ", pkg, ";");
        }
    }
    emitFileHeader(fileName, imports) {
        this.startFile(fileName);
        this.emitPackageAndImports(imports);
        this.ensureBlankLine();
    }
    emitDescriptionBlock(lines) {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }
    emitBlock(line, f) {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }
    emitTryCatch(main, handler, exception = "Exception") {
        this.emitLine("try {");
        this.indent(main);
        this.emitLine("} catch (", exception, " ex) {");
        this.indent(handler);
        this.emitLine("}");
    }
    emitIgnoredTryCatchBlock(f) {
        this.emitTryCatch(f, () => this.emitLine("// Ignored"));
    }
    javaType(reference, t, withIssues = false) {
        return TypeUtils_1.matchType(t, (_anyType) => Source_1.maybeAnnotated(withIssues, Annotation_1.anyTypeIssueAnnotation, "Object"), (_nullType) => Source_1.maybeAnnotated(withIssues, Annotation_1.nullTypeIssueAnnotation, "Object"), (_boolType) => (reference ? "Boolean" : "boolean"), (_integerType) => (reference ? "Long" : "long"), (_doubleType) => (reference ? "Double" : "double"), (_stringType) => "String", (arrayType) => {
            if (this._options.useList) {
                return ["List<", this.javaType(true, arrayType.items, withIssues), ">"];
            }
            else {
                return [this.javaType(false, arrayType.items, withIssues), "[]"];
            }
        }, (classType) => this.nameForNamedType(classType), (mapType) => ["Map<String, ", this.javaType(true, mapType.values, withIssues), ">"], (enumType) => this.nameForNamedType(enumType), (unionType) => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null)
                return this.javaType(true, nullable, withIssues);
            return this.nameForNamedType(unionType);
        }, (transformedStringType) => {
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
        });
    }
    javaImport(t) {
        return TypeUtils_1.matchType(t, (_anyType) => [], (_nullType) => [], (_boolType) => [], (_integerType) => [], (_doubleType) => [], (_stringType) => [], (arrayType) => {
            if (this._options.useList) {
                return [...this.javaImport(arrayType.items), "java.util.List"];
            }
            else {
                return [...this.javaImport(arrayType.items)];
            }
        }, (_classType) => [], (mapType) => [...this.javaImport(mapType.values), "java.util.Map"], (_enumType) => [], (unionType) => {
            const imports = [];
            unionType.members.forEach((type) => this.javaImport(type).forEach((imp) => imports.push(imp)));
            return imports;
        }, (transformedStringType) => {
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
        });
    }
    javaTypeWithoutGenerics(reference, t) {
        if (t instanceof Type_1.ArrayType) {
            if (this._options.useList) {
                return ["List"];
            }
            else {
                return [this.javaTypeWithoutGenerics(false, t.items), "[]"];
            }
        }
        else if (t instanceof Type_1.MapType) {
            return "Map";
        }
        else if (t instanceof Type_1.UnionType) {
            const nullable = TypeUtils_1.nullableFromUnion(t);
            if (nullable !== null)
                return this.javaTypeWithoutGenerics(true, nullable);
            return this.nameForNamedType(t);
        }
        else {
            return this.javaType(reference, t);
        }
    }
    emitClassAttributes(_c, _className) {
        if (this._options.lombok) {
            this.emitLine("@lombok.Data");
        }
    }
    annotationsForAccessor(_c, _className, _propertyName, _jsonName, _p, _isSetter) {
        return [];
    }
    importsForType(t) {
        if (t instanceof Type_1.ClassType) {
            return [];
        }
        if (t instanceof Type_1.UnionType) {
            return ["java.io.IOException"];
        }
        if (t instanceof Type_1.EnumType) {
            return ["java.io.IOException"];
        }
        return Support_1.assertNever(t);
    }
    importsForClass(c) {
        const imports = [];
        this.forEachClassProperty(c, "none", (_name, _jsonName, p) => {
            this.javaImport(p.type).forEach((imp) => imports.push(imp));
        });
        imports.sort();
        return [...new Set(imports)];
    }
    importsForUnionMembers(u) {
        const imports = [];
        const [, nonNulls] = TypeUtils_1.removeNullFromUnion(u);
        this.forEachUnionMember(u, nonNulls, "none", null, (_fieldName, t) => {
            this.javaImport(t).forEach((imp) => imports.push(imp));
        });
        imports.sort();
        return [...new Set(imports)];
    }
    emitClassDefinition(c, className) {
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
                    const [getterName, setterName] = Support_1.defined(this._gettersAndSettersForPropertyName.get(name));
                    const rendered = this.javaType(false, p.type);
                    this.annotationsForAccessor(c, className, name, jsonName, p, false)
                        .forEach(annotation => this.emitLine(annotation));
                    this.emitLine("public ", rendered, " ", getterName, "() { return ", name, "; }");
                    this.annotationsForAccessor(c, className, name, jsonName, p, true)
                        .forEach(annotation => this.emitLine(annotation));
                    this.emitLine("public void ", setterName, "(", rendered, " value) { this.", name, " = value; }");
                });
            }
        });
        this.finishFile();
    }
    unionField(u, t, withIssues = false) {
        const fieldType = this.javaType(true, t, withIssues);
        // FIXME: "Value" should be part of the name.
        const fieldName = [this.nameForUnionMember(u, t), "Value"];
        return { fieldType, fieldName };
    }
    emitUnionAttributes(_u, _unionName) {
        // empty
    }
    emitUnionSerializer(_u, _unionName) {
        // empty
    }
    emitUnionDefinition(u, unionName) {
        const imports = [...this.importsForType(u), ...this.importsForUnionMembers(u)];
        this.emitFileHeader(unionName, imports);
        this.emitDescription(this.descriptionForType(u));
        const [, nonNulls] = TypeUtils_1.removeNullFromUnion(u);
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
    emitEnumSerializationAttributes(_e) {
        // Empty
    }
    emitEnumDeserializationAttributes(_e) {
        // Empty
    }
    emitEnumDefinition(e, enumName) {
        this.emitFileHeader(enumName, this.importsForType(e));
        this.emitDescription(this.descriptionForType(e));
        const caseNames = [];
        this.forEachEnumCase(e, "none", (name) => {
            if (caseNames.length > 0)
                caseNames.push(", ");
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
                        this.emitLine("case ", name, ': return "', exports.stringEscape(jsonName), '";');
                    });
                });
                this.emitLine("}");
                this.emitLine("return null;");
            });
            this.ensureBlankLine();
            this.emitEnumDeserializationAttributes(e);
            this.emitBlock(["public static ", enumName, " forValue(String value) throws IOException"], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine('if (value.equals("', exports.stringEscape(jsonName), '")) return ', name, ";");
                });
                this.emitLine('throw new IOException("Cannot deserialize ', enumName, '");');
            });
        });
        this.finishFile();
    }
    emitSourceStructure() {
        this.forEachNamedType("leading-and-interposing", (c, n) => this.emitClassDefinition(c, n), (e, n) => this.emitEnumDefinition(e, n), (u, n) => this.emitUnionDefinition(u, n));
    }
}
exports.JavaRenderer = JavaRenderer;
class JacksonRenderer extends JavaRenderer {
    constructor(targetLanguage, renderContext, options) {
        super(targetLanguage, renderContext, options);
        this._converterKeywords = [
            "JsonProperty",
            "JsonDeserialize",
            "JsonDeserializer",
            "JsonSerialize",
            "JsonSerializer",
            "JsonParser",
            "JsonProcessingException",
            "DeserializationContext",
            "SerializerProvider",
        ];
    }
    emitClassAttributes(c, _className) {
        if (c.getProperties().size === 0)
            this.emitLine("@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE)");
        super.emitClassAttributes(c, _className);
    }
    annotationsForAccessor(_c, _className, _propertyName, jsonName, p, _isSetter) {
        const superAnnotations = super.annotationsForAccessor(_c, _className, _propertyName, jsonName, p, _isSetter);
        const annotations = [
            ('@JsonProperty("' + exports.stringEscape(jsonName) + '")')
        ];
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
    importsForType(t) {
        if (t instanceof Type_1.ClassType) {
            const imports = super.importsForType(t);
            imports.push("com.fasterxml.jackson.annotation.*");
            return imports;
        }
        if (t instanceof Type_1.UnionType) {
            const imports = super.importsForType(t);
            imports.push("java.io.IOException", "com.fasterxml.jackson.core.*", "com.fasterxml.jackson.databind.*", "com.fasterxml.jackson.databind.annotation.*");
            if (this._options.useList) {
                imports.push("com.fasterxml.jackson.core.type.*");
            }
            return imports;
        }
        if (t instanceof Type_1.EnumType) {
            const imports = super.importsForType(t);
            imports.push("com.fasterxml.jackson.annotation.*");
            return imports;
        }
        return Support_1.assertNever(t);
    }
    emitUnionAttributes(_u, unionName) {
        this.emitLine("@JsonDeserialize(using = ", unionName, ".Deserializer.class)");
        this.emitLine("@JsonSerialize(using = ", unionName, ".Serializer.class)");
    }
    emitUnionSerializer(u, unionName) {
        const stringBasedObjects = ["uuid", "time", "date", "date-time"];
        const tokenCase = (tokenType) => {
            this.emitLine("case ", tokenType, ":");
        };
        const emitNullDeserializer = () => {
            this.indent(() => {
                tokenCase("VALUE_NULL");
                this.indent(() => this.emitLine("break;"));
            });
        };
        const emitDeserializerCodeForStringObjects = (fieldName, kind, parseFrom) => {
            switch (kind) {
                case "date":
                    this.emitLine("value.", fieldName, " = ", this._dateTimeProvider.convertStringToDate(parseFrom), ";");
                    break;
                case "time":
                    this.emitLine("value.", fieldName, " = ", this._dateTimeProvider.convertStringToTime(parseFrom), ";");
                    break;
                case "date-time":
                    this.emitLine("value.", fieldName, " = ", this._dateTimeProvider.convertStringToDateTime(parseFrom), ";");
                    break;
                case "uuid":
                    this.emitLine("value.", fieldName, " = UUID.fromString(", parseFrom, ");");
                    break;
                default:
                    return Support_1.panic("Requested type isnt an object!");
            }
        };
        const emitDeserializeType = (t, variableFieldName = "") => {
            const { fieldName } = this.unionField(u, t);
            const rendered = this.javaTypeWithoutGenerics(true, t);
            if (this._options.useList && t instanceof Type_1.ArrayType) {
                this.emitLine("value.", fieldName, " = jsonParser.readValueAs(new TypeReference<", rendered, ">() {});");
            }
            else if (stringBasedObjects.some((stringBasedTypeKind) => t.kind === stringBasedTypeKind)) {
                emitDeserializerCodeForStringObjects(fieldName, t.kind, variableFieldName);
            }
            else if (t.kind === "string") {
                this.emitLine("value.", fieldName, " = ", variableFieldName, ";");
            }
            else if (t.kind === "enum") {
                const { fieldType } = this.unionField(u, t, true);
                this.emitLine("value.", fieldName, " = ", fieldType, ".forValue(", variableFieldName, ");");
            }
            else {
                this.emitLine("value.", fieldName, " = jsonParser.readValueAs(", rendered, ".class);");
            }
        };
        const emitDeserializer = (tokenTypes, kind) => {
            const t = u.findMember(kind);
            if (t === undefined)
                return;
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
            if (stringBasedObjects.every((kind) => u.findMember(kind) === undefined) &&
                stringType === undefined &&
                enumType === undefined)
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
        const emitNumberDeserializer = () => {
            const integerType = u.findMember("integer");
            const doubleType = u.findMember("double");
            if (doubleType === undefined && integerType === undefined)
                return;
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
        const customObjectSerializer = ["time", "date", "date-time"];
        const serializerCodeForType = (type, fieldName) => {
            switch (type.kind) {
                case "date":
                    return this._dateTimeProvider.convertDateToString(fieldName);
                case "time":
                    return this._dateTimeProvider.convertTimeToString(fieldName);
                case "date-time":
                    return this._dateTimeProvider.convertDateTimeToString(fieldName);
                default:
                    return Support_1.panic("Requested type doesn't have custom serializer code!");
            }
        };
        const emitSerializeType = (t) => {
            let { fieldName } = this.unionField(u, t, true);
            this.emitBlock(["if (obj.", fieldName, " != null)"], () => {
                if (customObjectSerializer.some((customSerializerType) => t.kind === customSerializerType)) {
                    this.emitLine("jsonGenerator.writeObject(", serializerCodeForType(t, ["obj.", fieldName]), ");");
                }
                else {
                    this.emitLine("jsonGenerator.writeObject(obj.", fieldName, ");");
                }
                this.emitLine("return;");
            });
        };
        const [maybeNull, nonNulls] = TypeUtils_1.removeNullFromUnion(u);
        this.ensureBlankLine();
        this.emitBlock(["static class Deserializer extends JsonDeserializer<", unionName, ">"], () => {
            this.emitLine("@Override");
            this.emitBlock([
                "public ",
                unionName,
                " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) throws IOException, JsonProcessingException",
            ], () => {
                this.emitLine(unionName, " value = new ", unionName, "();");
                this.emitLine("switch (jsonParser.currentToken()) {");
                if (maybeNull !== null)
                    emitNullDeserializer();
                emitNumberDeserializer();
                emitDeserializer(["VALUE_TRUE", "VALUE_FALSE"], "bool");
                emitStringDeserializer();
                emitDeserializer(["START_ARRAY"], "array");
                emitDeserializer(["START_OBJECT"], "class");
                emitDeserializer(["START_OBJECT"], "map");
                this.indent(() => this.emitLine('default: throw new IOException("Cannot deserialize ', unionName, '");'));
                this.emitLine("}");
                this.emitLine("return value;");
            });
        });
        this.ensureBlankLine();
        this.emitBlock(["static class Serializer extends JsonSerializer<", unionName, ">"], () => {
            this.emitLine("@Override");
            this.emitBlock([
                "public void serialize(",
                unionName,
                " obj, JsonGenerator jsonGenerator, SerializerProvider serializerProvider) throws IOException",
            ], () => {
                for (const t of nonNulls) {
                    emitSerializeType(t);
                }
                if (maybeNull !== null) {
                    this.emitLine("jsonGenerator.writeNull();");
                }
                else {
                    this.emitLine('throw new IOException("', unionName, ' must not be null");');
                }
            });
        });
    }
    emitEnumSerializationAttributes(_e) {
        this.emitLine("@JsonValue");
    }
    emitEnumDeserializationAttributes(_e) {
        this.emitLine("@JsonCreator");
    }
    emitOffsetDateTimeConverterModule() {
        this.emitLine("SimpleModule module = new SimpleModule();");
        if (this._dateTimeProvider.shouldEmitDateTimeConverter) {
            this.emitLine("module.addDeserializer(", this._dateTimeProvider.dateTimeType, ".class, new JsonDeserializer<", this._dateTimeProvider.dateTimeType, ">() {");
            this.indent(() => {
                this.emitLine("@Override");
                this.emitBlock([
                    "public ",
                    this._dateTimeProvider.dateTimeType,
                    " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
                    "throws IOException, JsonProcessingException"
                ], () => {
                    this.emitLine("String value = jsonParser.getText();");
                    this.emitLine("return ", this._dateTimeProvider.convertStringToDateTime("value"), ";");
                });
            });
            this.emitLine("});");
        }
        if (!this._dateTimeProvider.shouldEmitTimeConverter) {
            this.emitLine("module.addDeserializer(", this._dateTimeProvider.timeType, ".class, new JsonDeserializer<", this._dateTimeProvider.timeType, ">() {");
            this.indent(() => {
                this.emitLine("@Override");
                this.emitBlock([
                    "public ",
                    this._dateTimeProvider.timeType,
                    " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
                    "throws IOException, JsonProcessingException"
                ], () => {
                    this.emitLine("String value = jsonParser.getText();");
                    this.emitLine("return ", this._dateTimeProvider.convertStringToTime("value"), ";");
                });
            });
            this.emitLine("});");
        }
        if (!this._dateTimeProvider.shouldEmitDateConverter) {
            this.emitLine("module.addDeserializer(", this._dateTimeProvider.dateType, ".class, new JsonDeserializer<", this._dateTimeProvider.dateType, ">() {");
            this.indent(() => {
                this.emitLine("@Override");
                this.emitBlock([
                    "public ",
                    this._dateTimeProvider.dateType,
                    " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
                    "throws IOException, JsonProcessingException"
                ], () => {
                    this.emitLine("String value = jsonParser.getText();");
                    this.emitLine("return ", this._dateTimeProvider.convertStringToDate("value"), ";");
                });
            });
            this.emitLine("});");
        }
        this.emitLine("mapper.registerModule(module);");
    }
    emitConverterClass() {
        this.startFile(this._converterClassname);
        this.emitCommentLines([
            "To use this code, add the following Maven dependency to your project:",
            "",
            this._options.lombok ? "    org.projectlombok : lombok : 1.18.2" : "",
            "    com.fasterxml.jackson.core     : jackson-databind          : 2.9.0",
            this._options.dateTimeProvider === "java8" ? "    com.fasterxml.jackson.datatype : jackson-datatype-jsr310   : 2.9.0" : "",
            "",
            "Import this package:",
            "",
        ]);
        this.emitLine("//     import ", this._options.packageName, ".Converter;");
        this.emitMultiline(`//
// Then you can deserialize a JSON string with
//`);
        this.forEachTopLevel("none", (t, name) => {
            this.emitLine("//     ", this.javaType(false, t), " data = Converter.", this.decoderName(name), "(jsonString);");
        });
        this.ensureBlankLine();
        const imports = [
            "java.io.IOException",
            "com.fasterxml.jackson.databind.*",
            "com.fasterxml.jackson.databind.module.SimpleModule",
            "com.fasterxml.jackson.core.JsonParser",
            "com.fasterxml.jackson.core.JsonProcessingException",
            "java.util.*",
        ].concat(this._dateTimeProvider.converterImports);
        this.emitPackageAndImports(imports);
        this.ensureBlankLine();
        this.emitBlock(["public class Converter"], () => {
            this.emitLine("// Date-time helpers");
            this._dateTimeProvider.emitDateTimeConverters();
            this.emitLine("// Serialize/deserialize helpers");
            this.forEachTopLevel("leading-and-interposing", (topLevelType, topLevelName) => {
                const topLevelTypeRendered = this.javaType(false, topLevelType);
                this.emitBlock([
                    "public static ",
                    topLevelTypeRendered,
                    " ",
                    this.decoderName(topLevelName),
                    "(String json) throws IOException",
                ], () => {
                    this.emitLine("return ", this.readerGetterName(topLevelName), "().readValue(json);");
                });
                this.ensureBlankLine();
                this.emitBlock([
                    "public static String ",
                    this.encoderName(topLevelName),
                    "(",
                    topLevelTypeRendered,
                    " obj) throws JsonProcessingException",
                ], () => {
                    this.emitLine("return ", this.writerGetterName(topLevelName), "().writeValueAsString(obj);");
                });
            });
            this.forEachTopLevel("leading-and-interposing", (topLevelType, topLevelName) => {
                const readerName = this.fieldOrMethodName("reader", topLevelName);
                const writerName = this.fieldOrMethodName("writer", topLevelName);
                this.emitLine("private static ObjectReader ", readerName, ";");
                this.emitLine("private static ObjectWriter ", writerName, ";");
                this.ensureBlankLine();
                this.emitBlock(["private static void ", this.methodName("instantiate", "Mapper", topLevelName), "()"], () => {
                    const renderedForClass = this.javaTypeWithoutGenerics(false, topLevelType);
                    this.emitLine("ObjectMapper mapper = new ObjectMapper();");
                    this.emitLine("mapper.findAndRegisterModules();");
                    this.emitLine("mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);");
                    this.emitLine("mapper.configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);");
                    this.emitOffsetDateTimeConverterModule();
                    this.emitLine(readerName, " = mapper.readerFor(", renderedForClass, ".class);");
                    this.emitLine(writerName, " = mapper.writerFor(", renderedForClass, ".class);");
                });
                this.ensureBlankLine();
                this.emitBlock(["private static ObjectReader ", this.readerGetterName(topLevelName), "()"], () => {
                    this.emitLine("if (", readerName, " == null) ", this.methodName("instantiate", "Mapper", topLevelName), "();");
                    this.emitLine("return ", readerName, ";");
                });
                this.ensureBlankLine();
                this.emitBlock(["private static ObjectWriter ", this.writerGetterName(topLevelName), "()"], () => {
                    this.emitLine("if (", writerName, " == null) ", this.methodName("instantiate", "Mapper", topLevelName), "();");
                    this.emitLine("return ", writerName, ";");
                });
            });
        });
        this.finishFile();
    }
    emitSourceStructure() {
        this.emitConverterClass();
        super.emitSourceStructure();
    }
}
exports.JacksonRenderer = JacksonRenderer;
