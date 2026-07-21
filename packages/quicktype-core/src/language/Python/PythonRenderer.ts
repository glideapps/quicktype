import {
    arrayIntercalate,
    iterableFirst,
    iterableSome,
    mapSortBy,
    mapUpdateInto,
    setUnionInto,
} from "collection-utils";

import {
    ConvenienceRenderer,
    type ForbiddenWordsInfo,
} from "../../ConvenienceRenderer.js";
import { type Name, type Namer, funPrefixNamer } from "../../Naming.js";
import type { RenderContext } from "../../Renderer.js";
import type { OptionValues } from "../../RendererOptions/index.js";
import type { Sourcelike } from "../../Source.js";
import { stringEscape } from "../../support/Strings.js";
import { defined, panic } from "../../support/Support.js";
import type { TargetLanguage } from "../../TargetLanguage.js";
import { followTargetType } from "../../Transformers.js";
import {
    ArrayType,
    type ClassProperty,
    ClassType,
    EnumType,
    MapType,
    type Type,
    UnionType,
} from "../../Type/index.js";
import { matchType, removeNullFromUnion } from "../../Type/TypeUtils.js";

import { forbiddenPropertyNames, forbiddenTypeNames } from "./constants.js";
import type { pythonOptions } from "./language.js";
import { classNameStyle, snakeNameStyle } from "./utils.js";

export class PythonRenderer extends ConvenienceRenderer {
    private readonly imports: Map<string, Set<string>> = new Map();

    private readonly moduleImports: Set<string> = new Set();

    private readonly declaredTypes: Set<Type> = new Set();

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly pyOptions: OptionValues<typeof pythonOptions>,
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return forbiddenTypeNames;
    }

    protected forbiddenForObjectProperties(
        _: ClassType,
        _classNamed: Name,
    ): ForbiddenWordsInfo {
        return {
            names: forbiddenPropertyNames as unknown as string[],
            includeGlobalForbidden: false,
        };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("type", classNameStyle);
    }

    protected namerForObjectProperty(): Namer {
        return funPrefixNamer("property", (s) =>
            snakeNameStyle(s, false, this.pyOptions.nicePropertyNames),
        );
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-case", (s) =>
            snakeNameStyle(s, true, this.pyOptions.nicePropertyNames),
        );
    }

    protected get commentLineStart(): string {
        return "# ";
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        if (lines.length === 1) {
            this.emitComments([
                { customLines: lines, lineStart: '"""', lineEnd: '"""' },
            ]);
        } else {
            this.emitCommentLines(lines, {
                firstLineStart: '"""',
                lineStart: "",
                afterComment: '"""',
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
            mapUpdateInto(this.imports, module, (s) =>
                s ? setUnionInto(s, [name]) : new Set([name]),
            );
        }

        return name;
    }

    protected withModuleImport(module: string): Sourcelike {
        this.moduleImports.add(module);
        return module;
    }

    protected withTyping(name: string): Sourcelike {
        return this.withImport("typing", name);
    }

    protected namedType(t: Type, suppressQuotes = false): Sourcelike {
        const name = this.nameForNamedType(t);
        if (suppressQuotes || this.declaredTypes.has(t)) return name;
        return ["'", name, "'"];
    }

    // Would rendering `t` as a type annotation right now require a forward
    // reference, i.e. does it mention a named type that hasn't been declared
    // yet?
    private typeContainsForwardRef(t: Type): boolean {
        const actualType = followTargetType(t);
        if (actualType instanceof ClassType || actualType instanceof EnumType) {
            return !this.declaredTypes.has(actualType);
        }

        if (actualType instanceof ArrayType) {
            return this.typeContainsForwardRef(actualType.items);
        }

        if (actualType instanceof MapType) {
            return this.typeContainsForwardRef(actualType.values);
        }

        if (actualType instanceof UnionType) {
            return iterableSome(actualType.members, (m) =>
                this.typeContainsForwardRef(m),
            );
        }

        return false;
    }

    // Renders a union with PEP 604 syntax: `A | B | None`.  A quoted forward
    // reference is not allowed as an operand of `|` (`'A' | None` is a runtime
    // `TypeError`), so if any member needs a forward reference we quote the
    // whole union expression instead, suppressing the quotes on the individual
    // names.  A `" = None"` default, if required, must go outside the closing
    // quote: `foo: 'Foo | None' = None`.
    private pep604UnionType(
        unionType: UnionType,
        isRootTypeDef: boolean,
        suppressQuotes: boolean,
    ): Sourcelike {
        const [hasNull, nonNulls] = removeNullFromUnion(unionType);
        const needsQuotes =
            !suppressQuotes &&
            iterableSome(nonNulls, (m) => this.typeContainsForwardRef(m));
        const quote = needsQuotes ? "'" : "";
        const memberTypes = Array.from(nonNulls).map((m) =>
            this.pythonType(m, false, true),
        );

        const union: Sourcelike[] = [
            quote,
            arrayIntercalate(" | ", memberTypes),
        ];
        if (hasNull !== null) {
            union.push(" | None");
        }

        union.push(quote);

        if (hasNull !== null) {
            union.push(...this.noneDefault(isRootTypeDef));
        }

        return union;
    }

    // A `" = None"` default for a class property whose value can be `None`.
    // Only emitted for root level type defs, otherwise we may get type defs
    // like `List[Optional[int] = None]`, which are invalid.  Every property
    // that gets a default must sort after all properties that don't — see
    // `sortClassProperties`.
    private noneDefault(isRootTypeDef: boolean): string[] {
        if (
            isRootTypeDef &&
            !this.getAlphabetizeProperties() &&
            (this.pyOptions.features.dataClasses ||
                this.pyOptions.pydanticBaseModel)
        ) {
            return [" = None"];
        }

        return [];
    }

    // Does `pythonType(p.type, true)` end in a `" = None"` default?  This
    // must mirror the `noneDefault` calls in `pythonType` exactly: nullable
    // unions, plus `Any` and `None` typed properties — an optional `Any`
    // stays `Any` (`null` is absorbed by it), and an optional `null`
    // collapses to just `null`, so those also default to `None`.
    private classPropertyHasNoneDefault(p: ClassProperty): boolean {
        const actualType = followTargetType(p.type);
        if (actualType instanceof UnionType) {
            const [hasNull] = removeNullFromUnion(actualType);
            return hasNull !== null;
        }

        return actualType.kind === "any" || actualType.kind === "null";
    }

    protected pythonType(
        t: Type,
        _isRootTypeDef = false,
        suppressQuotes = false,
    ): Sourcelike {
        const actualType = followTargetType(t);

        return matchType<Sourcelike>(
            actualType,
            (_anyType) => [
                this.withTyping("Any"),
                ...this.noneDefault(_isRootTypeDef),
            ],
            (_nullType) => ["None", ...this.noneDefault(_isRootTypeDef)],
            (_boolType) => "bool",
            (_integerType) => "int",
            (_doubletype) => "float",
            (_stringType) => "str",
            (arrayType) => [
                this.pyOptions.features.builtinGenerics
                    ? "list"
                    : this.withTyping("List"),
                "[",
                this.pythonType(arrayType.items, false, suppressQuotes),
                "]",
            ],
            (classType) => this.namedType(classType, suppressQuotes),
            (mapType) => [
                this.pyOptions.features.builtinGenerics
                    ? "dict"
                    : this.withTyping("Dict"),
                "[str, ",
                this.pythonType(mapType.values, false, suppressQuotes),
                "]",
            ],
            (enumType) => this.namedType(enumType, suppressQuotes),
            (unionType) => {
                if (this.pyOptions.features.unionOperators) {
                    return this.pep604UnionType(
                        unionType,
                        _isRootTypeDef,
                        suppressQuotes,
                    );
                }

                const [hasNull, nonNulls] = removeNullFromUnion(unionType);
                const memberTypes = Array.from(nonNulls).map((m) =>
                    this.pythonType(m, false, suppressQuotes),
                );

                if (hasNull !== null) {
                    const rest = this.noneDefault(_isRootTypeDef);

                    if (nonNulls.size > 1) {
                        this.withImport("typing", "Union");
                        return [
                            this.withTyping("Optional"),
                            "[Union[",
                            arrayIntercalate(", ", memberTypes),
                            "]]",
                            ...rest,
                        ];
                    }

                    return [
                        this.withTyping("Optional"),
                        "[",
                        defined(iterableFirst(memberTypes)),
                        "]",
                        ...rest,
                    ];
                }

                return [
                    this.withTyping("Union"),
                    "[",
                    arrayIntercalate(", ", memberTypes),
                    "]",
                ];
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date") {
                    return [this.withModuleImport("datetime"), ".date"];
                }

                if (transformedStringType.kind === "time") {
                    return [this.withModuleImport("datetime"), ".time"];
                }

                if (transformedStringType.kind === "date-time") {
                    return [this.withModuleImport("datetime"), ".datetime"];
                }

                if (transformedStringType.kind === "uuid") {
                    return this.withImport("uuid", "UUID");
                }

                return panic(
                    `Transformed type ${transformedStringType.kind} not supported`,
                );
            },
        );
    }

    protected declarationLine(t: Type): Sourcelike {
        if (t instanceof ClassType) {
            if (this.pyOptions.pydanticBaseModel) {
                return [
                    "class ",
                    this.nameForNamedType(t),
                    "(",
                    this.withImport("pydantic", "BaseModel"),
                    "):",
                ];
            }
            return ["class ", this.nameForNamedType(t), ":"];
        }

        if (t instanceof EnumType) {
            return [
                "class ",
                this.nameForNamedType(t),
                "(",
                this.withImport("enum", "Enum"),
                "):",
            ];
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
        if (
            this.pyOptions.features.dataClasses ||
            this.pyOptions.pydanticBaseModel
        )
            return;

        const args: Sourcelike[] = [];
        this.forEachClassProperty(t, "none", (name, _, cp) => {
            args.push([name, this.typeHint(": ", this.pythonType(cp.type))]);
        });
        this.emitBlock(
            [
                "def __init__(self, ",
                arrayIntercalate(", ", args),
                ")",
                this.typeHint(" -> None"),
                ":",
            ],
            () => {
                if (args.length === 0) {
                    this.emitLine("pass");
                } else {
                    this.forEachClassProperty(t, "none", (name) => {
                        this.emitLine("self.", name, " = ", name);
                    });
                }
            },
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
        propertyNames: ReadonlyMap<string, Name>,
    ): ReadonlyMap<string, ClassProperty> {
        if (
            this.pyOptions.features.dataClasses ||
            this.pyOptions.pydanticBaseModel
        ) {
            // Properties that get a `" = None"` default must come after all
            // properties that don't, or the generated dataclass is invalid.
            return mapSortBy(properties, (p: ClassProperty) =>
                this.classPropertyHasNoneDefault(p) ? 1 : 0,
            );
        }

        return super.sortClassProperties(properties, propertyNames);
    }

    protected emitClass(t: ClassType): void {
        if (
            this.pyOptions.features.dataClasses &&
            !this.pyOptions.pydanticBaseModel
        ) {
            this.emitLine("@", this.withImport("dataclasses", "dataclass"));
        }

        this.declareType(t, () => {
            if (this.pyOptions.features.typeHints) {
                if (t.getProperties().size === 0) {
                    this.emitLine("pass");
                } else {
                    this.forEachClassProperty(
                        t,
                        "none",
                        (name, jsonName, cp) => {
                            this.emitLine(
                                name,
                                this.typeHint(
                                    ": ",
                                    this.pythonType(cp.type, true),
                                ),
                            );
                            this.emitDescription(
                                this.descriptionForClassProperty(t, jsonName),
                            );
                        },
                    );
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
        this.moduleImports.forEach((module) => {
            this.emitLine("import ", module);
        });
        this.imports.forEach((names, module) => {
            this.emitLine(
                "from ",
                module,
                " import ",
                Array.from(names).join(", "),
            );
        });
    }

    protected emitSupportCode(): void {}

    protected emitClosingCode(): void {}

    protected emitSourceStructure(_givenOutputFilename: string): void {
        const declarationLines = this.gatherSource(() => {
            this.forEachNamedType(
                ["interposing", 2],
                (c: ClassType) => this.emitClass(c),
                (e) => this.emitEnum(e),
                (_u) => {},
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
