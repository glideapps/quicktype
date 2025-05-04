import { arrayIntercalate, iterableFirst, mapSortBy, mapUpdateInto, setUnionInto } from "collection-utils";

import { ConvenienceRenderer, type ForbiddenWordsInfo } from "../../ConvenienceRenderer";
import { type Name, type Namer, funPrefixNamer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, modifySource } from "../../Source";
import { stringEscape } from "../../support/Strings";
import { defined, panic } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import { followTargetType } from "../../Transformers";
import { type ClassProperty, ClassType, EnumType, type Type, UnionType } from "../../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../../TypeUtils";

import { forbiddenPropertyNames, forbiddenTypeNames } from "./constants";
import { type pythonOptions } from "./language";
import { classNameStyle, snakeNameStyle } from "./utils";

export class PythonRenderer extends ConvenienceRenderer {
    private readonly imports: Map<string, Set<string>> = new Map();

    private readonly declaredTypes: Set<Type> = new Set();

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly pyOptions: OptionValues<typeof pythonOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return forbiddenTypeNames;
    }

    protected forbiddenForObjectProperties(_: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: forbiddenPropertyNames as unknown as string[], includeGlobalForbidden: false };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("type", classNameStyle);
    }

    protected namerForObjectProperty(): Namer {
        return funPrefixNamer("property", s => snakeNameStyle(s, false, this.pyOptions.nicePropertyNames));
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-case", s => snakeNameStyle(s, true, this.pyOptions.nicePropertyNames));
    }

    protected get commentLineStart(): string {
        return "# ";
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        if (lines.length === 1) {
            const docstring = modifySource(content => {
                if (content.startsWith('"')) {
                    content = ' ' + content;
                }
                if (content.endsWith('"')) {
                    content = content + ' ';
                }

                return content.replace(/"/g, '\\"');
            }, lines[0]);
            this.emitComments([{ customLines: [docstring], lineStart: '"""', lineEnd: '"""' }]);
        } else {
            this.emitCommentLines(lines, {
                firstLineStart: '"""',
                lineStart: "",
                afterComment: '"""'
            });
        }
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    protected canBeForwardDeclared(t: Type): boolean {
        const kind = t.kind;
        return kind === "class" || kind === "enum";
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line);
        this.indent(f);
    }

    protected string(s: string): Sourcelike {
        const openQuote = '"';
        return [openQuote, stringEscape(s), '"'];
    }

    protected withImport(module: string, name: string): Sourcelike {
        if (this.pyOptions.features.typeHints || module !== "typing") {
            // FIXME: This is ugly.  We should rather not generate that import in the first
            // place, but right now we just make the type source and then throw it away.  It's
            // not a performance issue, so it's fine, I just bemoan this special case, and
            // potential others down the road.
            mapUpdateInto(this.imports, module, s => (s ? setUnionInto(s, [name]) : new Set([name])));
        }

        return name;
    }

    protected withTyping(name: string): Sourcelike {
        return this.withImport("typing", name);
    }

    protected namedType(t: Type): Sourcelike {
        const name = this.nameForNamedType(t);
        if (this.declaredTypes.has(t)) return name;
        return ["'", name, "'"];
    }

    protected pythonType(t: Type, _isRootTypeDef = false): Sourcelike {
        const actualType = followTargetType(t);

        return matchType<Sourcelike>(
            actualType,
            _anyType => this.withTyping("Any"),
            _nullType => "None",
            _boolType => "bool",
            _integerType => "int",
            _doubletype => "float",
            _stringType => "str",
            arrayType => [this.withTyping("List"), "[", this.pythonType(arrayType.items), "]"],
            classType => this.namedType(classType),
            mapType => [this.withTyping("Dict"), "[str, ", this.pythonType(mapType.values), "]"],
            enumType => this.namedType(enumType),
            unionType => {
                const [hasNull, nonNulls] = removeNullFromUnion(unionType);
                const memberTypes = Array.from(nonNulls).map(m => this.pythonType(m));

                if (hasNull !== null) {
                    let rest: string[] = [];
                    if (
                        !this.getAlphabetizeProperties() &&
                        (this.pyOptions.features.dataClasses || this.pyOptions.pydanticBaseModel) &&
                        _isRootTypeDef
                    ) {
                        // Only push "= None" if this is a root level type def
                        //   otherwise we may get type defs like List[Optional[int] = None]
                        //   which are invalid
                        rest.push(" = None");
                    }

                    if (nonNulls.size > 1) {
                        this.withImport("typing", "Union");
                        return [
                            this.withTyping("Optional"),
                            "[Union[",
                            arrayIntercalate(", ", memberTypes),
                            "]]",
                            ...rest
                        ];
                    } else {
                        return [this.withTyping("Optional"), "[", defined(iterableFirst(memberTypes)), "]", ...rest];
                    }
                } else {
                    return [this.withTyping("Union"), "[", arrayIntercalate(", ", memberTypes), "]"];
                }
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return this.withImport("datetime", "datetime");
                }

                if (transformedStringType.kind === "uuid") {
                    return this.withImport("uuid", "UUID");
                }

                return panic(`Transformed type ${transformedStringType.kind} not supported`);
            }
        );
    }

    protected declarationLine(t: Type): Sourcelike {
        if (t instanceof ClassType) {
            if (this.pyOptions.pydanticBaseModel) {
                return ["class ", this.nameForNamedType(t), "(", this.withImport("pydantic", "BaseModel"), "):"];
            }
            return ["class ", this.nameForNamedType(t), ":"];
        }

        if (t instanceof EnumType) {
            return ["class ", this.nameForNamedType(t), "(", this.withImport("enum", "Enum"), "):"];
        }

        return panic(`Can't declare type ${t.kind}`);
    }

    protected declareType<T extends Type>(t: T, emitter: () => void): void {
        this.emitBlock(this.declarationLine(t), () => {
            this.emitDescription(this.descriptionForType(t));
            emitter();
        });
        this.declaredTypes.add(t);
    }

    protected emitClassMembers(t: ClassType): void {
        if (this.pyOptions.features.dataClasses || this.pyOptions.pydanticBaseModel) return;

        const args: Sourcelike[] = [];
        this.forEachClassProperty(t, "none", (name, _, cp) => {
            args.push([name, this.typeHint(": ", this.pythonType(cp.type))]);
        });
        this.emitBlock(
            ["def __init__(self, ", arrayIntercalate(", ", args), ")", this.typeHint(" -> None"), ":"],
            () => {
                if (args.length === 0) {
                    this.emitLine("pass");
                } else {
                    this.forEachClassProperty(t, "none", name => {
                        this.emitLine("self.", name, " = ", name);
                    });
                }
            }
        );
    }

    protected typeHint(...sl: Sourcelike[]): Sourcelike {
        if (this.pyOptions.features.typeHints) {
            return sl;
        }

        return [];
    }

    protected typingDecl(name: Sourcelike, type: string): Sourcelike {
        return [name, this.typeHint(": ", this.withTyping(type))];
    }

    protected typingReturn(type: string): Sourcelike {
        return this.typeHint(" -> ", this.withTyping(type));
    }

    protected sortClassProperties(
        properties: ReadonlyMap<string, ClassProperty>,
        propertyNames: ReadonlyMap<string, Name>
    ): ReadonlyMap<string, ClassProperty> {
        if (this.pyOptions.features.dataClasses || this.pyOptions.pydanticBaseModel) {
            return mapSortBy(properties, (p: ClassProperty) => {
                return (p.type instanceof UnionType && nullableFromUnion(p.type) != null) || p.isOptional ? 1 : 0;
            });
        } else {
            return super.sortClassProperties(properties, propertyNames);
        }
    }

    protected emitClass(t: ClassType): void {
        if (this.pyOptions.features.dataClasses && !this.pyOptions.pydanticBaseModel) {
            this.emitLine("@", this.withImport("dataclasses", "dataclass"));
        }

        this.declareType(t, () => {
            if (this.pyOptions.features.typeHints) {
                if (t.getProperties().size === 0) {
                    this.emitLine("pass");
                } else {
                    this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                        this.emitLine(name, this.typeHint(": ", this.pythonType(cp.type, true)));
                        this.emitDescription(this.descriptionForClassProperty(t, jsonName));
                    });
                }

                this.ensureBlankLine();
            }

            this.emitClassMembers(t);
        });
    }

    protected emitEnum(t: EnumType): void {
        this.declareType(t, () => {
            this.forEachEnumCase(t, "none", (name, jsonName) => {
                this.emitLine([name, " = ", this.string(jsonName)]);
            });
        });
    }

    protected emitImports(): void {
        this.imports.forEach((names, module) => {
            this.emitLine("from ", module, " import ", Array.from(names).join(", "));
        });
    }

    protected emitSupportCode(): void {
        return;
    }

    protected emitClosingCode(): void {
        return;
    }

    protected emitSourceStructure(_givenOutputFilename: string): void {
        const declarationLines = this.gatherSource(() => {
            this.forEachNamedType(
                ["interposing", 2],
                (c: ClassType) => this.emitClass(c),
                e => this.emitEnum(e),
                _u => {
                    return;
                }
            );
        });

        const closingLines = this.gatherSource(() => this.emitClosingCode());
        const supportLines = this.gatherSource(() => this.emitSupportCode());

        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        }

        this.ensureBlankLine();
        this.emitImports();
        this.ensureBlankLine(2);
        this.emitGatheredSource(supportLines);
        this.ensureBlankLine(2);
        this.emitGatheredSource(declarationLines);
        this.ensureBlankLine(2);
        this.emitGatheredSource(closingLines);
    }
}
