import { iterableSome } from "collection-utils";

import {
    anyTypeIssueAnnotation,
    nullTypeIssueAnnotation,
} from "../../Annotation.js";
import {
    ConvenienceRenderer,
    type ForbiddenWordsInfo,
} from "../../ConvenienceRenderer.js";
import { type Name, type Namer, funPrefixNamer } from "../../Naming.js";
import type { RenderContext } from "../../Renderer.js";
import type { OptionValues } from "../../RendererOptions/index.js";
import { type Sourcelike, maybeAnnotated } from "../../Source.js";
import { acronymStyle } from "../../support/Acronyms.js";
import type { TargetLanguage } from "../../TargetLanguage.js";
import {
    ArrayType,
    type ClassProperty,
    type ClassType,
    type EnumType,
    MapType,
    type ObjectType,
    PrimitiveType,
    type Type,
    type UnionType,
} from "../../Type/index.js";
import {
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils.js";

import { keywords } from "./constants.js";
import type { kotlinOptions } from "./language.js";
import { kotlinNameStyle, stringEscape } from "./utils.js";

export class KotlinRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _kotlinOptions: OptionValues<typeof kotlinOptions>,
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(
        _o: ObjectType,
        _classNamed: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(
        _e: EnumType,
        enumName: Name,
    ): ForbiddenWordsInfo {
        return { names: [enumName], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(
        _u: UnionType,
        _unionName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected topLevelNameStyle(rawName: string): string {
        return kotlinNameStyle(true, rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("upper", (s) =>
            kotlinNameStyle(
                true,
                s,
                acronymStyle(this._kotlinOptions.acronymStyle),
            ),
        );
    }

    protected namerForObjectProperty(): Namer {
        return funPrefixNamer("lower", (s) =>
            kotlinNameStyle(
                false,
                s,
                acronymStyle(this._kotlinOptions.acronymStyle),
            ),
        );
    }

    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer(
            "upper",
            (s) => `${kotlinNameStyle(true, s)}Value`,
        );
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("upper", (s) =>
            kotlinNameStyle(
                true,
                s,
                acronymStyle(this._kotlinOptions.acronymStyle),
            ),
        );
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, {
            lineStart: " * ",
            beforeComment: "/**",
            afterComment: " */",
        });
    }

    protected emitBlock(
        line: Sourcelike,
        f: () => void,
        delimiter: "curly" | "paren" | "lambda" = "curly",
    ): void {
        const [open, close] =
            delimiter === "curly"
                ? ["{", "}"]
                : delimiter === "paren"
                  ? ["(", ")"]
                  : ["{", "})"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }

    protected anySourceType(optional: string): Sourcelike {
        return ["Any", optional];
    }

    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    protected arrayType(
        arrayType: ArrayType,
        withIssues = false,
        _noOptional = false,
    ): Sourcelike {
        return ["List<", this.kotlinType(arrayType.items, withIssues), ">"];
    }

    protected mapType(
        mapType: MapType,
        withIssues = false,
        _noOptional = false,
    ): Sourcelike {
        return [
            "Map<String, ",
            this.kotlinType(mapType.values, withIssues),
            ">",
        ];
    }

    protected haveTransformedStringType(
        kind: "date-time" | "date" | "time",
    ): boolean {
        return iterableSome(
            this.typeGraph.allTypesUnordered(),
            (t) => t instanceof PrimitiveType && t.kind === kind,
        );
    }

    protected kotlinType(
        t: Type,
        withIssues = false,
        noOptional = false,
    ): Sourcelike {
        const optional = noOptional ? "" : "?";
        return matchType<Sourcelike>(
            t,
            (_anyType) => {
                return maybeAnnotated(
                    withIssues,
                    anyTypeIssueAnnotation,
                    this.anySourceType(optional),
                );
            },
            (_nullType) => {
                return maybeAnnotated(
                    withIssues,
                    nullTypeIssueAnnotation,
                    this.anySourceType(optional),
                );
            },
            (_boolType) => "Boolean",
            (_integerType) => "Long",
            (_doubleType) => "Double",
            (_stringType) => "String",
            (arrayType) => this.arrayType(arrayType, withIssues),
            (classType) => this.nameForNamedType(classType),
            (mapType) => this.mapType(mapType, withIssues),
            (enumType) => this.nameForNamedType(enumType),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null)
                    return [this.kotlinType(nullable, withIssues), optional];
                return this.nameForNamedType(unionType);
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    return "OffsetDateTime";
                }

                if (transformedStringType.kind === "date") {
                    return "LocalDate";
                }

                if (transformedStringType.kind === "time") {
                    return "OffsetTime";
                }

                return "String";
            },
        );
    }

    protected emitUsageHeader(): void {
        // To be overridden
    }

    // Emitted between the usage header and the package declaration —
    // the only place Kotlin allows `@file:`-targeted annotations.
    protected emitFileAnnotations(): void {
        // To be overridden
    }

    protected emitHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else {
            this.emitUsageHeader();
        }

        this.ensureBlankLine();
        this.emitFileAnnotations();
        this.emitLine("package ", this._kotlinOptions.packageName);
        this.ensureBlankLine();

        // Check if we need to import java.time classes
        const usesDateTime = this.haveTransformedStringType("date-time");
        const usesDate = this.haveTransformedStringType("date");
        const usesTime = this.haveTransformedStringType("time");

        if (usesDateTime) {
            this.emitLine("import java.time.OffsetDateTime");
        }

        if (usesDate) {
            this.emitLine("import java.time.LocalDate");
        }

        if (usesTime) {
            this.emitLine("import java.time.OffsetTime");
        }

        if (usesDateTime || usesDate || usesTime) {
            this.ensureBlankLine();
        }
    }

    protected emitTopLevelPrimitive(t: PrimitiveType, name: Name): void {
        const elementType = this.kotlinType(t);
        this.emitLine(["typealias ", name, " = ", elementType, ""]);
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitLine(["typealias ", name, " = ArrayList<", elementType, ">"]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.kotlinType(t.values);
        this.emitLine([
            "typealias ",
            name,
            " = HashMap<String, ",
            elementType,
            ">",
        ]);
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitClassAnnotations(c, className);
        this.emitLine("class ", className, "()");
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }

        const kotlinType = (p: ClassProperty): Sourcelike => {
            if (p.isOptional) {
                return [this.kotlinType(p.type, true, true), "?"];
            }

            return this.kotlinType(p.type, true);
        };

        this.emitDescription(this.descriptionForType(c));
        this.emitClassAnnotations(c, className);
        this.emitLine("data class ", className, " (");
        this.indent(() => {
            let count = c.getProperties().size;
            let first = true;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const nullable =
                    p.type.kind === "union" &&
                    nullableFromUnion(p.type as UnionType) !== null;
                const nullableOrOptional =
                    p.isOptional || p.type.kind === "null" || nullable;
                const last = --count === 0;
                const meta: Array<() => void> = [];

                const description = this.descriptionForClassProperty(
                    c,
                    jsonName,
                );
                if (description !== undefined) {
                    meta.push(() => this.emitDescription(description));
                }

                this.renameAttribute(
                    name,
                    jsonName,
                    !nullableOrOptional,
                    meta,
                    p,
                );

                if (meta.length > 0 && !first) {
                    this.ensureBlankLine();
                }

                for (const emit of meta) {
                    emit();
                }

                this.emitLine(
                    "val ",
                    name,
                    ": ",
                    kotlinType(p),
                    nullableOrOptional ? " = null" : "",
                    last ? "" : ",",
                );

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });

        this.emitClassDefinitionMethods(c, className);
    }

    protected emitClassDefinitionMethods(
        _c: ClassType,
        _className: Name,
    ): void {
        this.emitLine(")");
    }

    protected emitClassAnnotations(_c: Type, _className: Name): void {
        // to be overridden
    }

    protected renameAttribute(
        _name: Name,
        _jsonName: string,
        _required: boolean,
        _meta: Array<() => void>,
        _p: ClassProperty,
    ): void {
        // to be overridden
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                this.emitLine(
                    name,
                    `("${stringEscape(json)}")`,
                    --count === 0 ? ";" : ",",
                );
            });
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitBlock(
                    [
                        "fun fromValue(value: String): ",
                        enumName,
                        " = when (value)",
                    ],
                    () => {
                        const table: Sourcelike[][] = [];
                        this.forEachEnumCase(e, "none", (name, json) => {
                            table.push([
                                [`"${stringEscape(json)}"`],
                                [" -> ", name],
                            ]);
                        });
                        table.push([
                            ["else"],
                            [" -> throw IllegalArgumentException()"],
                        ]);
                        this.emitTable(table);
                    },
                );
            });
        });
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return `_${kind}`;
        }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        this.emitClassAnnotations(u, unionName);
        this.emitBlock(["sealed class ", unionName], () => {
            {
                const table: Sourcelike[][] = [];
                this.forEachUnionMember(
                    u,
                    nonNulls,
                    "none",
                    null,
                    (name, t) => {
                        table.push([
                            [
                                "class ",
                                name,
                                "(val value: ",
                                this.kotlinType(t),
                                ")",
                            ],
                            [" : ", unionName, "()"],
                        ]);
                    },
                );
                if (maybeNull !== null) {
                    table.push([
                        ["class ", this.nameForUnionMember(u, maybeNull), "()"],
                        [" : ", unionName, "()"],
                    ]);
                }

                this.emitTable(table);
            }

            this.emitUnionDefinitionMethods(u, nonNulls, maybeNull, unionName);
        });
    }

    protected emitUnionDefinitionMethods(
        _u: UnionType,
        _nonNulls: ReadonlySet<Type>,
        _maybeNull: PrimitiveType | null,
        _unionName: Name,
    ): void {
        // to be overridden
    }

    protected emitSourceStructure(): void {
        this.emitHeader();

        // Top-level arrays, maps
        this.forEachTopLevel("leading", (t, name) => {
            if (t instanceof ArrayType) {
                this.emitTopLevelArray(t, name);
            } else if (t instanceof MapType) {
                this.emitTopLevelMap(t, name);
            } else if (t.isPrimitive()) {
                this.emitTopLevelPrimitive(t, name);
            }
        });

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n),
        );
    }
}
