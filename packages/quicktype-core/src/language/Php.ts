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

export const phpOptions = {
    withGet: new BooleanOption("with-get", "Create Getter", true),
    fastGet: new BooleanOption("fast-get", "getter without validation", false),
    withSet: new BooleanOption("with-set", "Create Setter", false),
    withClosing: new BooleanOption("with-closing", "PHP Closing Tag", false),
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
    readonly validate: Name;
    readonly from: Name;
    readonly to: Name;
}

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
        const validateName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `validate_${lookup(name)}`
        );
        const fromName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `from_${lookup(name)}`
        );
        const toName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `to_${lookup(name)}`
        );
        return {
            getter: getterName,
            setter: setterName,
            validate: validateName,
            from: fromName,
            to: toName
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
        return [
            getterAndSetterNames.getter,
            getterAndSetterNames.setter,
            getterAndSetterNames.validate,
            getterAndSetterNames.to,
            getterAndSetterNames.from
        ];
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
        this.emitLine("// This is a autogenerated file:", fileName);
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

    protected phpType(_reference: boolean, t: Type, isOptional = false, prefix = "?", suffix = ""): Sourcelike {
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
                if (nullable !== null) return this.phpType(true, nullable, true, prefix, suffix);
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

    protected phpDocType(className: Name, t: Type): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "any",
            _nullType => "null",
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "float",
            _stringType => "string",
            arrayType => [this.phpDocType(className, arrayType.items), "[]"],
            classType => this.nameForNamedType(classType),
            _mapType => (this._options.serializeWith === SerializeWith.stdClass ? "stdClass" : "array"),
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return ["?", this.phpDocType(className, nullable)];
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

    protected phpToObjConvert(className: Name, t: Type, lhs: Sourcelike[], args: Sourcelike[]) {
        return matchType<void>(
            t,
            _anyType => this.emitLine(...lhs, ...args, ";"),
            _nullType => this.emitLine(...lhs, ...args, ";"),
            _boolType => this.emitLine(...lhs, ...args, ";"),
            _integerType => this.emitLine(...lhs, ...args, ";"),
            _doubleType => this.emitLine(...lhs, ...args, ";"),
            _stringType => this.emitLine(...lhs, ...args, ";"),
            arrayType => {
                this.emitLine(...lhs, "array_map(function ($value) {");
                this.indent(() => {
                    this.phpToObjConvert(className, arrayType.items, ["return "], ["$value"]);
                });
                this.emitLine("}, ", ...args, ");");
            },
            _classType => this.emitLine(...lhs, ...args, "->to();"),
            mapType => {
                // TODO: this._options.serializeWith === SerializeWith.stdClass
                this.emitBlockWithBraceOnNewLine(["function to($my): stdClass"], () => {
                    this.emitLine("$out = new stdClass();");
                    this.emitBlock(["foreach ($my as $k => $v)"], () => {
                        this.phpToObjConvert(className, mapType.values, ["$my->$k = "], ["$v"]);
                    });
                    this.emitLine("return $out;");
                });
                this.emitLine("return to(", ...args, ");");
            },
            _enumType => this.emitLine(...lhs, ...args, "->to();"),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitLine("if (!is_null(", ...args, ")) {");
                    this.indent(() => this.phpToObjConvert(className, nullable, lhs, args));
                    this.emitLine("} else {");
                    this.indent(() => this.emitLine(...lhs, " null;"));
                    this.emitLine("}");
                    return;
                }
                throw Error("union are not supported");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    this.emitLine(...lhs, ...args, "->format(DateTimeInterface::ISO8601);");
                    return;
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    private transformDateTime(className: Name, attrName: Sourcelike, scopeAttrName: Sourcelike[]) {
        this.emitBlock(["if (!is_a(", scopeAttrName, ", 'DateTime'))"], () =>
            this.emitLine("throw new Exception('Attribute Error:", className, "::", attrName, "');")
        );
    }

    protected phpFromObjConvert(className: Name, t: Type, lhs: Sourcelike[], args: Sourcelike[]) {
        return matchType<void>(
            t,
            _anyType => this.emitLine(...lhs, ...args, ";"),
            _nullType => this.emitLine(...lhs, ...args, ";"),
            _boolType => this.emitLine(...lhs, ...args, ";"),
            _integerType => this.emitLine(...lhs, ...args, ";"),
            _doubleType => this.emitLine(...lhs, ...args, ";"),
            _stringType => this.emitLine(...lhs, ...args, ";"),
            arrayType => {
                this.emitLine(...lhs, "array_map(function ($value) {");
                this.indent(() => {
                    this.phpFromObjConvert(className, arrayType.items, ["return "], ["$value"]);
                });
                this.emitLine("}, ", ...args, ");");
            },
            classType => this.emitLine(...lhs, this.nameForNamedType(classType), "::from(", ...args, ");"),
            mapType => {
                // TODO: this._options.serializeWith === SerializeWith.stdClass
                this.emitBlockWithBraceOnNewLine(["function from($my): stdClass"], () => {
                    this.emitLine("$out = new stdClass();");
                    this.emitBlock(["foreach ($my as $k => $v)"], () => {
                        this.phpFromObjConvert(className, mapType.values, ["$out->$k = "], ["$v"]);
                    });
                    this.emitLine("return $out;");
                });
                this.emitLine("return from(", ...args, ");");
            },
            enumType => this.emitLine(...lhs, this.nameForNamedType(enumType), "::from(", ...args, ");"),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitLine("if (!is_null(", ...args, ")) {");
                    this.indent(() => this.phpFromObjConvert(className, nullable, lhs, args));
                    this.emitLine("} else {");
                    this.indent(() => this.emitLine("return null;"));
                    this.emitLine("}");
                    return;
                }
                throw Error("union are not supported");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    this.emitLine("$tmp = ", "DateTime::createFromFormat(DateTimeInterface::ISO8601, ", args, ");");
                    this.transformDateTime(className, "", ["$tmp"]);
                    this.emitLine("return $tmp;");
                    return;
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
                this.emitLine(scopeAttrName, "->to();");
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

    protected emitFromMethod(names: FunctionNames, p: ClassProperty, className: Name, _name: Name, desc?: string[]) {
        const docBlock: Sourcelike[] = [];
        if (desc !== undefined) {
            docBlock.push([...desc, "\n *"]);
        }
        const valueType = p.type.kind === "array" ? "mixed[]" : this.phpDocType(className, p.type);
        docBlock.push(["@param ", valueType, " $value"]);
        docBlock.push(["@throws Exception"]);
        docBlock.push(["@return ", this.phpDocType(className, p.type)]);
        this.emitDescriptionBlock(docBlock);
        this.emitBlockWithBraceOnNewLine(
            [
                "public static function ",
                names.from,
                "(",
                this.phpType(false, p.type),
                " $value): ",
                this.phpType(false, p.type)
            ],
            () => {
                this.phpFromObjConvert(className, p.type, ["return "], ["$value"]);
            }
        );
    }
    protected emitToMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        const docBlock: Sourcelike[] = [];
        if (desc !== undefined) {
            docBlock.push([...desc, "\n *"]);
        }
        docBlock.push(["@throws Exception"]);
        docBlock.push(["@return ", this.phpDocType(className, p.type)]);
        this.emitDescriptionBlock(docBlock);
        this.emitBlockWithBraceOnNewLine(["public function ", names.to, "(): ", this.phpType(false, p.type)], () => {
            this.emitBlock(["if (", className, "::", names.validate, "($this->", name, "))"], () => {
                this.phpToObjConvert(className, p.type, ["return "], ["$this->", name]);
            });
            this.emitLine("throw new Exception('never get to this ", className, "::", name, "');");
        });
    }
    protected emitValidateMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        const docBlock: Sourcelike[] = [];
        if (desc !== undefined) {
            docBlock.push([...desc, "\n *"]);
        }
        docBlock.push(["@param ", this.phpDocType(className, p.type), " $value"]);
        docBlock.push(["@throws Exception"]);
        docBlock.push(["@return bool"]);
        this.emitDescriptionBlock(docBlock);
        this.emitBlockWithBraceOnNewLine(
            ["public static function ", names.validate, "(", this.phpType(false, p.type), " $value): bool"],
            () => {
                this.phpValidate(className, p.type, name, "$value");
                this.emitLine("return true;");
            }
        );
    }
    protected emitGetMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        if (!this._options.withGet) {
            return;
        }

        const docBlock: Sourcelike[] = [];
        if (desc !== undefined) {
            docBlock.push([...desc, "\n *"]);
        }
        if (!this._options.fastGet) {
            docBlock.push(["@throws Exception"]);
        }
        docBlock.push(["@return ", this.phpDocType(className, p.type)]);
        this.emitDescriptionBlock(docBlock);
        this.emitBlockWithBraceOnNewLine(
            ["public function ", names.getter, "(): ", this.phpType(false, p.type)],
            () => {
                if (this._options.fastGet) {
                    return this.emitLine("return $this->", name, ";");
                }

                this.emitBlock(["if (", className, "::", names.validate, "($this->", name, "))"], () => {
                    this.emitLine("return $this->", name, ";");
                });
                this.emitLine("throw new Exception('never get to ", names.getter, " ", className, "::", name, "');");
            }
        );
    }
    protected emitSetMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        if (!this._options.withSet) {
            return;
        }

        const docBlock: Sourcelike[] = [];
        if (desc !== undefined) {
            docBlock.push([...desc, "\n *"]);
        }
        docBlock.push(["@param ", this.phpDocType(className, p.type)]);
        docBlock.push(["@throws Exception"]);
        docBlock.push(["@return void"]);
        this.emitDescriptionBlock(docBlock);
        this.emitBlockWithBraceOnNewLine(
            ["public function ", names.setter, "(", this.phpType(false, p.type), " $value): void"],
            () => {
                this.emitBlock(["if (", className, "::", names.validate, "($value))"], () => {
                    this.emitLine("$this->", name, " = $value;");
                });
            }
        );
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitFileHeader(className, []);

        this.emitBlockWithBraceOnNewLine(["class ", className], () => {
            const { constructorProperties } = this._options;

            if (!constructorProperties) {
                this.forEachClassProperty(c, "none", (name, _jsonName, p) => {
                    this.emitLine("protected ", this.phpType(false, p.type), " $", name, ";");
                });
                this.ensureBlankLine();
            }

            const docBlock: Sourcelike[] = [];
            this.forEachClassProperty(c, "none", (name, __, p) => {
                docBlock.push(["@param ", this.phpDocType(className, p.type), " $", name]);
            });
            this.emitDescriptionBlock(docBlock);
            this.emitLine("public function __construct(");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, __, p, position) => {
                    const prefix = constructorProperties ? "protected " : "";
                    const suffix = ["last", "only"].includes(position) ? "" : ",";

                    this.emitLine(prefix, this.phpType(false, p.type), " $", name, suffix);
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
                this.emitFromMethod(names, p, className, name, desc);
                this.ensureBlankLine();
                this.emitToMethod(names, p, className, name, desc);
                this.ensureBlankLine();
                this.emitValidateMethod(names, p, className, name, desc);
                this.ensureBlankLine();
                this.emitGetMethod(names, p, className, name, desc);
                this.ensureBlankLine();
                this.emitSetMethod(names, p, className, name, desc);
            });

            this.ensureBlankLine();
            this.emitDescriptionBlock(["@throws Exception", "@return bool"]);
            this.emitBlockWithBraceOnNewLine(["public function validate(): bool"], () => {
                this.forEachClassProperty(c, "none", (name, _jsonName, _p, position) => {
                    const isFirstLine = ["first", "only"].includes(position);
                    const isLastLine = ["last", "only"].includes(position);
                    const prefix = isFirstLine ? "return " : "|| ";
                    const suffix = isLastLine ? ";" : "";

                    const names = defined(this._gettersAndSettersForPropertyName.get(name));
                    const line: Sourcelike = [prefix, className, "::", names.validate, "($this->", name, ")", suffix];

                    if (isFirstLine) {
                        this.emitLine(line);
                    } else {
                        this.indent(() => {
                            this.emitLine(line);
                        });
                    }
                });
            });

            this.ensureBlankLine();
            if (this._options.serializeWith === SerializeWith.stdClass) {
                this.emitDescriptionBlock(["@throws Exception", "@return stdClass"]);
                this.emitBlockWithBraceOnNewLine(["public function to(): stdClass"], () => {
                    this.emitLine("$out = new stdClass();");
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        this.emitLine("$out->", jsonName, " = $this->", names.to, "();");
                    });
                    this.emitLine("return $out;");
                });
            } else {
                this.emitDescriptionBlock(["@throws Exception", "@return mixed[]"]);
                this.emitBlockWithBraceOnNewLine(["public function to(): array"], () => {
                    this.emitLine("return [");
                    this.indent(() => {
                        this.forEachClassProperty(c, "none", (name, jsonName) => {
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine("'", jsonName, "' => $this->", names.to, "(),");
                        });
                    });
                    this.emitLine("];");
                });
            }

            this.ensureBlankLine();
            if (this._options.serializeWith === SerializeWith.stdClass) {
                this.emitDescriptionBlock(["@param stdClass $obj", "@throws Exception", ["@return ", className]]);
                this.emitBlockWithBraceOnNewLine(["public static function from(stdClass $obj): ", className], () => {
                    if (this._options.fastGet) {
                        this.forEachClassProperty(c, "none", name => {
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine(className, "::", names.validate, "($this->", name, ", true);");
                        });
                    }
                    this.emitLine("return new ", className, "(");
                    this.indent(() => {
                        this.forEachClassProperty(c, "none", (name, jsonName, _, position) => {
                            const suffix = ["last", "only"].includes(position) ? "" : ",";
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine(className, "::", names.from, "($obj->", jsonName, ")", suffix);
                        });
                    });
                    this.emitLine(");");
                });
            } else {
                this.emitDescriptionBlock(["@param mixed[] $arr", "@throws Exception", ["@return ", className]]);
                this.emitBlockWithBraceOnNewLine(["public static function from(array $arr): ", className], () => {
                    if (this._options.fastGet) {
                        this.forEachClassProperty(c, "none", name => {
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine(className, "::", names.validate, "($this->", name, ", true);");
                        });
                    }
                    this.emitLine("return new ", className, "(");
                    this.indent(() => {
                        this.forEachClassProperty(c, "none", (name, jsonName, _, position) => {
                            const suffix = ["last", "only"].includes(position) ? "" : ",";
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine(className, "::", names.from, "($arr['", jsonName, "'])", suffix);
                        });
                    });
                    this.emitLine(");");
                });
            }
        });
        this.finishFile();
    }

    protected emitUnionAttributes(_u: UnionType, _unionName: Name): void {
        // empty
    }

    protected emitUnionSerializer(_u: UnionType, _unionName: Name): void {
        // empty
    }

    protected emitUnionDefinition(_u: UnionType, _unionName: Name): void {
        throw Error("emitUnionDefinition not implemented");
    }

    protected emitEnumSerializationAttributes(_e: EnumType) {
        // Empty
    }

    protected emitEnumDeserializationAttributes(_e: EnumType) {
        // Empty
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitFileHeader(enumName, []);
        this.emitDescription(this.descriptionForType(e));
        this.emitBlockWithBraceOnNewLine(["class ", enumName], () => {
            const { constructorProperties } = this._options;

            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine("public const ", name, " = '", jsonName, "';");
            });
            this.ensureBlankLine();

            this.emitLine("public const VALUES = [");
            this.indent(() => {
                this.forEachEnumCase(e, "none", name => {
                    this.emitLine(enumName, "::", name, ",");
                });
            });
            this.emitLine("];");
            this.ensureBlankLine();

            if (!constructorProperties) {
                this.emitLine("protected string $enum;");
                this.ensureBlankLine();
            }

            this.emitBlockWithBraceOnNewLine(
                ["public function __construct(", constructorProperties ? "protected " : "", "string $enum)"],
                () => {
                    if (!constructorProperties) {
                        this.emitLine("$this->enum = $enum;");
                    }
                }
            );

            this.ensureBlankLine();
            this.emitEnumSerializationAttributes(e);

            this.emitDescriptionBlock(["@throws Exception", "@return string"]);
            this.emitBlockWithBraceOnNewLine(["public function to(): string"], () => {
                this.emitBlock(["if (in_array($this->enum, ", enumName, "::VALUES, true))"], () => {
                    this.emitLine("return $this->enum;");
                });
                this.emitLine("throw new Exception('the give value is not an enum-value.');");
            });
            this.ensureBlankLine();
            this.emitEnumDeserializationAttributes(e);

            this.emitDescriptionBlock(["@param mixed", "@throws Exception", ["@return ", enumName]]);
            this.emitBlockWithBraceOnNewLine(["public static function from($obj): ", enumName], () => {
                this.emitBlock(["if (in_array($obj, ", enumName, "::VALUES, true))"], () => {
                    this.emitLine("return new ", enumName, "($obj);");
                });
                this.emitLine("throw new Exception('Cannot deserialize ", enumName, "');");
            });
        });
        this.finishFile();
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
