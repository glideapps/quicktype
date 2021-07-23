import {
    Type,
    EnumType,
    UnionType,
    ClassType,
    ClassProperty,
    TransformedStringTypeKind,
    PrimitiveStringTypeKind
} from "../Type";
import { matchType, nullableFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import {
    utf16LegalizeCharacters,
    escapeNonPrintableMapper,
    utf16ConcatMap,
    standardUnicodeHexEscape,
    isAscii,
    isLetter,
    isDigit,
    splitIntoWords,
    combineWords,
    allUpperWordStyle,
    firstUpperWordStyle,
    allLowerWordStyle,
    isPrintable,
    decapitalize,
    snakeCase
} from "../support/Strings";

import { StringTypeMapping } from "../TypeBuilder";

import { Name, Namer, funPrefixNamer, DependencyName } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { Option, BooleanOption, getOptionValues, OptionValues, StringOption } from "../RendererOptions";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { defined } from "../support/Support";
import { RenderContext } from "../Renderer";
import { arrayIntercalate } from "collection-utils";

export const dartOptions = {
    justTypes: new BooleanOption("just-types", "Types only", false),
    codersInClass: new BooleanOption("coders-in-class", "Put encoder & decoder in Class", false),
    methodNamesWithMap: new BooleanOption("from-map", "Use method names fromMap() & toMap()", false),
    requiredProperties: new BooleanOption("required-props", "Make all properties required", false),
    finalProperties: new BooleanOption("final-props", "Make all properties final", false),
    generateCopyWith: new BooleanOption("copy-with", "Generate CopyWith method", false),
    useFreezed: new BooleanOption("use-freezed", "Generate class definitions with @freezed compatibility", false),
    useHive: new BooleanOption("use-hive", "Generate annotations for Hive type adapters", false),
    partName: new StringOption("part-name", "Use this name in `part` directive", "NAME", ""),
    detectEnum: new BooleanOption("enum-detect", "Detects the enum", false),
    nullsafety: new BooleanOption("null-safety", "Null safety and dart 2.0 friendly", false),
    allPropertyNullable: new BooleanOption("all-nullable", "Makes properties nullable ", false),
    sameAsKey: new BooleanOption(
        "name-same-as-key",
        "Keep properties name and enum name same as the key name in json",
        false
    )
};

export class DartTargetLanguage extends TargetLanguage {
    constructor() {
        super("Dart", ["dart"], "dart");
    }

    protected getOptions(): Option<any>[] {
        return [
            dartOptions.justTypes,
            dartOptions.codersInClass,
            dartOptions.methodNamesWithMap,
            dartOptions.requiredProperties,
            dartOptions.finalProperties,
            dartOptions.generateCopyWith,
            dartOptions.useFreezed,
            dartOptions.useHive,
            dartOptions.partName,
            dartOptions.sameAsKey,
            dartOptions.detectEnum,
            dartOptions.nullsafety,
            dartOptions.allPropertyNullable
        ];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        mapping.set("date", "date");
        mapping.set("date-time", "date-time");
        //        mapping.set("uuid", "uuid");
        return mapping;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): DartRenderer {
        const options = getOptionValues(dartOptions, untypedOptionValues);
        return new DartRenderer(this, renderContext, options);
    }
}

const keywords = [
    "abstract",
    "do",
    "import",
    "super",
    "as",
    "dynamic",
    "in",
    "switch",
    "assert",
    "else",
    "interface",
    "sync*",
    "async",
    "enum",
    "is",
    "this",
    "async*",
    "export",
    "library",
    "throw",
    "await",
    "external",
    "mixin",
    "true",
    "break",
    "extends",
    "new",
    "try",
    "case",
    "factory",
    "null",
    "typedef",
    "catch",
    "false",
    "operator",
    "var",
    "class",
    "final",
    "part",
    "void",
    "const",
    "finally",
    "rethrow",
    "while",
    "continue",
    "for",
    "return",
    "with",
    "covariant",
    "get",
    "set",
    "yield",
    "default",
    "if",
    "static",
    "yield*",
    "deferred",
    "implements",
    "int",
    "double",
    "bool",
    "Map",
    "List",
    "String",
    "File",
    "fromJson",
    "toJson",
    "fromMap",
    "toMap"
];

const typeNamingFunction = funPrefixNamer("types", n => dartNameStyle(true, false, n));
const propertyNamingFunction = funPrefixNamer("properties", n => dartNameStyle(false, false, n));
const enumCaseNamingFunction = funPrefixNamer("enum-cases", n => dartNameStyle(true, true, n));

const propertyOriginalNamingFunction = funPrefixNamer("properties", n => n);
const enumCaseOriginalNamingFunction = funPrefixNamer("enum-cases", n => n);

// Escape the dollar sign, which is used in string interpolation
const stringEscape = utf16ConcatMap(
    escapeNonPrintableMapper(cp => isPrintable(cp) && cp !== 0x24, standardUnicodeHexEscape)
);

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return false; // underscore
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
function dartNameStyle(startWithUpper: boolean, upperUnderscore: boolean, original: string): string {
    const words = splitIntoWords(original);
    const firstWordStyle = upperUnderscore
        ? allUpperWordStyle
        : startWithUpper
        ? firstUpperWordStyle
        : allLowerWordStyle;
    const restWordStyle = upperUnderscore ? allUpperWordStyle : firstUpperWordStyle;
    return combineWords(
        words,
        legalizeName,
        firstWordStyle,
        restWordStyle,
        firstWordStyle,
        restWordStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
}

type TopLevelDependents = {
    encoder: Name;
    decoder: Name;
};

export class DartRenderer extends ConvenienceRenderer {
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name]>();
    private _needEnumValues = false;
    private classCounter = 0;
    private classPropertyCounter = 0;
    private readonly _topLevelDependents = new Map<Name, TopLevelDependents>();
    private readonly _enumValues = new Map<EnumType, Name>();

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof dartOptions>
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
        return typeNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return this._options.sameAsKey ? propertyOriginalNamingFunction : propertyNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return this._options.sameAsKey ? propertyOriginalNamingFunction : propertyNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return this._options.sameAsKey ? enumCaseOriginalNamingFunction : enumCaseNamingFunction;
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

    protected get toJson(): string {
        return `to${this._options.methodNamesWithMap ? "Map" : "Json"}`;
    }

    protected get fromJson(): string {
        return `from${this._options.methodNamesWithMap ? "Map" : "Json"}`;
    }

    protected makeTopLevelDependencyNames(_t: Type, name: Name): DependencyName[] {
        const encoder = new DependencyName(
            propertyNamingFunction,
            name.order,
            lookup => `${lookup(name)}_${this.toJson}`
        );
        const decoder = new DependencyName(
            propertyNamingFunction,
            name.order,
            lookup => `${lookup(name)}_${this.fromJson}`
        );
        this._topLevelDependents.set(name, { encoder, decoder });
        return [encoder, decoder];
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
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }

    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];
        const enumValue = new DependencyName(propertyNamingFunction, name.order, lookup => `${lookup(name)}_values`);
        this._enumValues.set(t, enumValue);
        return [enumValue];
    }

    protected emitFileHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }

        // this is to ignore the linting rule in while property name are other than camelCase
        // enum and unions are not PascalCase
        if (this._options.sameAsKey) this.emitLine("// ignore_for_file: non_constant_identifier_names");

        if (this._options.justTypes) return;

        this.emitLine("// To parse this JSON data, do");
        this.emitLine("//");
        this.forEachTopLevel("none", (_t, name) => {
            const { decoder } = defined(this._topLevelDependents.get(name));
            this.emitLine("//     final ", modifySource(decapitalize, name), " = ", decoder, "(jsonString);");
        });

        this.ensureBlankLine();
        if (this._options.requiredProperties && !this._options.nullsafety) {
            this.emitLine("import 'package:meta/meta.dart';");
        }
        if (this._options.useFreezed) {
            if (!this._options.justTypes) this.emitLine("import 'package:json_annotation/json_annotation.dart';");
            this.emitLine("import 'package:freezed_annotation/freezed_annotation.dart';");
        }
        if (this._options.useHive) {
            this.emitLine("import 'package:hive/hive.dart';");
        }

        this.emitLine("import 'dart:convert';");
        if (this._options.useFreezed || this._options.useHive) {
            this.ensureBlankLine();
            const optionNameIsEmpty = this._options.partName.length === 0;
            // FIXME: This should use a `Name`, not `modifySource`
            const name = modifySource(
                snakeCase,
                optionNameIsEmpty ? [...this.topLevels.keys()][0] : this._options.partName
            );
            if (this._options.useFreezed) {
                this.emitLine("part '", name, ".freezed.dart';");
            }
            if (!this._options.justTypes) {
                this.emitLine("part '", name, ".g.dart';");
            }
        }
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected dartType(t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "dynamic"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "dynamic"),
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "double",
            _stringType => "String",
            arrayType => ["List<", this.dartType(arrayType.items, withIssues), ">"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.dartType(mapType.values, withIssues), ">"],
            enumType => (this._options.detectEnum ? this.nameForNamedType(enumType) : "String"),
            unionType => {
                const maybeNullable = nullableFromUnion(unionType);
                if (maybeNullable === null) {
                    return "dynamic";
                }
                return this.dartType(maybeNullable, withIssues);
            },
            transformedStringType => {
                switch (transformedStringType.kind) {
                    case "date-time":
                    case "date":
                        return "DateTime";
                    default:
                        return "String";
                }
            }
        );
    }

    protected mapList(itemType: Sourcelike, list: Sourcelike, mapper: Sourcelike): Sourcelike {
        return this._options.allPropertyNullable
            ? [list, "==null?null: List<", itemType, ">.from(", list, "!.map((x) => ", mapper, "))"]
            : ["List<", itemType, ">.from(", list, ".map((x) => ", mapper, "))"];
    }

    protected mapMap(valueType: Sourcelike, map: Sourcelike, valueMapper: Sourcelike): Sourcelike {
        return ["Map.from(", map, ").map((k, v) => MapEntry<String, ", valueType, ">(k, ", valueMapper, "))"];
    }

    protected fromDynamicExpression(t: Type, ...dynamic: Sourcelike[]): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => dynamic,
            _nullType => dynamic, // FIXME: check null
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => [dynamic, ".toDouble()"],
            _stringType => dynamic,
            arrayType =>
                this.mapList(this.dartType(arrayType.items), dynamic, this.fromDynamicExpression(arrayType.items, "x")),
            classType => [this.nameForNamedType(classType), ".", this.fromJson, "(", dynamic, ")"],
            mapType =>
                this.mapMap(this.dartType(mapType.values), dynamic, this.fromDynamicExpression(mapType.values, "v")),
            enumType =>
                this._options.detectEnum ? [defined(this._enumValues.get(enumType)), ".map[", dynamic, "]"] : dynamic,

            unionType => {
                const maybeNullable = nullableFromUnion(unionType);
                if (maybeNullable === null) {
                    return dynamic;
                }
                return [this.fromDynamicExpression(maybeNullable, dynamic)];
            },
            transformedStringType => {
                switch (transformedStringType.kind) {
                    case "date-time":
                    case "date":
                        return ["DateTime.parse(", dynamic, ")"];
                    default:
                        return dynamic;
                }
            }
        );
    }

    protected toDynamicExpression(t: Type, ...dynamic: Sourcelike[]): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => dynamic,
            _nullType => dynamic,
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => dynamic,
            _stringType => dynamic,
            arrayType => this.mapList("dynamic", dynamic, this.toDynamicExpression(arrayType.items, "x")),
            _classType => [dynamic, this._options.allPropertyNullable ? "?." : ".", this.toJson, "()"],
            mapType => this.mapMap("dynamic", dynamic, this.toDynamicExpression(mapType.values, "v")),
            enumType =>
                this._options.detectEnum
                    ? [defined(this._enumValues.get(enumType)), ".reverse[", dynamic, "]"]
                    : dynamic,
            unionType => {
                const maybeNullable = nullableFromUnion(unionType);
                if (maybeNullable === null) {
                    return dynamic;
                }
                return [this.toDynamicExpression(maybeNullable, dynamic)];
            },
            transformedStringType => {
                switch (transformedStringType.kind) {
                    case "date-time":
                        return [dynamic, this._options.allPropertyNullable ? "?" : "", ".toIso8601String()"];
                    case "date":
                        return [
                            '"${',
                            dynamic,
                            this._options.allPropertyNullable ? "?" : "",
                            ".year.toString().padLeft(4, '0')",
                            "}-${",
                            dynamic,
                            ".month.toString().padLeft(2, '0')}-${",
                            dynamic,
                            ".day.toString().padLeft(2, '0')}\""
                        ];
                    default:
                        return dynamic;
                }
            }
        );
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        if (this._options.useHive) {
            this.classCounter++;
            this.emitLine(`@HiveType(typeId: ${this.classCounter})`);
            this.classPropertyCounter = 0;
        }
        this.emitBlock(["class ", className], () => {
            if (c.getProperties().size === 0) {
                this.emitLine(className, "();");
            } else {
                this.emitLine(className, "({");
                this.indent(() => {
                    this.forEachClassProperty(c, "none", (name, _, _p) => {
                        this.emitLine(
                            this._options.requiredProperties
                                ? this._options.nullsafety
                                    ? "required "
                                    : "@required "
                                : " ",
                            "this.",
                            name,
                            ","
                        );
                    });
                });
                this.emitLine("});");
                this.ensureBlankLine();

                this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                    const description = this.descriptionForClassProperty(c, jsonName);
                    if (description !== undefined) {
                        this.emitDescription(description);
                    }

                    if (this._options.useHive) {
                        this.classPropertyCounter++;
                        this.emitLine(`@HiveField(${this.classPropertyCounter})`);
                    }

                    this.emitLine(
                        this._options.finalProperties ? "final " : "",
                        this.dartType(p.type, true),
                        this._options.allPropertyNullable ? "?" : " ",
                        " ",

                        name,
                        ";"
                    );
                });
            }

            if (this._options.generateCopyWith) {
                this.ensureBlankLine();
                this.emitLine(className, " copyWith({");
                this.indent(() => {
                    this.forEachClassProperty(c, "none", (name, _, _p) => {
                        this.emitLine(this.dartType(_p.type, true), " ", name, ",");
                    });
                });
                this.emitLine("}) => ");
                this.indent(() => {
                    this.emitLine(className, "(");
                    this.indent(() => {
                        this.forEachClassProperty(c, "none", (name, _, _p) => {
                            this.emitLine(name, ": ", name, " ?? ", "this.", name, ",");
                        });
                    });
                    this.emitLine(");");
                });
            }

            if (this._options.justTypes) return;

            if (this._options.codersInClass) {
                this.ensureBlankLine();
                this.emitLine(
                    "factory ",
                    className,
                    ".from",
                    this._options.methodNamesWithMap ? "Json" : "RawJson",
                    "(String str) => ",
                    className,
                    ".",
                    this.fromJson,
                    "(json.decode(str));"
                );

                this.ensureBlankLine();
                this.emitLine(
                    "String ",
                    this._options.methodNamesWithMap ? "toJson() => " : "toRawJson() => ",
                    "json.encode(",
                    this.toJson,
                    "());"
                );
            }

            this.ensureBlankLine();
            this.emitLine("factory ", className, ".", this.fromJson, "(Map<String, dynamic> json) => ", className, "(");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                    this.emitLine(
                        name,
                        ": ",
                        this.fromDynamicExpression(property.type, 'json["', stringEscape(jsonName), '"]'),
                        ","
                    );
                });
            });
            this.emitLine(");");

            this.ensureBlankLine();

            this.emitLine("Map<String, dynamic> ", this.toJson, "() => {");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                    this.emitLine(
                        '"',
                        stringEscape(jsonName),
                        '": ',
                        this.toDynamicExpression(property.type, name),
                        ","
                    );
                });
            });
            this.emitLine("};");
        });
    }

    protected emitFreezedClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));

        this.emitLine("@freezed");
        this.emitBlock(["abstract class ", className, " with _$", className], () => {
            if (c.getProperties().size === 0) {
                this.emitLine("const factory ", className, "() = _", className, ";");
            } else {
                this.emitLine("const factory ", className, "({");
                this.indent(() => {
                    this.forEachClassProperty(c, "none", (name, _, _p) => {
                        this.emitLine(
                            this._options.requiredProperties
                                ? this._options.nullsafety
                                    ? "required "
                                    : "@required "
                                : " ",
                            this.dartType(_p.type, true),
                            this._options.allPropertyNullable ? "?" : " ",
                            " ",
                            name,
                            ","
                        );
                    });
                });
                this.emitLine("}) = _", className, ";");
            }

            if (this._options.justTypes) return;

            this.ensureBlankLine();
            this.emitLine(
                // factory PublicAnswer.fromJson(Map<String, dynamic> json) => _$PublicAnswerFromJson(json);
                "factory ",
                className,
                ".fromJson(Map<String, dynamic> json) => ",
                "_$",
                className,
                "FromJson(json);"
            );
        });
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        const caseNames: Sourcelike[] = Array.from(e.cases).map(c => this.nameForEnumCase(e, c));
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum ", enumName, " { ", arrayIntercalate(", ", caseNames), " }");

        if (this._options.justTypes) return;

        this.ensureBlankLine();
        this.emitLine("final ", defined(this._enumValues.get(e)), " = EnumValues({");
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName, pos) => {
                const comma = pos === "first" || pos === "middle" ? "," : [];
                this.emitLine('"', stringEscape(jsonName), '": ', enumName, ".", name, comma);
            });
        });
        this.emitLine("});");

        this._needEnumValues = true;
    }

    protected emitEnumValues(): void {
        this.ensureBlankLine();

        if (this._options.nullsafety) {
            this.emitMultiline(`class EnumValues<T> {
        Map<String, T> map;
        late Map<T, String> reverseMap;
    
        EnumValues(this.map);
    
        Map<T, String> get reverse {
            reverseMap = map.map((k, v) => new MapEntry(v, k));
            return reverseMap;
        }
    }`);
        } else {
            this.emitMultiline(`class EnumValues<T> {
        Map<String, T> map;
        Map<T, String> reverseMap;
    
        EnumValues(this.map);
    
        Map<T, String> get reverse {
            if (reverseMap == null) {
                reverseMap = map.map((k, v) => new MapEntry(v, k));
            }
            return reverseMap;
        }
    }`);
        }
    }

    protected emitSourceStructure(): void {
        this.emitFileHeader();

        if (!this._options.justTypes && !this._options.codersInClass) {
            this.forEachTopLevel("leading-and-interposing", (t, name) => {
                const { encoder, decoder } = defined(this._topLevelDependents.get(name));

                this.emitLine(
                    this.dartType(t),
                    " ",
                    decoder,
                    "(String str) => ",
                    this.fromDynamicExpression(t, "json.decode(str)"),
                    ";"
                );

                this.ensureBlankLine();

                this.emitLine(
                    "String ",
                    encoder,
                    "(",
                    this.dartType(t),
                    " data) => json.encode(",
                    this.toDynamicExpression(t, "data"),
                    ");"
                );

                // this.emitBlock(["String ", encoder, "(", this.dartType(t), " data)"], () => {
                //     this.emitJsonEncoderBlock(t);
                // });
            });
        }

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) =>
                this._options.useFreezed ? this.emitFreezedClassDefinition(c, n) : this.emitClassDefinition(c, n),
            (e, n) => {
                if (this._options.detectEnum) this.emitEnumDefinition(e, n);
            },
            (_e, _n) => {
                // We don't support this yet.
            }
        );

        if (this._needEnumValues) {
            this.emitEnumValues();
        }
    }
}
