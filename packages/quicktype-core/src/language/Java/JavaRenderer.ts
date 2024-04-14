import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../../Annotation";
import { ConvenienceRenderer, type ForbiddenWordsInfo } from "../../ConvenienceRenderer";
import { DependencyName, type Name, type Namer, funPrefixNamer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, maybeAnnotated } from "../../Source";
import { acronymStyle } from "../../support/Acronyms";
import { capitalize } from "../../support/Strings";
import { assert, assertNever, defined } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import { ArrayType, type ClassProperty, ClassType, EnumType, MapType, type Type, UnionType } from "../../Type";
import { directlyReachableSingleNamedType, matchType, nullableFromUnion, removeNullFromUnion } from "../../TypeUtils";

import { javaKeywords } from "./constants";
import { Java8DateTimeProvider, type JavaDateTimeProvider, JavaLegacyDateTimeProvider } from "./DateTimeProvider";
import { type javaOptions } from "./language";
import { javaNameStyle, stringEscape } from "./utils";

export class JavaRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;

    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name]>();

    private _haveEmittedLeadingComments = false;

    protected readonly _dateTimeProvider: JavaDateTimeProvider;

    protected readonly _converterClassname: string = "Converter";

    protected readonly _converterKeywords: string[] = [];

    public constructor(
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

    public emitTryCatch(main: () => void, handler: () => void, exception = "Exception"): void {
        this.emitLine("try {");
        this.indent(main);
        this.emitLine("} catch (", exception, " ex) {");
        this.indent(handler);
        this.emitLine("}");
    }

    public emitIgnoredTryCatchBlock(f: () => void): void {
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

    protected unionField(u: UnionType, t: Type, withIssues = false): { fieldName: Sourcelike; fieldType: Sourcelike } {
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

    protected emitEnumSerializationAttributes(_e: EnumType): void {
        // Empty
    }

    protected emitEnumDeserializationAttributes(_e: EnumType): void {
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
