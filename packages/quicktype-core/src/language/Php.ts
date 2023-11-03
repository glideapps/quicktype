import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { DependencyName, funPrefixNamer, Name, Namer } from "../Naming";
import { RenderContext } from "../Renderer";
import { BooleanOption, EnumOption, getOptionValues, Option, OptionValues } from "../RendererOptions";
import { maybeAnnotated, Sourcelike } from "../Source";
import { acronymOption, acronymStyle, AcronymStyleOptions } from "../support/Acronyms";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    isAscii,
    isDigit,
    isLetter,
    splitIntoWords,
    standardUnicodeHexEscape,
    utf16ConcatMap,
    utf16LegalizeCharacters
} from "../support/Strings";
import { defined } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { ClassProperty, ClassType, EnumType, Type, UnionType } from "../Type";
import { directlyReachableSingleNamedType, matchType, nullableFromUnion } from "../TypeUtils";
import { StringTypeMapping, TransformedStringTypeKind, PrimitiveStringTypeKind } from "..";
import * as _ from "lodash";

export enum SerializeWith {
    array = "Associative Array",
    stdClass = "stdClass"
}

export type SelfNameType = "default" | "self" | "static";

export const phpOptions = {
    withGet: new BooleanOption("with-get", "Create Getter", false),
    withSet: new BooleanOption("with-set", "Create Setter", false),
    withClosing: new BooleanOption("with-closing", "PHP Closing Tag", false),
    readonlyProperties: new BooleanOption("readonly-properties", "Use public readonly instead of protected", true),
    nativeEnums: new BooleanOption("native-enums", "Use enums instead of enum classes", true),
    arrowFunctions: new BooleanOption("arrow-functions", "Use arrow functions whenever possible", true),
    callable: new BooleanOption("callable", "Use callable syntax whenever possible", true),
    firstCallable: new BooleanOption("first-callable", "Use first callable syntax whenever possible", true),
    staticTypeAnnotation: new BooleanOption("static-type-annotation", "Use static type hinting on methods", true),
    constructorProperties: new BooleanOption(
        "constructor-properties",
        "Declare class properties inside constructor",
        true
    ),
    serializeWith: new EnumOption(
        "serialize-with",
        "Serialize with",
        [
            ["array", SerializeWith.array],
            ["stdClass", SerializeWith.stdClass]
        ],
        "array"
    ),
    selfNameType: new EnumOption<SelfNameType>(
        "self-name-type",
        "How to refer to a class from inside itself",
        [
            ["default", "default"],
            ["self", "self"],
            ["static", "static"]
        ],
        "static"
    ),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal)
};

export class PhpTargetLanguage extends TargetLanguage {
    constructor() {
        super("PHP", ["php"], "php");
    }

    protected getOptions(): Option<any>[] {
        return _.values(phpOptions);
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): PhpRenderer {
        const options = getOptionValues(phpOptions, untypedOptionValues);
        return new PhpRenderer(this, renderContext, options);
    }

    get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        mapping.set("date", "date"); // TODO is not implemented yet
        mapping.set("time", "time"); // TODO is not implemented yet
        mapping.set("uuid", "uuid"); // TODO is not implemented yet
        mapping.set("date-time", "date-time");
        return mapping;
    }
}

export const stringEscape = utf16ConcatMap(escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape));

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return true; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return isStartCharacter(codePoint) || (isAscii(codePoint) && isDigit(codePoint));
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

export function phpNameStyle(
    startWithUpper: boolean,
    upperUnderscore: boolean,
    original: string,
    acronymsStyle: (s: string) => string = allUpperWordStyle
): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore ? allUpperWordStyle : startWithUpper ? firstUpperWordStyle : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper ? allUpperWordStyle : allLowerWordStyle,
        acronymsStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
}

export interface FunctionNames {
    readonly getter: Name;
    readonly setter: Name;
}

type Method = {
    name: Sourcelike;
    body: () => void;
    desc?: string[];
    args?: Sourcelike[];
    returnType?: Type | Sourcelike;
    docBlockArgs?: Sourcelike[];
    docBlockReturnType?: Type | Sourcelike;
    isStatic?: boolean;
    isProtected?: boolean;
};

export class PhpRenderer extends ConvenienceRenderer {
    private readonly _gettersAndSettersForPropertyName = new Map<Name, FunctionNames>();
    private _haveEmittedLeadingComments = false;
    protected readonly _converterClassname: string = "Converter";
    protected readonly _converterKeywords: string[] = [];

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _options: OptionValues<typeof phpOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return this.getNameStyling("typeNamingFunction");
    }

    protected namerForObjectProperty(): Namer {
        return this.getNameStyling("propertyNamingFunction");
    }

    protected makeUnionMemberNamer(): Namer {
        return this.getNameStyling("propertyNamingFunction");
    }

    protected makeEnumCaseNamer(): Namer {
        return this.getNameStyling("enumCaseNamingFunction");
    }

    protected unionNeedsName(u: UnionType): boolean {
        return nullableFromUnion(u) === null;
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return directlyReachableSingleNamedType(type);
    }

    protected makeNamesForPropertyGetterAndSetter(
        _c: ClassType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        name: Name
    ): FunctionNames {
        const getterName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `get_${lookup(name)}`
        );
        const setterName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `set_${lookup(name)}`
        );

        return {
            getter: getterName,
            setter: setterName
        };
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
        return [getterAndSetterNames.getter, getterAndSetterNames.setter];
    }

    private getNameStyling(convention: string): Namer {
        const styling: { [key: string]: Namer } = {
            typeNamingFunction: funPrefixNamer("types", n =>
                phpNameStyle(true, false, n, acronymStyle(this._options.acronymStyle))
            ),
            propertyNamingFunction: funPrefixNamer("properties", n =>
                phpNameStyle(false, false, n, acronymStyle(this._options.acronymStyle))
            ),
            enumCaseNamingFunction: funPrefixNamer("enum-cases", n =>
                phpNameStyle(true, true, n, acronymStyle(this._options.acronymStyle))
            )
        };
        return styling[convention];
    }

    protected startFile(_basename: Sourcelike): void {
        this.ensureBlankLine();
        if (!this._haveEmittedLeadingComments && this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            this.ensureBlankLine();
            this._haveEmittedLeadingComments = true;
        }
    }

    protected finishFile(): void {
        // empty
    }

    protected emitFileHeader(fileName: Sourcelike, _imports: string[]): void {
        this.startFile(fileName);
        this.ensureBlankLine();
    }

    public emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    public emitBlockWithBraceOnNewLine(line: Sourcelike, f: () => void): void {
        this.emitLine(line);
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}");
    }

    public emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected phpType(t: Type, isOptional = false, prefix = "?", suffix = ""): Sourcelike {
        function optionalize(s: Sourcelike) {
            return [isOptional ? prefix : "", s, isOptional ? suffix : ""];
        }
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(isOptional, anyTypeIssueAnnotation, "Object"),
            _nullType => maybeAnnotated(isOptional, nullTypeIssueAnnotation, "Object"),
            _boolType => optionalize("bool"),
            _integerType => optionalize("int"),
            _doubleType => optionalize("float"),
            _stringType => optionalize("string"),
            _arrayType => optionalize("array"),
            classType => optionalize(this.nameForNamedType(classType)),
            _mapType => optionalize(this._options.serializeWith === SerializeWith.stdClass ? "stdClass" : "array"),
            enumType => optionalize(this.nameForNamedType(enumType)),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return this.phpType(nullable, true, prefix, suffix);
                }
                return this.nameForNamedType(unionType);
            },
            transformedStringType => {
                if (transformedStringType.kind === "time") {
                    throw Error('transformedStringType.kind === "time"');
                }
                if (transformedStringType.kind === "date") {
                    throw Error('transformedStringType.kind === "date"');
                }
                if (transformedStringType.kind === "date-time") {
                    return "DateTime";
                }
                if (transformedStringType.kind === "uuid") {
                    throw Error('transformedStringType.kind === "uuid"');
                }
                return "string";
            }
        );
    }

    protected phpDocType(t: Type): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "any",
            _nullType => "null",
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "float",
            _stringType => "string",
            arrayType => [this.phpDocType(arrayType.items), "[]"],
            classType => this.nameForNamedType(classType),
            _mapType => (this._options.serializeWith === SerializeWith.stdClass ? "stdClass" : "array"),
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return ["?", this.phpDocType(nullable)];
                }
                throw Error("union are not supported");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return "DateTime";
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    protected phpToObjConvert(t: Type, lhs: Sourcelike[], args: Sourcelike[]): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => [...lhs, ...args],
            _nullType => [...lhs, ...args],
            _boolType => [...lhs, ...args],
            _integerType => [...lhs, ...args],
            _doubleType => [...lhs, ...args],
            _stringType => [...lhs, ...args],
            arrayType => {
                const { arrowFunctions } = this._options;
                const to = this.phpToObjConvert(arrayType.items, ["return "], ["$value"]);

                if (this.sourcelikeToString(to) === "return $value") {
                    return [...lhs, ...args];
                }

                const type = this.phpType(arrayType.items);

                if (arrowFunctions) {
                    const to = this.phpToObjConvert(arrayType.items, [], ["$value"]);
                    return [...lhs, "array_map(fn(", type, " $value) => ", to, ", ", ...args, ")"];
                }

                return [...lhs, "array_map(function (", type, " $value) {\n    ", to, ";\n}, ", ...args, ")"];
            },
            _classType => [...lhs, ...args, "->to()"],
            _mapType => {
                throw Error("maps are not supported");
            },
            _enumType => [...lhs, ...args, "->value"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    const to = this.phpToObjConvert(nullable, lhs, args);

                    if (this.sourcelikeToString(to) === this.sourcelikeToString(args)) {
                        return to;
                    }

                    return [...args, " === null ? null : ", to];
                }
                throw Error("union are not supported");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return [...lhs, ...args, "->format(DateTimeInterface::ISO8601)"];
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    private transformDateTime(className: Name, attrName: Sourcelike, scopeAttrName: Sourcelike[]): Sourcelike {
        this.emitBlock(["if (!is_a(", scopeAttrName, ", 'DateTime'))"], () =>
            this.emitLine("throw new Exception('Attribute Error:", className, "::", attrName, "');")
        );
        throw Error("datetime is not supported");
    }

    protected phpFromObjConvert(className: Name, t: Type, lhs: Sourcelike[], args: Sourcelike[]): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => [...lhs, ...args],
            _nullType => [...lhs, ...args],
            _boolType => [...lhs, ...args],
            _integerType => [...lhs, ...args],
            _doubleType => [...lhs, ...args],
            _stringType => [...lhs, ...args],
            arrayType => {
                const { arrowFunctions, callable } = this._options;
                const from = this.phpFromObjConvert(className, arrayType.items, ["return "], ["$value"]);

                if (this.sourcelikeToString(from) === "return $value") {
                    return [...lhs, ...args];
                }

                if (arrowFunctions) {
                    if (callable && ["class", "enum"].includes(arrayType.items.kind)) {
                        const from = this.phpFromObjConvert(className, arrayType.items, [], []);
                        return [...lhs, "array_map(", from, ", ", ...args, ")"];
                    }

                    const from = this.phpFromObjConvert(className, arrayType.items, [], ["$value"]);
                    return [...lhs, "array_map(fn($value) => ", from, ", ", ...args, ")"];
                }

                return [...lhs, "array_map(function ($value) {\n    ", from, ";\n}, ", ...args, ")"];
            },
            classType => {
                const { callable, firstCallable } = this._options;

                if (firstCallable && args.length === 0) {
                    return [this.nameForNamedType(classType), "::from(...)"];
                }

                if (callable && args.length === 0) {
                    return ["[", this.nameForNamedType(classType), "::class, 'from']"];
                }

                return [...lhs, this.nameForNamedType(classType), "::from(", ...args, ")"];
            },
            _mapType => {
                throw Error("maps are not supported");
            },
            enumType => {
                const { callable, firstCallable } = this._options;

                if (firstCallable && args.length === 0) {
                    return [this.nameForNamedType(enumType), "::from(...)"];
                }

                if (callable && args.length === 0) {
                    return ["[", this.nameForNamedType(enumType), "::class, 'from']"];
                }

                return [...lhs, this.nameForNamedType(enumType), "::from(", ...args, ")"];
            },
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    const from = this.phpFromObjConvert(className, nullable, [], args);

                    if (this.sourcelikeToString(from) === this.sourcelikeToString(args)) {
                        return [...lhs, from];
                    }

                    return [...lhs, ...args, " === null ? null : ", from];
                }
                throw Error("union are not supported");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return [
                        "$tmp = DateTime::createFromFormat(DateTimeInterface::ISO8601, ",
                        args,
                        ");",
                        className,
                        "",
                        ["$tmp"],
                        this.transformDateTime(className, "", ["$tmp"]),
                        "return $tmp;"
                    ];
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    private phpValidate(className: Name, t: Type, attrName: Sourcelike, scopeAttrName: string) {
        const is = (isfn: string, myT: Name = className) => {
            this.emitBlock(["if (!", isfn, "(", scopeAttrName, "))"], () =>
                this.emitLine("throw new Exception('Attribute Error:", myT, "::", attrName, "');")
            );
        };
        return matchType<void>(
            t,
            _anyType => is("defined"),
            _nullType => is("is_null"),
            _boolType => is("is_bool"),
            _integerType => is("is_integer"),
            _doubleType => is("is_float"),
            _stringType => is("is_string"),
            arrayType => {
                is("is_array");
                this.emitLine("array_walk(", scopeAttrName, ", function (", scopeAttrName, "_v) {");
                this.indent(() => {
                    this.phpValidate(className, arrayType.items, attrName, `${scopeAttrName}_v`);
                });
                this.emitLine("});");
            },
            _classType => {
                this.emitLine(scopeAttrName, "->validate();");
            },
            mapType => {
                this.emitLine("foreach (", scopeAttrName, " as $k => $v) {");
                this.indent(() => {
                    this.phpValidate(className, mapType.values, attrName, "$v");
                });
                this.emitLine("}");
            },
            _enumType => {
                this.emitLine(scopeAttrName, "->value;");
            },
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitBlock(["if (!is_null(", scopeAttrName, "))"], () => {
                        this.phpValidate(className, nullable, attrName, scopeAttrName);
                    });
                    return;
                }
                throw Error("not implemented");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    this.transformDateTime(className, attrName, [scopeAttrName]);
                    return;
                }
                throw Error(`transformedStringType.kind === ${transformedStringType.kind}`);
            }
        );
    }

    protected emitMethod(method: Method): void {
        const {
            name,
            body,
            desc,
            args = [],
            returnType = "void",
            docBlockArgs = args,
            docBlockReturnType = returnType,
            isStatic = false,
            isProtected = false
        } = method;

        const docBlock: Sourcelike[] = [];
        if (desc !== undefined) {
            docBlock.push([...desc, "\n *"]);
        }
        for (const docBlockArg of docBlockArgs) {
            docBlock.push(["@param ", docBlockArg]);
        }
        docBlock.push([
            "@return ",
            docBlockReturnType instanceof Type ? this.phpDocType(docBlockReturnType) : docBlockReturnType
        ]);
        this.emitDescriptionBlock(docBlock);

        const line: Sourcelike[] = [];
        line.push(isProtected ? "protected" : "public");
        line.push(isStatic ? " static" : "");
        line.push(" function ", name, "(");
        args.forEach((arg, i) => {
            if (i > 0) {
                line.push(", ");
            }
            line.push(arg);
        });
        line.push("): ", returnType instanceof Type ? this.phpType(returnType) : returnType);
        this.emitBlockWithBraceOnNewLine(line, body);
    }

    protected emitGetMethod(names: FunctionNames, p: ClassProperty, _className: Name, name: Name, desc?: string[]) {
        const { withGet } = this._options;

        if (!withGet) {
            return;
        }

        this.emitMethod({
            name: names.getter,
            body: () => {
                this.emitLine("return $this->", name, ";");
            },
            desc,
            returnType: p.type
        });
    }

    protected emitSetMethod(names: FunctionNames, p: ClassProperty, _className: Name, name: Name, desc?: string[]) {
        if (!this._options.withSet) {
            return;
        }

        this.emitMethod({
            name: names.setter,
            body: () => {
                this.emitLine("$this->", name, " = $value;");
            },
            desc,
            args: [[this.phpType(p.type), " $value"]],
            docBlockArgs: [[this.phpDocType(p.type), " $value"]],
            returnType: "void"
        });
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitFileHeader(className, []);

        this.emitBlockWithBraceOnNewLine(["class ", className], () => {
            const { constructorProperties, readonlyProperties } = this._options;
            const accessor = readonlyProperties ? "public readonly" : "protected";

            if (!constructorProperties) {
                this.forEachClassProperty(c, "none", (name, _jsonName, p) => {
                    this.emitLine(accessor, " ", this.phpType(p.type), " $", name, ";");
                });
                this.ensureBlankLine();
            }

            const docBlock: Sourcelike[] = [];
            this.forEachClassProperty(c, "none", (name, __, p) => {
                docBlock.push(["@param ", this.phpDocType(p.type), " $", name]);
            });
            this.emitDescriptionBlock(docBlock);
            this.emitLine("public function __construct(");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, __, p, position) => {
                    const prefix = constructorProperties ? [accessor, " "] : [""];
                    const suffix = ["last", "only"].includes(position) ? "" : ",";

                    this.emitLine(...prefix, this.phpType(p.type), " $", name, suffix);
                });
            });
            this.emitBlock(")", () => {
                if (!constructorProperties) {
                    this.forEachClassProperty(c, "none", name => {
                        this.emitLine("$this->", name, " = $", name, ";");
                    });
                }
            });

            this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, p) => {
                const desc = this.descriptionForClassProperty(c, jsonName);
                const names = defined(this._gettersAndSettersForPropertyName.get(name));

                this.ensureBlankLine();
                this.emitGetMethod(names, p, className, name, desc);
                this.ensureBlankLine();
                this.emitSetMethod(names, p, className, name, desc);
            });

            const { serializeWith } = this._options;
            const useStdClass = serializeWith === SerializeWith.stdClass;

            this.ensureBlankLine();
            if (useStdClass) {
                this.emitMethod({
                    name: "to",
                    body: () => {
                        this.emitLine("$out = new stdClass();");
                        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                            const to = this.phpToObjConvert(p.type, [], ["$this->", name]);
                            this.emitLine("$out->", jsonName, " = $this->", to, ";");
                        });
                        this.emitLine("return $out;");
                    },
                    returnType: "stdClass"
                });
            } else {
                this.emitMethod({
                    name: "to",
                    body: () => {
                        this.emitLine("return [");
                        this.indent(() => {
                            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                                const to = this.phpToObjConvert(p.type, [], ["$this->", name]);
                                this.emitLine("'", jsonName, "' => ", to, ",");
                            });
                        });
                        this.emitLine("];");
                    },
                    returnType: "array",
                    docBlockReturnType: "mixed[]"
                });
            }

            const { selfNameType, staticTypeAnnotation } = this._options;
            const self = selfNameType === "default" ? className : selfNameType;
            const returnType = staticTypeAnnotation ? "static" : selfNameType === "static" ? "self" : self;

            this.ensureBlankLine();
            if (useStdClass) {
                this.emitMethod({
                    name: "from",
                    body: () => {
                        this.emitLine("return new ", self, "(");
                        this.indent(() => {
                            this.forEachClassProperty(c, "none", (_name, jsonName, p, position) => {
                                const suffix = ["last", "only"].includes(position) ? "" : ",";
                                const from = this.phpFromObjConvert(className, p.type, [], ["$obj->", jsonName]);

                                this.emitLine(from, suffix);
                            });
                        });
                        this.emitLine(");");
                    },
                    args: ["stdClass $obj"],
                    returnType,
                    docBlockReturnType: self,
                    isStatic: true
                });
            } else {
                this.emitMethod({
                    name: "from",
                    body: () => {
                        this.emitLine("return new ", self, "(");
                        this.indent(() => {
                            this.forEachClassProperty(c, "none", (_name, jsonName, p, position) => {
                                const suffix = ["last", "only"].includes(position) ? "" : ",";
                                const from = this.phpFromObjConvert(className, p.type, [], ["$arr['", jsonName, "']"]);

                                this.emitLine(from, suffix);
                            });
                        });
                        this.emitLine(");");
                    },
                    args: ["array $arr"],
                    docBlockArgs: ["mixed[] $arr"],
                    returnType,
                    docBlockReturnType: self,
                    isStatic: true
                });
            }
        });
        this.finishFile();
    }

    protected emitUnionDefinition(_u: UnionType, _unionName: Name): void {
        throw Error("emitUnionDefinition not implemented");
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitFileHeader(enumName, []);
        this.emitDescription(this.descriptionForType(e));

        if (this._options.nativeEnums) {
            this.emitBlockWithBraceOnNewLine(["enum ", enumName, ": string"], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, " = '", jsonName, "';");
                });
            });
            return this.finishFile();
        }

        this.emitBlockWithBraceOnNewLine(["class ", enumName], () => {});
    }

    protected emitSourceStructure(givenFilename: string): void {
        this.emitLine("<?php");
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n)
        );
        if (this._options.withClosing) {
            this.emitLine("?>");
        }
        super.finishFile(defined(givenFilename));
    }
}
