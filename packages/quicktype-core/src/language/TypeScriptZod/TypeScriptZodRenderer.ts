import { arrayIntercalate } from "collection-utils";

import { ConvenienceRenderer } from "../../ConvenienceRenderer";
import { type Name, type Namer, funPrefixNamer } from "../../Naming";
import type { RenderContext } from "../../Renderer";
import type { OptionValues } from "../../RendererOptions";
import type { Sourcelike } from "../../Source";
import { AcronymStyleOptions, acronymStyle } from "../../support/Acronyms";
import {
    allLowerWordStyle,
    capitalize,
    combineWords,
    firstUpperWordStyle,
    isLetterOrUnderscore,
    splitIntoWords,
    stringEscape,
    utf16StringEscape,
} from "../../support/Strings";
import { panic } from "../../support/Support";
import type { TargetLanguage } from "../../TargetLanguage";
import {
    ArrayType,
    type ClassProperty,
    ClassType,
    type EnumType,
    ObjectType,
    SetOperationType,
    type Type,
} from "../../Type";
import { matchType } from "../../Type/TypeUtils";
import { legalizeName } from "../JavaScript/utils";

import type { typeScriptZodOptions } from "./language";

export class TypeScriptZodRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _options: OptionValues<typeof typeScriptZodOptions>,
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return ["Class", "Date", "Object", "String", "Array", "JSON", "Error"];
    }

    protected nameStyle(original: string, upper: boolean): string {
        const acronyms = acronymStyle(AcronymStyleOptions.Camel);
        const words = splitIntoWords(original);
        return combineWords(
            words,
            legalizeName,
            upper ? firstUpperWordStyle : allLowerWordStyle,
            firstUpperWordStyle,
            upper ? (s): string => capitalize(acronyms(s)) : allLowerWordStyle,
            acronyms,
            "",
            isLetterOrUnderscore,
        );
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", (s) => this.nameStyle(s, true));
    }

    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer("properties", (s) => this.nameStyle(s, true));
    }

    protected namerForObjectProperty(): Namer {
        return funPrefixNamer("properties", (s) => this.nameStyle(s, true));
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-cases", (s) => this.nameStyle(s, false));
    }

    protected importStatement(
        lhs: Sourcelike,
        moduleName: Sourcelike,
    ): Sourcelike {
        return ["import ", lhs, " from ", moduleName, ";"];
    }

    protected emitImports(): void {
        this.ensureBlankLine();
        this.emitLine(this.importStatement("* as z", '"zod"'));
    }

    protected typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        const typeMap = this.typeMapTypeFor(p.type);
        return p.isOptional ? [typeMap, ".optional()"] : typeMap;
    }

    protected typeMapTypeFor(t: Type, required = true): Sourcelike {
        if (["class", "object", "enum"].includes(t.kind)) {
            return [this.nameForNamedType(t), "Schema"];
        }

        const match = matchType<Sourcelike>(
            t,
            (_anyType) => "z.any()",
            (_nullType) => "z.null()",
            (_boolType) => "z.boolean()",
            (_integerType) => "z.number()",
            (_doubleType) => "z.number()",
            (_stringType) => "z.string()",
            (arrayType) => [
                "z.array(",
                this.typeMapTypeFor(arrayType.items, false),
                ")",
            ],
            (_classType) => panic("Should already be handled."),
            (_mapType) => [
                "z.record(z.string(), ",
                this.typeMapTypeFor(_mapType.values, false),
                ")",
            ],
            (_enumType) => panic("Should already be handled."),
            (unionType) => {
                const children = Array.from(unionType.getChildren()).map(
                    (type: Type) => this.typeMapTypeFor(type, false),
                );
                return ["z.union([", ...arrayIntercalate(", ", children), "])"];
            },
            (_transformedStringType) => {
                if (_transformedStringType.kind === "date-time") {
                    return "z.coerce.date()";
                }

                return "z.string()";
            },
        );

        if (required) {
            return [match];
        }

        return match;
    }

    protected emitObject(name: Name, t: ObjectType): void {
        this.ensureBlankLine();
        this.emitLine("\nexport const ", name, "Schema = ", "z.object({");
        this.indent(() => {
            this.forEachClassProperty(t, "none", (_, jsonName, property) => {
                this.emitLine(
                    `"${utf16StringEscape(jsonName)}"`,
                    ": ",
                    this.typeMapTypeForProperty(property),
                    ",",
                );
            });
        });
        this.emitLine("});");
        if (!this._options.justSchema) {
            this.emitLine(
                "export type ",
                name,
                " = z.infer<typeof ",
                name,
                "Schema>;",
            );
        }
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        this.ensureBlankLine();
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("\nexport const ", enumName, "Schema = ", "z.enum([");
        this.indent(() =>
            this.forEachEnumCase(e, "none", (_, jsonName) => {
                this.emitLine('"', stringEscape(jsonName), '",');
            }),
        );
        this.emitLine("]);");
        if (!this._options.justSchema) {
            this.emitLine(
                "export type ",
                enumName,
                " = z.infer<typeof ",
                enumName,
                "Schema>;",
            );
        }
    }

    /** Static function that extracts underlying type refs for types that form part of the
     * definition of the passed type - used to ensure that these appear in generated source
     * before types that reference them.
     *
     * Primitive types don't need defining and enums are output before other types, hence,
     * these are ignored.
     */
    private static extractUnderlyingTyperefs(type: Type): number[] {
        const typeRefs: number[] = [];
        // Ignore enums and primitives
        if (!type.isPrimitive() && type.kind !== "enum") {
            // need to extract constituent types for unions and intersections (which both extend SetOperationType)
            // and can ignore the union/intersection itself
            if (type instanceof SetOperationType) {
                (type as SetOperationType).members.forEach((member) => {
                    // recurse as the underlying type could itself be a union, instersection or array etc.
                    typeRefs.push(
                        ...TypeScriptZodRenderer.extractUnderlyingTyperefs(
                            member,
                        ),
                    );
                });
            }

            // need to extract additional properties for object, class and map types (which all extend ObjectType)
            if (type instanceof ObjectType) {
                const addType = (type as ObjectType).getAdditionalProperties();
                if (addType) {
                    // recurse as the underlying type could itself be a union, instersection or array etc.
                    typeRefs.push(
                        ...TypeScriptZodRenderer.extractUnderlyingTyperefs(
                            addType,
                        ),
                    );
                }
            }

            // need to extract items types for ArrayType
            if (type instanceof ArrayType) {
                const itemsType = (type as ArrayType).items;
                if (itemsType) {
                    // recurse as the underlying type could itself be a union, instersection or array etc.
                    typeRefs.push(
                        ...TypeScriptZodRenderer.extractUnderlyingTyperefs(
                            itemsType,
                        ),
                    );
                }
            }

            // Finally return the reference to a class as that will need to be defined (where objects, maps, unions, intersections and arrays do not)
            if (type instanceof ClassType) {
                typeRefs.push(type.typeRef);
            }
        }

        return typeRefs;
    }

    protected emitSchemas(): void {
        this.ensureBlankLine();

        this.forEachEnum(
            "leading-and-interposing",
            (u: EnumType, enumName: Name) => {
                this.emitEnum(u, enumName);
            },
        );

        // All children must be defined before this type to avoid forward references in generated code
        // Build a model that will tell us if a referenced type has been defined then make multiple
        // passes over the defined objects to put them into the correct order for output in the
        // generated sourcecode

        const order: number[] = [];
        const mapType: ObjectType[] = [];
        const mapTypeRef: number[] = [];
        const mapName: Name[] = [];
        const mapChildTypeRefs: number[][] = [];

        this.forEachObject("none", (type: ObjectType, name: Name) => {
            mapType.push(type);
            mapTypeRef.push(type.typeRef);
            mapName.push(name);

            const children = type.getChildren();
            let childTypeRefs: number[] = [];

            children.forEach((child) => {
                childTypeRefs = childTypeRefs.concat(
                    TypeScriptZodRenderer.extractUnderlyingTyperefs(child),
                );
            });
            mapChildTypeRefs.push(childTypeRefs);
        });

        // Items to process on this pass
        let indices: number[] = [];
        mapType.forEach((_, index) => {
            indices.push(index);
        });
        // items to process on the next pass
        let deferredIndices: number[] = [];

        // defensive: make sure we don't loop forever, even complex sets shouldn't require many passes
        const MAX_PASSES = 999;
        let passNum = 0;
        do {
            indices.forEach((index) => {
                // must be behind all these children
                const childTypeRefs = mapChildTypeRefs[index];
                let foundAllChildren = true;

                childTypeRefs.forEach((childRef) => {
                    // defensive: first check if there is a definition for the referenced type (there should be)
                    if (mapTypeRef.includes(childRef)) {
                        let found = false;
                        // find this childs's ordinal, if it has already been added
                        // faster to go through what we've defined so far than all definitions

                        // FIXME: refactor this
                        // eslint-disable-next-line @typescript-eslint/prefer-for-of
                        for (let j = 0; j < order.length; j++) {
                            const childIndex = order[j];
                            if (mapTypeRef[childIndex] === childRef) {
                                found = true;
                                break;
                            }
                        }

                        foundAllChildren = foundAllChildren && found;
                    } else {
                        console.error(
                            "A child type reference was not found amongst all Object definitions! TypeRef: " +
                                childRef,
                        );
                    }
                });

                if (foundAllChildren) {
                    // insert index into order as we are safe to define this type
                    order.push(index);
                } else {
                    // defer to a subsequent pass as we need to define other types
                    deferredIndices.push(index);
                }
            });
            indices = deferredIndices;
            deferredIndices = [];
            passNum++;

            if (passNum > MAX_PASSES) {
                // giving up
                order.push(...deferredIndices);
                console.warn(
                    "Exceeded maximum number of passes when determining output order, output may contain forward references",
                );
            }
        } while (indices.length > 0 && passNum <= MAX_PASSES);

        // now emit ordered source
        order.forEach((i) =>
            this.emitGatheredSource(
                this.gatherSource(() =>
                    this.emitObject(mapName[i], mapType[i]),
                ),
            ),
        );
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        }

        this.emitImports();
        this.emitSchemas();
    }
}
