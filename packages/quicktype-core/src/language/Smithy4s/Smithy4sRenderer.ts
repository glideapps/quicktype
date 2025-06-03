import {
    anyTypeIssueAnnotation,
    nullTypeIssueAnnotation,
} from "../../Annotation";
import {
    ConvenienceRenderer,
    type ForbiddenWordsInfo,
} from "../../ConvenienceRenderer";
import { type Name, type Namer, funPrefixNamer } from "../../Naming";
import type { RenderContext } from "../../Renderer";
import type { OptionValues } from "../../RendererOptions";
import { type Sourcelike, maybeAnnotated } from "../../Source";
import type { TargetLanguage } from "../../TargetLanguage";
import {
    ArrayType,
    type ClassProperty,
    type ClassType,
    type EnumType,
    MapType,
    type ObjectType,
    type Type,
    type UnionType,
} from "../../Type";
import {
    matchCompoundType,
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils";

import { keywords } from "./constants";
import type { smithyOptions } from "./language";
import {
    lowerNamingFunction,
    scalaNameStyle,
    shouldAddBacktick,
    upperNamingFunction,
} from "./utils";

export class Smithy4sRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _scalaOptions: OptionValues<typeof smithyOptions>,
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(
        _: ObjectType,
        _classNamed: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(
        _: EnumType,
        _enumName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
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
        return funPrefixNamer("upper", (s) => s.replace(" ", "")); // TODO - add backticks where appropriate
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

    protected anySourceType(_: boolean): Sourcelike {
        return ["Document"];
    }

    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    protected arrayType(arrayType: ArrayType, _ = false): Sourcelike {
        // this.emitTopLevelArray(arrayType, new Name(arrayType.getCombinedName().toString() + "List"))
        return arrayType.getCombinedName().toString() + "List";
    }

    protected emitArrayType(_: ArrayType, smithyType: Sourcelike): void {
        this.emitLine(["list ", smithyType, " { member : ", "}"]);
    }

    protected mapType(mapType: MapType, _ = false): Sourcelike {
        return mapType.getCombinedName().toString() + "Map";
        // return [this.scalaType(mapType.values, withIssues), "Map"];
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
                    return [this.scalaType(nullable, withIssues)];
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
        this.emitLine('$version: "2"');
        this.emitLine("namespace ", this._scalaOptions.packageName);
        this.ensureBlankLine();

        this.emitLine("document NullValue");
        this.ensureBlankLine();
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.scalaType(t.items);
        this.emitLine(["list ", name, " { member : ", elementType, "}"]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.scalaType(t.values);
        this.emitLine([
            "map ",
            name,
            " { map[ key : String , value : ",
            elementType,
            "}",
        ]);
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("structure ", className, "{}");
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }

        const scalaType = (p: ClassProperty): Sourcelike => {
            if (p.isOptional) {
                return [this.scalaType(p.type, true, true)];
            }

            return [this.scalaType(p.type, true)];
        };

        const emitLater: ClassProperty[] = [];

        this.emitDescription(this.descriptionForType(c));
        this.emitLine("structure ", className, " {");
        this.indent(() => {
            let count = c.getProperties().size;
            let first = true;

            this.forEachClassProperty(c, "none", (_, jsonName, p) => {
                const nullable =
                    p.type.kind === "union" &&
                    nullableFromUnion(p.type as UnionType) !== null;
                const nullableOrOptional =
                    p.isOptional || p.type.kind === "null" || nullable;
                const last = --count === 0;
                const meta: Array<() => void> = [];

                const laterType =
                    p.type.kind === "array" || p.type.kind === "map";
                if (laterType) {
                    emitLater.push(p);
                }

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

                const nameNeedsBackticks =
                    jsonName.endsWith("_") || shouldAddBacktick(jsonName);
                const nameWithBackticks = nameNeedsBackticks
                    ? "`" + jsonName + "`"
                    : jsonName;
                this.emitLine(
                    p.isOptional ? "" : nullableOrOptional ? "" : "@required ",
                    nameWithBackticks,
                    " : ",
                    scalaType(p),

                    last ? "" : ",",
                );

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });
        this.emitClassDefinitionMethods(emitLater);
    }

    protected emitClassDefinitionMethods(arrayTypes: ClassProperty[]): void {
        this.emitLine("}");
        arrayTypes.forEach((p) => {
            function ignore<T extends Type>(_: T): void {
                return;
            }

            matchCompoundType(
                p.type,
                (at) => {
                    this.emitLine([
                        "list ",
                        this.scalaType(at, true),
                        "{ member: ",
                        this.scalaType(at.items, true),
                        "}",
                    ]);
                },
                ignore,
                (mt) => {
                    this.emitLine([
                        "map ",
                        this.scalaType(mt, true),
                        "{ key: String , value: ",
                        this.scalaType(mt.values, true),
                        "}",
                    ]);
                },
                ignore,
                ignore,
            );
        });
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.ensureBlankLine();
        this.emitItem(["enum ", enumName, " { "]);
        let count = e.cases.size;

        this.forEachEnumCase(e, "none", (name, jsonName) => {
            // if (!(jsonName == "")) {
            /*                 const backticks = 
																	shouldAddBacktick(jsonName) || 
																	jsonName.includes(" ") || 
																	!isNaN(parseInt(jsonName.charAt(0)))
															if (backticks) {this.emitItem("`")} else  */
            this.emitLine();

            this.emitItem([name, ' = "', jsonName, '"']);

            //                if (backticks) {this.emitItem("`")}
            if (--count > 0) this.emitItem([","]);
            // } else {
            // --count
            // }
        });

        this.ensureBlankLine();
        this.emitItem(["}"]);
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return `_${kind}`;
        }

        const emitLater: Type[] = [];

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        const theTypes: Sourcelike[] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
            const laterType = t.kind === "array" || t.kind === "map";
            if (laterType) {
                emitLater.push(t);
            }

            theTypes.push(this.scalaType(t));
        });
        if (maybeNull !== null) {
            theTypes.push(this.nameForUnionMember(u, maybeNull));
        }

        this.emitLine(["@untagged union ", unionName, " { "]);
        this.indent(() => {
            theTypes.forEach((t, i) => {
                this.emitLine([String.fromCharCode(i + 65), " : ", t]);
            });
        });
        this.emitLine("}");
        this.ensureBlankLine();

        emitLater.forEach((p) => {
            function ignore<T extends Type>(_: T): void {
                return;
            }

            matchCompoundType(
                p,
                (at) => {
                    this.emitLine([
                        "list ",
                        this.scalaType(at, true),
                        "{ member: ",
                        this.scalaType(at.items, true),
                        "}",
                    ]);
                },
                ignore,
                (mt) => {
                    this.emitLine([
                        "map ",
                        this.scalaType(mt, true),
                        "{ key: String , value: ",
                        this.scalaType(mt.values, true),
                        "}",
                    ]);
                },
                ignore,
                ignore,
            );
        });
    }

    protected emitSourceStructure(): void {
        this.emitHeader();

        // Top-level arrays, maps
        this.forEachTopLevel("leading", (t, name) => {
            if (t instanceof ArrayType) {
                this.emitTopLevelArray(t, name);
            } else if (t instanceof MapType) {
                this.emitTopLevelMap(t, name);
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
