import { arrayIntercalate } from "collection-utils";

import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../../Annotation";
import { ConvenienceRenderer, type ForbiddenWordsInfo } from "../../ConvenienceRenderer";
import { type Name, type Namer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, maybeAnnotated } from "../../Source";
import { assert } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import { followTargetType } from "../../Transformers";
import { type ClassProperty, type ClassType, type EnumType, type Type, type UnionType } from "../../Type";
import { directlyReachableSingleNamedType, matchType, nullableFromUnion, removeNullFromUnion } from "../../TypeUtils";

import { type cSharpOptions } from "./language";
import {
    AccessModifier,
    csTypeForTransformedStringType,
    isValueType,
    namingFunction,
    namingFunctionKeep,
    noFollow
} from "./utils";

export class CSharpRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _csOptions: OptionValues<typeof cSharpOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["QuickType", "Type", "System", "Console", "Exception", "DateTimeOffset", "Guid", "Uri"];
    }

    protected forbiddenForObjectProperties(_: ClassType, classNamed: Name): ForbiddenWordsInfo {
        return {
            names: [
                classNamed,
                "ToString",
                "GetHashCode",
                "Finalize",
                "Equals",
                "GetType",
                "MemberwiseClone",
                "ReferenceEquals"
            ],
            includeGlobalForbidden: false
        };
    }

    protected forbiddenForUnionMembers(_: UnionType, unionNamed: Name): ForbiddenWordsInfo {
        return { names: [unionNamed], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return this._csOptions.keepPropertyName ? namingFunctionKeep : namingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return namingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return namingFunction;
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

    protected emitBlock(f: () => void, semicolon = false): void {
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}", semicolon ? ";" : "");
    }

    protected get doubleType(): string {
        return this._csOptions.useDecimal ? "decimal" : "double";
    }

    protected csType(t: Type, follow: (t: Type) => Type = followTargetType, withIssues = false): Sourcelike {
        const actualType = follow(t);
        return matchType<Sourcelike>(
            actualType,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, this._csOptions.typeForAny),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, this._csOptions.typeForAny),
            _boolType => "bool",
            _integerType => "long",
            _doubleType => this.doubleType,
            _stringType => "string",
            arrayType => {
                const itemsType = this.csType(arrayType.items, follow, withIssues);
                if (this._csOptions.useList) {
                    return ["List<", itemsType, ">"];
                } else {
                    return [itemsType, "[]"];
                }
            },
            classType => this.nameForNamedType(classType),
            mapType => ["Dictionary<string, ", this.csType(mapType.values, follow, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.nullableCSType(nullable, noFollow);
                return this.nameForNamedType(unionType);
            },
            transformedStringType => csTypeForTransformedStringType(transformedStringType)
        );
    }

    protected nullableCSType(t: Type, follow: (t: Type) => Type = followTargetType, withIssues = false): Sourcelike {
        t = followTargetType(t);
        const csType = this.csType(t, follow, withIssues);
        if (isValueType(t) || this._csOptions.version >= 8) {
            return [csType, "?"];
        } else {
            return csType;
        }
    }

    protected baseclassForType(_t: Type): Sourcelike | undefined {
        return undefined;
    }

    protected emitType(
        description: string[] | undefined,
        accessModifier: AccessModifier,
        declaration: Sourcelike,
        name: Sourcelike,
        baseclass: Sourcelike | undefined,
        emitter: () => void
    ): void {
        switch (accessModifier) {
            case AccessModifier.Public:
                declaration = ["public ", declaration];
                break;
            case AccessModifier.Internal:
                declaration = ["internal ", declaration];
                break;
            default:
                break;
        }

        this.emitDescription(description);
        if (baseclass === undefined) {
            this.emitLine(declaration, " ", name);
        } else {
            this.emitLine(declaration, " ", name, " : ", baseclass);
        }

        this.emitBlock(emitter);
    }

    protected attributesForProperty(
        _property: ClassProperty,
        _name: Name,
        _c: ClassType,
        _jsonName: string
    ): Sourcelike[] | undefined {
        return undefined;
    }

    protected propertyDefinition(property: ClassProperty, name: Name, _c: ClassType, _jsonName: string): Sourcelike {
        const t = property.type;
        const csType = property.isOptional
            ? this.nullableCSType(t, followTargetType, true)
            : this.csType(t, followTargetType, true);

        const propertyArray = ["public "];

        if (this._csOptions.virtual) propertyArray.push("virtual ");

        return [...propertyArray, csType, " ", name, " { get; set; }"];
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        const start = "/// <summary>";
        if (this._csOptions.dense) {
            this.emitLine(start, lines.join("; "), "</summary>");
        } else {
            this.emitCommentLines(lines, { lineStart: "/// ", beforeComment: start, afterComment: "/// </summary>" });
        }
    }

    protected blankLinesBetweenAttributes(): boolean {
        return false;
    }

    private emitClassDefinition(c: ClassType, className: Name): void {
        this.emitType(
            this.descriptionForType(c),
            AccessModifier.Public,
            "partial class",
            className,
            this.baseclassForType(c),
            () => {
                if (c.getProperties().size === 0) return;
                const blankLines = this.blankLinesBetweenAttributes() ? "interposing" : "none";
                let columns: Sourcelike[][] = [];
                let isFirstProperty = true;
                let previousDescription: string[] | undefined = undefined;
                this.forEachClassProperty(c, blankLines, (name, jsonName, p) => {
                    const attributes = this.attributesForProperty(p, name, c, jsonName);
                    const description = this.descriptionForClassProperty(c, jsonName);
                    const property = this.propertyDefinition(p, name, c, jsonName);
                    if (attributes === undefined) {
                        if (
                            // Descriptions should be preceded by an empty line
                            (!isFirstProperty && description !== undefined) ||
                            // If the previous property has a description, leave an empty line
                            previousDescription !== undefined
                        ) {
                            this.ensureBlankLine();
                        }

                        this.emitDescription(description);
                        this.emitLine(property);
                    } else if (this._csOptions.dense && attributes.length > 0) {
                        const comment = description === undefined ? "" : ` // ${description.join("; ")}`;
                        columns.push([attributes, " ", property, comment]);
                    } else {
                        this.emitDescription(description);
                        for (const attribute of attributes) {
                            this.emitLine(attribute);
                        }

                        this.emitLine(property);
                    }

                    isFirstProperty = false;
                    previousDescription = description;
                });
                if (columns.length > 0) {
                    this.emitTable(columns);
                }
            }
        );
    }

    private emitUnionDefinition(u: UnionType, unionName: Name): void {
        const nonNulls = removeNullFromUnion(u, true)[1];
        this.emitType(
            this.descriptionForType(u),
            AccessModifier.Public,
            "partial struct",
            unionName,
            this.baseclassForType(u),
            () => {
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                    const csType = this.nullableCSType(t);
                    this.emitLine("public ", csType, " ", fieldName, ";");
                });
                this.ensureBlankLine();
                const nullTests: Sourcelike[] = Array.from(nonNulls).map(t => [
                    this.nameForUnionMember(u, t),
                    " == null"
                ]);
                this.ensureBlankLine();
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                    const csType = this.csType(t);
                    this.emitExpressionMember(
                        ["public static implicit operator ", unionName, "(", csType, " ", fieldName, ")"],
                        ["new ", unionName, " { ", fieldName, " = ", fieldName, " }"]
                    );
                });
                if (u.findMember("null") === undefined) return;
                this.emitExpressionMember("public bool IsNull", arrayIntercalate(" && ", nullTests), true);
            }
        );
    }

    private emitEnumDefinition(e: EnumType, enumName: Name): void {
        const caseNames: Sourcelike[] = [];
        this.forEachEnumCase(e, "none", name => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("public enum ", enumName, " { ", caseNames, " };");
    }

    protected emitExpressionMember(declare: Sourcelike, define: Sourcelike, isProperty = false): void {
        if (this._csOptions.version === 5) {
            this.emitLine(declare);
            this.emitBlock(() => {
                const stmt = ["return ", define, ";"];
                if (isProperty) {
                    this.emitLine("get");
                    this.emitBlock(() => this.emitLine(stmt));
                } else {
                    this.emitLine(stmt);
                }
            });
        } else {
            this.emitLine(declare, " => ", define, ";");
        }
    }

    protected emitTypeSwitch<T extends Sourcelike>(
        types: Iterable<T>,
        condition: (t: T) => Sourcelike,
        withBlock: boolean,
        withReturn: boolean,
        f: (t: T) => void
    ): void {
        assert(!withReturn || withBlock, "Can only have return with block");
        for (const t of types) {
            this.emitLine("if (", condition(t), ")");
            if (withBlock) {
                this.emitBlock(() => {
                    f(t);
                    if (withReturn) {
                        this.emitLine("return;");
                    }
                });
            } else {
                this.indent(() => f(t));
            }
        }
    }

    protected emitUsing(ns: Sourcelike): void {
        this.emitLine("using ", ns, ";");
    }

    protected emitUsings(): void {
        for (const ns of ["System", "System.Collections.Generic"]) {
            this.emitUsing(ns);
        }
    }

    protected emitRequiredHelpers(): void {
        return;
    }

    private emitTypesAndSupport(): void {
        this.forEachObject("leading-and-interposing", (c: ClassType, name: Name) => this.emitClassDefinition(c, name));
        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnionDefinition(u, name));
        this.emitRequiredHelpers();
    }

    protected emitDefaultLeadingComments(): void {
        return;
    }

    protected emitDefaultFollowingComments(): void {
        return;
    }

    protected needNamespace(): boolean {
        return true;
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else {
            this.emitDefaultLeadingComments();
        }

        this.ensureBlankLine();
        if (this.needNamespace()) {
            this.emitLine("namespace ", this._csOptions.namespace);
            this.emitBlock(() => {
                this.emitUsings();
                this.emitTypesAndSupport();
            });
        } else {
            this.emitUsings();
            this.emitTypesAndSupport();
        }

        this.emitDefaultFollowingComments();
    }
}
