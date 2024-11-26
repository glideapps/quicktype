import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../../Annotation";
import { ConvenienceRenderer, type ForbiddenWordsInfo } from "../../ConvenienceRenderer";
import { DependencyName, type Name, type Namer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, maybeAnnotated, modifySource } from "../../Source";
import { decapitalize, snakeCase } from "../../support/Strings";
import { defined } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import {
    ArrayType,
    type ClassProperty,
    type ClassType,
    EnumType,
    MapType,
    ObjectType,
    type Type,
    type UnionType
} from "../../Type";
import { directlyReachableSingleNamedType, matchType, nullableFromUnion } from "../../TypeUtils";

import { keywords } from "./constants";
import { type dartOptions } from "./language";
import { enumCaseNamingFunction, propertyNamingFunction, stringEscape, typeNamingFunction } from "./utils";

interface TopLevelDependents {
    decoder: Name;
    encoder: Name;
}

export class DartRenderer extends ConvenienceRenderer {
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name]>();

    private _needEnumValues = false;

    private classCounter = 0;

    private classPropertyCounter = 0;

    private readonly _topLevelDependents = new Map<Name, TopLevelDependents>();

    private readonly _enumValues = new Map<EnumType, Name>();

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof dartOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
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
            this.emitComments(this.leadingComments);
        }

        if (this._options.justTypes) return;

        if (!this._options.codersInClass) {
            this.emitLine("// To parse this JSON data, do");
            this.emitLine("//");
            this.forEachTopLevel("none", (_t, name) => {
                const { decoder } = defined(this._topLevelDependents.get(name));
                this.emitLine("//     final ", modifySource(decapitalize, name), " = ", decoder, "(jsonString);");
            });
        }

        this.ensureBlankLine();
        if (this._options.requiredProperties) {
            this.emitLine("import 'package:meta/meta.dart';");
        }

        if (this._options.useFreezed) {
            this.emitLine("import 'package:freezed_annotation/freezed_annotation.dart';");
        }

        if (this._options.useHive) {
            this.emitLine("import 'package:hive/hive.dart';");
        }

        if (this._options.useJsonAnnotation && !this._options.useFreezed) {
            // The freezed annotatation import already provides the import for json_annotation
            this.emitLine("import 'package:json_annotation/json_annotation.dart';");
        }

        this.emitLine("import 'dart:convert';");
        if (this._options.useFreezed || this._options.useHive || this._options.useJsonAnnotation) {
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
        this.emitCommentLines(lines, { lineStart: "///", beforeComment: "" });
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected dartType(t: Type, withIssues = false, forceNullable = false): Sourcelike {
        const nullable =
            forceNullable || (this._options.nullSafety && t.isNullable && !this._options.requiredProperties);
        const withNullable = (s: Sourcelike): Sourcelike => (nullable ? [s, "?"] : s);
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "dynamic"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "dynamic"),
            _boolType => withNullable("bool"),
            _integerType => withNullable("int"),
            _doubleType => withNullable("double"),
            _stringType => withNullable("String"),
            arrayType => withNullable(["List<", this.dartType(arrayType.items, withIssues), ">"]),
            classType => withNullable(this.nameForNamedType(classType)),
            mapType => withNullable(["Map<String, ", this.dartType(mapType.values, withIssues), ">"]),
            enumType => withNullable(this.nameForNamedType(enumType)),
            unionType => {
                const maybeNullable = nullableFromUnion(unionType);
                if (maybeNullable === null) {
                    return "dynamic";
                }

                return withNullable(this.dartType(maybeNullable, withIssues));
            },
            transformedStringType => {
                switch (transformedStringType.kind) {
                    case "date-time":
                    case "date":
                        return withNullable("DateTime");
                    default:
                        return withNullable("String");
                }
            }
        );
    }

    protected mapList(isNullable: boolean, itemType: Sourcelike, list: Sourcelike, mapper: Sourcelike): Sourcelike {
        if (this._options.nullSafety && isNullable && !this._options.requiredProperties) {
            return [list, " == null ? [] : ", "List<", itemType, ">.from(", list, "!.map((x) => ", mapper, "))"];
        }

        return ["List<", itemType, ">.from(", list, ".map((x) => ", mapper, "))"];
    }

    protected mapMap(isNullable: boolean, valueType: Sourcelike, map: Sourcelike, valueMapper: Sourcelike): Sourcelike {
        if (this._options.nullSafety && isNullable && !this._options.requiredProperties) {
            return ["Map.from(", map, "!).map((k, v) => MapEntry<String, ", valueType, ">(k, ", valueMapper, "))"];
        }

        return ["Map.from(", map, ").map((k, v) => MapEntry<String, ", valueType, ">(k, ", valueMapper, "))"];
    }

    protected mapClass(isNullable: boolean, classType: ClassType, dynamic: Sourcelike): Sourcelike {
        if (this._options.nullSafety && isNullable && !this._options.requiredProperties) {
            return [
                dynamic,
                " == null ? null : ",
                this.nameForNamedType(classType),
                ".",
                this.fromJson,
                "(",
                dynamic,
                ")"
            ];
        }

        return [this.nameForNamedType(classType), ".", this.fromJson, "(", dynamic, ")"];
    }

    // FIXME: refactor this
    // If the first time is the unionType type, after nullableFromUnion conversion,
    // the isNullable property will become false, which is obviously wrong,
    // so add isNullable property
    // eslint-disable-next-line @typescript-eslint/default-param-last
    protected fromDynamicExpression(isNullable: boolean = false, t: Type, ...dynamic: Sourcelike[]): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => dynamic,
            _nullType => dynamic, // FIXME: check null
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => [dynamic, this._options.nullSafety ? "?.toDouble()" : ".toDouble()"],
            _stringType => dynamic,
            arrayType =>
                this.mapList(
                    isNullable || arrayType.isNullable,
                    this.dartType(arrayType.items),
                    dynamic,
                    this.fromDynamicExpression(arrayType.items.isNullable, arrayType.items, "x")
                ),
            classType => this.mapClass(isNullable || classType.isNullable, classType, dynamic),
            mapType =>
                this.mapMap(
                    mapType.isNullable || isNullable,
                    this.dartType(mapType.values),
                    dynamic,
                    this.fromDynamicExpression(mapType.values.isNullable, mapType.values, "v")
                ),
            enumType => {
                return [
                    defined(this._enumValues.get(enumType)),
                    ".map[",
                    dynamic,
                    this._options.nullSafety ? "]!" : "]"
                ];
            },
            unionType => {
                const maybeNullable = nullableFromUnion(unionType);
                if (maybeNullable === null) {
                    return dynamic;
                }

                return this.fromDynamicExpression(unionType.isNullable, maybeNullable, dynamic);
            },
            transformedStringType => {
                switch (transformedStringType.kind) {
                    case "date-time":
                    case "date":
                        if (
                            (transformedStringType.isNullable || isNullable) &&
                            !this._options.requiredProperties &&
                            this._options.nullSafety
                        ) {
                            return [dynamic, " == null ? null : ", "DateTime.parse(", dynamic, ")"];
                        }

                        return ["DateTime.parse(", dynamic, ")"];
                    default:
                        return dynamic;
                }
            }
        );
    }

    // FIXME: refactor this
    // If the first time is the unionType type, after nullableFromUnion conversion,
    // the isNullable property will become false, which is obviously wrong,
    // so add isNullable property
    // eslint-disable-next-line @typescript-eslint/default-param-last
    protected toDynamicExpression(isNullable: boolean = false, t: Type, ...dynamic: Sourcelike[]): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => dynamic,
            _nullType => dynamic,
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => dynamic,
            _stringType => dynamic,
            arrayType =>
                this.mapList(
                    arrayType.isNullable || isNullable,
                    "dynamic",
                    dynamic,
                    this.toDynamicExpression(arrayType.items.isNullable, arrayType.items, "x")
                ),
            _classType => {
                if (
                    this._options.nullSafety &&
                    (_classType.isNullable || isNullable) &&
                    !this._options.requiredProperties
                ) {
                    return [dynamic, "?.", this.toJson, "()"];
                }

                return [dynamic, ".", this.toJson, "()"];
            },
            mapType =>
                this.mapMap(
                    mapType.isNullable || isNullable,
                    "dynamic",
                    dynamic,
                    this.toDynamicExpression(mapType.values.isNullable, mapType.values, "v")
                ),
            enumType => {
                return [defined(this._enumValues.get(enumType)), ".reverse[", dynamic, "]"];
            },
            unionType => {
                const maybeNullable = nullableFromUnion(unionType);
                if (maybeNullable === null) {
                    return dynamic;
                }

                return this.toDynamicExpression(unionType.isNullable, maybeNullable, dynamic);
            },
            transformedStringType => {
                switch (transformedStringType.kind) {
                    case "date-time":
                        if (
                            this._options.nullSafety &&
                            !this._options.requiredProperties &&
                            (transformedStringType.isNullable || isNullable)
                        ) {
                            return [dynamic, "?.toIso8601String()"];
                        }

                        return [dynamic, ".toIso8601String()"];
                    case "date":
                        if (
                            this._options.nullSafety &&
                            !this._options.requiredProperties &&
                            (transformedStringType.isNullable || isNullable)
                        ) {
                            return [
                                '"${',
                                dynamic,
                                "!.year.toString().padLeft(4, '0')",
                                "}-${",
                                dynamic,
                                "!.month.toString().padLeft(2, '0')}-${",
                                dynamic,
                                "!.day.toString().padLeft(2, '0')}\""
                            ];
                        }

                        return [
                            '"${',
                            dynamic,
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

    private _emitEmptyConstructor(className: Name): void {
        this.emitLine(className, "();");
    }

    private _emitConstructor(c: ClassType, className: Name): void {
        this.emitLine(className, "({");
        this.indent(() => {
            this.forEachClassProperty(c, "none", (name, _, prop) => {
                const required =
                    this._options.requiredProperties ||
                    (this._options.nullSafety && (!prop.type.isNullable || !prop.isOptional));
                this.emitLine(required ? "required " : "", "this.", name, ",");
            });
        });
        this.emitLine("});");
        this.ensureBlankLine();
    }

    private _emitVariables(c: ClassType): void {
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const description = this.descriptionForClassProperty(c, jsonName);
            if (description !== undefined) {
                this.emitDescription(description);
            }

            if (this._options.useHive) {
                this.classPropertyCounter++;
                this.emitLine(`@HiveField(${this.classPropertyCounter})`);
            }

            if (this._options.useJsonAnnotation) {
                this.classPropertyCounter++;
                this.emitLine(`@JsonKey(name: "${jsonName}")`);
            }

            this.emitLine(this._options.finalProperties ? "final " : "", this.dartType(p.type, true), " ", name, ";");
        });
    }

    private _emitCopyConstructor(c: ClassType, className: Name): void {
        this.ensureBlankLine();
        this.emitLine(className, " copyWith({");
        this.indent(() => {
            this.forEachClassProperty(c, "none", (name, _, _p) => {
                this.emitLine(this.dartType(_p.type, true, true), " ", name, ",");
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

    private _emitStringJsonEncoderDecoder(className: Name): void {
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

    private _emitMapEncoderDecoder(c: ClassType, className: Name): void {
        this.ensureBlankLine();
        this.emitLine("factory ", className, ".", this.fromJson, "(Map<String, dynamic> json) => ", className, "(");
        this.indent(() => {
            this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                this.emitLine(
                    name,
                    ": ",
                    this.fromDynamicExpression(
                        property.type.isNullable,
                        property.type,
                        'json["',
                        stringEscape(jsonName),
                        '"]'
                    ),
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
                    this.toDynamicExpression(property.type.isNullable, property.type, name),
                    ","
                );
            });
        });
        this.emitLine("};");
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        if (this._options.useHive) {
            this.classCounter++;
            this.emitLine(`@HiveType(typeId: ${this.classCounter})`);
            this.classPropertyCounter = 0;
        }

        if (this._options.useJsonAnnotation) {
            this.emitLine("@JsonSerializable()");
        }

        this.emitBlock(["class ", className], () => {
            if (c.getProperties().size === 0) {
                this._emitEmptyConstructor(className);
            } else {
                this._emitVariables(c);
                this.ensureBlankLine();
                this._emitConstructor(c, className);
            }

            if (this._options.generateCopyWith) {
                this._emitCopyConstructor(c, className);
            }

            if (this._options.useJsonAnnotation) {
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

                this.ensureBlankLine();
                this.emitLine(
                    // Map<String, dynamic> toJson() => _$PublicAnswerToJson(this);
                    "Map<String, dynamic> toJson() => ",
                    "_$",
                    className,
                    "ToJson(this);"
                );
            } else {
                if (this._options.justTypes) return;

                if (this._options.codersInClass) {
                    this._emitStringJsonEncoderDecoder(className);
                }

                this._emitMapEncoderDecoder(c, className);
                // this.popFromParentStack();
            }
        });
    }

    private parentStack: string[] = []; // Stack to track parent names

    private pushToParentStack(typeName: string): void {
        this.parentStack.push(typeName);
        // console.log("Popping from stack:", this.parentStack);
    }

    private popFromParentStack(): void {
        // console.log("Poping from parent stack:", this.parentStack);
        const popped = this.parentStack.pop();

        // console.log("BC", popped)
        if (popped && popped.includes("_")) {
            // Split the string on underscores and take the last part
            // console.log("Removing", popped)
            const lastPart = popped.split("_").pop();
            // console.log("Removing", lastPart)
            if (lastPart) {
                this.parentStack.push(lastPart);
                // Push the last part back into the parent stack
            }
        } else {
            this.parentStack.push(popped ? popped : "parent");
        }
    }

    private isSimpleName(value: unknown): value is Name {
        return typeof value === "object" && value !== null && "_unstyledNames" in value;
    }

    private extractSimpleName(name: Name): string | null {
        if ("_unstyledNames" in name) {
            const unstyledNames = Array.from((name as any)._unstyledNames) as string[];
            if (unstyledNames.length > 0) {
                // console.log("Extracted Names:", unstyledNames);
                return unstyledNames[0]; // Pick the most relevant name
            }
        }

        return null;
    }

    private resolveTypeName(typeOrName: string | Name | Type): string {
        if (typeOrName instanceof ObjectType) {
            const namedType = this.nameForNamedType(typeOrName);
            if (namedType) {
                return this.extractSimpleName(namedType) ?? "UnnamedType";
            }

            return "UnnamedType";
        } else if (typeof typeOrName === "string") {
            return typeOrName;
        } else if (this.isSimpleName(typeOrName)) {
            return this.extractSimpleName(typeOrName) ?? "UnnamedType";
        }

        return "UnknownType";
    }

    private getNestedTypeName(typeName: string | Name): string {
        const parentPrefix = this.parentStack.join("_");
        const resolvedTypeName = this.resolveTypeName(typeName);
        return parentPrefix ? `${parentPrefix}_${resolvedTypeName}` : resolvedTypeName;
    }

    private getRequiredFieldsForClass(c: ClassType): Set<string> {
        const requiredFields = new Set<string>();

        // Iterate over the properties of the class
        c.getProperties().forEach((property, name) => {
            // A property is required if `isOptional` is false
            if (!property.isOptional) {
                requiredFields.add(name);
            }
        });

        return requiredFields;
    }

    protected emitFreezedClassDefinition(c: ClassType, className: Name): void {
        // Resolve the current class name with full parent prefix
        const resolvedClassName = this.getNestedTypeName(className);
        // console.log(className)
        // Push the resolved name to the parent stack
        this.pushToParentStack(resolvedClassName);

        // Emit the class definition
        this.emitLine("@freezed");
        this.emitBlock(["class ", resolvedClassName, " with _$", resolvedClassName], () => {
            if (c.getProperties().size === 0) {
                this.emitLine("const factory ", resolvedClassName, "() = _", resolvedClassName, ";");
            } else {
                this.emitLine("const factory ", resolvedClassName, "({");
                this.indent(() => {
                    // Check the required fields for this class
                    const requiredFields = this.getRequiredFieldsForClass(c);

                    this.popFromParentStack();
                    this.forEachClassProperty(c, "none", (name, jsonName, prop) => {
                        // Determine if this field is required
                        const isRequired = requiredFields.has(jsonName);

                        // Resolve nested type names correctly
                        let nestedTypeName;

                        if (prop.type instanceof ObjectType) {
                            nestedTypeName = this.getNestedTypeName(this.resolveTypeName(prop.type));
                        } else if (prop.type instanceof ArrayType && prop.type.items instanceof ObjectType) {
                            nestedTypeName = `List<${this.getNestedTypeName(this.resolveTypeName(prop.type.items))}>`;
                        } else if (prop.type instanceof MapType && prop.type.values instanceof ObjectType) {
                            nestedTypeName = `Map<String, ${this.getNestedTypeName(this.resolveTypeName(prop.type.values))}>`;
                        } else {
                            nestedTypeName = this.dartType(prop.type);
                        }

                        // Emit the field with or without `required` based on its necessity
                        this.emitLine(isRequired ? "required " : "", nestedTypeName, " ", name, ",");
                    });
                });
                this.emitLine("}) = _", resolvedClassName, ";");
            }

            this.ensureBlankLine();
            this.emitLine(
                "factory ",
                resolvedClassName,
                ".fromJson(Map<String, dynamic> json) => _$",
                resolvedClassName,
                "FromJson(json);"
            );
        });

        // Pop the parent name after finishing this class
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum ", enumName, " {");
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name, jsonName, pos) => {
                const comma = pos === "first" || pos === "middle" ? "," : [];
                if (this._options.useJsonAnnotation) {
                    this.emitLine('@JsonValue("', stringEscape(jsonName), '")');
                }

                this.emitLine(name, comma);
            });
        });
        this.emitLine("}");

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
        this.emitMultiline(`class EnumValues<T> {
	Map<String, T> map;
	late Map<T, String> reverseMap;

	EnumValues(this.map);

	Map<T, String> get reverse {
			reverseMap = map.map((k, v) => MapEntry(v, k));
			return reverseMap;
	}
}`);
    }

    private _emitTopLvlEncoderDecoder(): void {
        this.forEachTopLevel("leading-and-interposing", (t, name) => {
            const { encoder, decoder } = defined(this._topLevelDependents.get(name));

            this.emitLine(
                this.dartType(t),
                " ",
                decoder,
                "(String str) => ",
                this.fromDynamicExpression(t.isNullable, t, "json.decode(str)"),
                ";"
            );

            this.ensureBlankLine();

            this.emitLine(
                "String ",
                encoder,
                "(",
                this.dartType(t),
                " data) => json.encode(",
                this.toDynamicExpression(t.isNullable, t, "data"),
                ");"
            );

            // this.emitBlock(["String ", encoder, "(", this.dartType(t), " data)"], () => {
            //     this.emitJsonEncoderBlock(t);
            // });
        });
    }

    protected emitSourceStructure(): void {
        this.emitFileHeader();

        if (!this._options.justTypes && !this._options.codersInClass) {
            this._emitTopLvlEncoderDecoder();
        }

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) =>
                this._options.useFreezed ? this.emitFreezedClassDefinition(c, n) : this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (_e, _n) => {
                // We don't support this yet.
            }
        );

        if (this._needEnumValues) {
            this.emitEnumValues();
        }
        // this.popFromParentStack();
    }
}
