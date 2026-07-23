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
import type { TargetLanguage } from "../../TargetLanguage.js";
import {
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils.js";
import {
    ArrayType,
    type ClassProperty,
    type ClassType,
    type EnumType,
    MapType,
    type ObjectType,
    type Type,
    type UnionType,
} from "../../Type/index.js";

import {
    forbiddenPropertyNames,
    forbiddenTypeNames,
    keywords,
} from "./constants.js";
import type { scala3Options } from "./language.js";
import {
    backtickedName,
    enumCaseNameStyle,
    lowerNamingFunction,
    propertyNameNeedsMapping,
    scalaNameStyle,
    upperNamingFunction,
    wrapOption,
} from "./utils.js";

export class Scala3Renderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _scalaOptions: OptionValues<typeof scala3Options>,
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return [...keywords, ...forbiddenTypeNames];
    }

    protected forbiddenForObjectProperties(
        _: ObjectType,
        _classNamed: Name,
    ): ForbiddenWordsInfo {
        return {
            names: [...keywords, ...forbiddenPropertyNames],
            includeGlobalForbidden: false,
        };
    }

    protected forbiddenForEnumCases(
        _: EnumType,
        _enumName: Name,
    ): ForbiddenWordsInfo {
        return { names: ["_", ...keywords], includeGlobalForbidden: false };
    }

    protected forbiddenForUnionMembers(
        _u: UnionType,
        _unionName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected topLevelNameStyle(rawName: string): string {
        return scalaNameStyle(true, rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return lowerNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer(
            "upper",
            (s) => `${scalaNameStyle(true, s)}Value`,
        );
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("upper", enumCaseNameStyle);
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
        delimiter: "curly" | "paren" | "lambda" | "none" = "curly",
    ): void {
        const [open, close] =
            delimiter === "curly"
                ? ["{", "}"]
                : delimiter === "paren"
                  ? ["(", ")"]
                  : delimiter === "none"
                    ? ["", ""]
                    : ["{", "})"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }

    protected anySourceType(optional: boolean): Sourcelike {
        return [wrapOption("Any", optional)];
    }

    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    protected arrayType(arrayType: ArrayType, withIssues = false): Sourcelike {
        return ["Seq[", this.scalaType(arrayType.items, withIssues), "]"];
    }

    protected mapType(mapType: MapType, withIssues = false): Sourcelike {
        return [
            "Map[String, ",
            this.scalaType(mapType.values, withIssues),
            "]",
        ];
    }

    protected scalaType(
        t: Type,
        withIssues = false,
        noOptional = false,
    ): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => {
                return maybeAnnotated(
                    withIssues,
                    anyTypeIssueAnnotation,
                    this.anySourceType(!noOptional),
                );
            },
            (_nullType) => {
                // return "None.type"
                return maybeAnnotated(
                    withIssues,
                    nullTypeIssueAnnotation,
                    this.anySourceType(!noOptional),
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
                if (nullable !== null) {
                    if (noOptional) {
                        return [this.scalaType(nullable, withIssues)];
                    }

                    return [
                        "Option[",
                        this.scalaType(nullable, withIssues),
                        "]",
                    ];
                }

                return this.nameForNamedType(unionType);
            },
        );
    }

    protected emitUsageHeader(): void {
        // To be overridden
    }

    protected emitHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else {
            this.emitUsageHeader();
        }

        this.ensureBlankLine();
        this.emitLine("package ", this._scalaOptions.packageName);
        this.ensureBlankLine();
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.scalaType(t.items);
        this.emitLine(["type ", name, " = List[", elementType, "]"]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.scalaType(t.values);
        this.emitLine(["type ", name, " = Map[String, ", elementType, "]"]);
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("case class ", className, "()");
    }

    protected emitPropertyAnnotation(_name: Name, _jsonName: string): void {
        // Overridden by frameworks that support property rename annotations.
    }

    protected emitClassDefinitionPostamble(
        _c: ClassType,
        _className: Name,
    ): void {
        // Overridden by frameworks that need to emit custom codecs.
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }

        const scalaType = (p: ClassProperty): Sourcelike => {
            if (p.isOptional) {
                return ["Option[", this.scalaType(p.type, true, true), "]"];
            }

            return this.scalaType(p.type, true);
        };

        this.emitDescription(this.descriptionForType(c));
        this.emitLine("case class ", className, " (");
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

                if (meta.length > 0 && !first) {
                    this.ensureBlankLine();
                }

                for (const emit of meta) {
                    emit();
                }

                this.emitPropertyAnnotation(name, jsonName);
                this.emitLine(
                    "val ",
                    propertyNameNeedsMapping(jsonName)
                        ? name
                        : backtickedName(jsonName),
                    " : ",
                    scalaType(p),
                    p.isOptional
                        ? " = None"
                        : nullableOrOptional
                          ? " = None"
                          : "",
                    last ? "" : ",",
                );

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });

        this.emitClassDefinitionMethods(c, className);
        this.emitClassDefinitionPostamble(c, className);
    }

    protected emitClassDefinitionMethods(
        _c: ClassType,
        _className: Name,
    ): void {
        this.emitLine(")");
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(
            ["enum ", enumName, " : "],
            () => {
                this.forEachEnumCase(e, "none", (name) => {
                    this.emitLine("case ", name);
                });
            },
            "none",
        );
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return `_${kind}`;
        }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        const theTypes: Sourcelike[] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
            theTypes.push(this.scalaType(t));
        });
        if (maybeNull !== null) {
            theTypes.push(this.nameForUnionMember(u, maybeNull));
        }

        this.emitItem(["type ", unionName, " = "]);
        theTypes.forEach((t, i) => {
            this.emitItem(i === 0 ? t : [" | ", t]);
        });
        this.ensureBlankLine();
    }

    protected emitSourceStructure(): void {
        this.emitHeader();

        // Top-level arrays, maps, and primitives
        this.forEachTopLevel("leading", (t, name) => {
            if (t instanceof ArrayType) {
                this.emitTopLevelArray(t, name);
            } else if (t instanceof MapType) {
                this.emitTopLevelMap(t, name);
            } else if (t.isPrimitive()) {
                this.emitLine(["type ", name, " = ", this.scalaType(t)]);
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
