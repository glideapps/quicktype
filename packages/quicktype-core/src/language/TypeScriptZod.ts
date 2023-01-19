import { arrayIntercalate } from "collection-utils";
import {
    capitalize,
    ClassProperty,
    combineWords,
    firstUpperWordStyle,
    matchType,
    ObjectType,
    panic,
    Sourcelike,
    splitIntoWords,
    Type
} from "..";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { funPrefixNamer, Name, Namer } from "../Naming";
import { RenderContext } from "../Renderer";
import { Option } from "../RendererOptions";
import { acronymStyle, AcronymStyleOptions } from "../support/Acronyms";
import { allLowerWordStyle, isLetterOrUnderscore, utf16StringEscape } from "../support/Strings";
import { TargetLanguage } from "../TargetLanguage";
import { legalizeName } from "./JavaScript";

export const typeScriptZodOptions = {};

export class TypeScriptZodTargetLanguage extends TargetLanguage {
    protected getOptions(): Option<any>[] {
        return [];
    }

    constructor(
        displayName: string = "TypeScript Zod",
        names: string[] = ["typescript-zod"],
        extension: string = "ts"
    ) {
        super(displayName, names, extension);
    }

    protected makeRenderer(
        renderContext: RenderContext
        // untypedOptionValues: { [name: string]: any }
    ): TypeScriptZodRenderer {
        return new TypeScriptZodRenderer(
            this,
            renderContext
            // getOptionValues(typeScriptZodOptions, untypedOptionValues)
        );
    }
}

const identityNamingFunction = funPrefixNamer("properties", s => s);

export class TypeScriptZodRenderer extends ConvenienceRenderer {
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext) {
        super(targetLanguage, renderContext);
    }

    protected nameStyle(original: string, upper: boolean): string {
        const acronyms = acronymStyle(AcronymStyleOptions.Camel);
        const words = splitIntoWords(original);
        return combineWords(
            words,
            legalizeName,
            upper ? firstUpperWordStyle : allLowerWordStyle,
            firstUpperWordStyle,
            upper ? s => capitalize(acronyms(s)) : allLowerWordStyle,
            acronyms,
            "",
            isLetterOrUnderscore
        );
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", s => this.nameStyle(s, true));
    }

    protected namerForObjectProperty(): Namer | null {
        return identityNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer | null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer | null {
        return funPrefixNamer("enum-cases", s => this.nameStyle(s, false));
    }

    private importStatement(lhs: Sourcelike, moduleName: Sourcelike): Sourcelike {
        return ["import ", lhs, " from ", moduleName, ";"];
    }

    protected emitImports(): void {
        this.ensureBlankLine();
        this.emitLine(this.importStatement("* as z", '"zod"'));
    }

    typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        const typeMap = this.typeMapTypeFor(p.type);
        if (!p.isOptional) {
            return typeMap;
        }
        return ["z.any"];
    }

    typeMapTypeFor(t: Type, required: boolean = true): Sourcelike {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return [this.nameForNamedType(t), "Schema"];
        }

        const match = matchType<Sourcelike>(
            t,
            _anyType => "z.any()",
            _nullType => "z.null()",
            _boolType => "z.bool()",
            _integerType => "z.number()",
            _doubleType => "z.number()",
            _stringType => "z.string()",
            arrayType => ["z.array(", this.typeMapTypeFor(arrayType.items, false), ")"],
            _classType => panic("Should already be handled."),
            _mapType => ["z.map(z.string(), ", this.typeMapTypeFor(_mapType.values, false), ")"],
            _enumType => panic("Should already be handled."),
            unionType => {
                const children = Array.from(unionType.getChildren()).map((type: Type) =>
                    this.typeMapTypeFor(type, false)
                );
                return ["z.union([", ...arrayIntercalate(", ", children), "])"];
            },
            _transformedStringType => {
                return "z.string()";
            }
        );

        if (required) {
            return [match];
        }

        return match;
    }

    private emitObject(name: Name, t: ObjectType) {
        this.ensureBlankLine();
        this.emitLine("\nexport const ", name, "Schema = ", "z.object({");
        this.indent(() => {
            this.forEachClassProperty(t, "none", (_, jsonName, property) => {
                this.emitLine(`"${utf16StringEscape(jsonName)}"`, ": ", this.typeMapTypeForProperty(property), ",");
            });
        });
        this.emitLine("});");
        this.emitLine("export type ", name, " = z.infer<typeof ", name, "Schema>;");
    }

    protected emitSchemas(): void {
        this.ensureBlankLine();

        const order: number[] = [];
        const mapKey: Name[] = [];
        const mapValue: Sourcelike[][] = [];
        this.forEachObject("none", (type: ObjectType, name: Name) => {
            mapKey.push(name);
            mapValue.push(this.gatherSource(() => this.emitObject(name, type)));
        });

        mapKey.forEach((_, index) => {
            // assume first
            let ordinal = 0;

            // pull out all names
            const source = mapValue[index];
            const names = source.filter(value => value as Name);

            // must be behind all these names
            for (let i = 0; i < names.length; i++) {
                const depName = names[i];

                // find this name's ordinal, if it has already been added
                for (let j = 0; j < order.length; j++) {
                    const depIndex = order[j];
                    if (mapKey[depIndex] === depName) {
                        // this is the index of the dependency, so make sure we come after it
                        ordinal = Math.max(ordinal, depIndex + 1);
                    }
                }
            }

            // insert index
            order.splice(ordinal, 0, index);
        });

        // now emit ordered source
        order.forEach(i => this.emitGatheredSource(mapValue[i]));
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }

        this.emitImports();
        this.emitSchemas();
    }
}
