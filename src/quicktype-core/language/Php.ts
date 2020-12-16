import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { DependencyName, FixedName, funPrefixNamer, Name, Namer, SimpleName } from "../Naming";
import { RenderContext } from "../Renderer";
import { BooleanOption, getOptionValues, Option, OptionValues } from "../RendererOptions";
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

export const phpOptions = {
    withGet: new BooleanOption("with-get", "Create Getter", true),
    fastGet: new BooleanOption("fast-get", "getter without validation", false),
    withSet: new BooleanOption("with-set", "Create Setter", false),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal)
};

export class PhpTargetLanguage extends TargetLanguage {
    constructor() {
        super("Php", ["php"], "php");
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
            to: toName,
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

    public emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected phpType(_reference: boolean, t: Type, isOptional: boolean = false, prefix: string = "?", suffix = ""): Sourcelike {
        function optionalize(s: Sourcelike) {
            return [isOptional ? prefix : "", s, isOptional ? suffix : ""];
        }
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(isOptional, anyTypeIssueAnnotation, "Object"),
            _nullType => maybeAnnotated(isOptional, nullTypeIssueAnnotation, "Object"),
            _boolType => optionalize("bool"),
            _integerType => optionalize("long"),
            _doubleType => optionalize("float"),
            _stringType => optionalize("string"),
            _arrayType => optionalize("array"),
            classType => optionalize(this.nameForNamedType(classType)),
            _mapType => optionalize("stdClass"),
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

    protected phpDocConvertType(className: Name, t: Type): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "any",
            _nullType => "null",
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "float",
            _stringType => "string",
            arrayType => [this.phpDocConvertType(className, arrayType.items), "[]"],
            _classType => _classType.getCombinedName(),
            _mapType => "stdClass",
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return [this.phpDocConvertType(className, nullable), "|null"];
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

    protected phpConvertType(className: Name, t: Type): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "any",
            _nullType => "null",
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "float",
            _stringType => "string",
            _arrayType => "array",
            _classType => "stdClass",
            _mapType => "stdClass",
            _enumType => "string", // TODO number this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return ["?", this.phpConvertType(className, nullable)];
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
            _anyType => this.emitLine(...lhs, " = ", ...args, "; /*any*/"),
            _nullType => this.emitLine(...lhs, " = ", ...args, "; /*null*/"),
            _boolType => this.emitLine(...lhs, " = ", ...args, "; /*bool*/"),
            _integerType => this.emitLine(...lhs, " = ", ...args, "; /*int*/"),
            _doubleType => this.emitLine(...lhs, " = ", ...args, "; /*float*/"),
            _stringType => this.emitLine(...lhs, " = ", ...args, "; /*string*/"),
            arrayType => {
                this.emitLine(...lhs, " = array_map(function ($value) {");
                this.indent(() => {
                    this.phpToObjConvert(className, arrayType.items, ["$tmp"], ["$value"]);
                    this.emitLine("return $tmp;");
                });
                this.emitLine("}, ", ...args, ");");
            },
            _classType => this.emitLine(...lhs, " = ", ...args, "->to(); ", "/*class*/"),
            mapType => {
                this.emitLine(...lhs, "= new stdClass();");
                this.emitBlock(["foreach (", ...args, " as $k => $v)"], () => {
                    this.phpToObjConvert(className, mapType.values, ["$tmp"], ["$v"]);
                    this.emitLine(...lhs, "->$k = $tmp;");
                });
            },
            enumType =>
                this.emitLine(...lhs, " = ", this.nameForNamedType(enumType), "::to(", ...args, "); ", "/*enum*/"),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitLine("if (!is_null(", ...args, ")) {");
                    this.indent(() => this.phpToObjConvert(className, nullable, lhs, args));
                    this.emitLine("}");
                    return;
                }
                throw Error("union are not supported");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    this.emitLine(...lhs, " = ", ...args, "->format(DateTimeInterface::ISO8601);");
                    return;
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    private phpValidate(className: Name, t: Type, attrName: Sourcelike, scopeAttrName: string) {
        const is = (isfn: string, myT: Name = className) => {
            this.emitBlock(["if (!", isfn, "(", scopeAttrName, "))"], () =>
                this.emitLine(
                    'throw new Exception("Attribute Error:',
                    myT,
                    "::",
                    attrName, "\");"
                )
            );
        };
        return matchType<void>(
            t,
            _anyType => { /* empty */ },
            _nullType => is("is_null"),
            _boolType => is("is_bool"),
            _integerType => is("is_integer"),
            _doubleType => is("is_float"),
            _stringType => is("is_string"),
            arrayType => {
                is("is_array");
                this.emitLine("array_walk($", attrName, ", function($value) {");
                this.indent(() => {
                    this.phpValidate(className, arrayType.items, "tmp", "$value");
                });
                this.emitLine("}, ", scopeAttrName, ");");
            },
            _classType => {
                this.emitLine(scopeAttrName, "->validate();");
            },
            mapType => {
                this.emitLine("foreach (", scopeAttrName, " as $k => $v) {");
                this.indent(() => {
                    this.phpValidate(className, mapType.values, "tmp", "$v");
                });
                this.emitLine("}");
            },
            _enumType => {
                this.emitLine(scopeAttrName, "->validate();");
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
                    this.emitLine(
                        "$",
                        attrName,
                        " = DateTime::createFromFormat(",
                        scopeAttrName,
                        ", DateTimeInterface::ISO8601);"
                    );
                    this.emitBlock(["if (!is_a($", attrName, ", 'DateTime'))"], () =>
                        this.emitLine(
                            'throw new Exception("Attribute Error:',
                            className,
                            "::",
                            attrName, "\");"
                        )
                    );
                    return;
                }
                throw Error(`transformedStringType.kind === ${transformedStringType.kind}`);
            }
        );
    }

    protected emitFromMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        // this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
        this.emitLine(" * @param ", this.phpDocConvertType(className, p.type), " $value");
        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpType(false, p.type));
        this.emitLine(" */");
        this.emitBlock([
            "public static function ",
            names.from,
            "(", this.phpConvertType(className, p.type), " $value): ", this.phpType(false, p.type)], () => {
                this.phpValidate(className, p.type, name, `$value`);
                this.emitLine("return $value;");
            }
        );
    }
    protected emitToMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpDocConvertType(className, p.type));
        this.emitLine(" */");
        this.emitBlock([
            "public function ",
            names.to,
            "(): ", this.phpConvertType(className, p.type)], () => {
                this.emitLine(className, "::", names.validate, "($this->", name, ");");
                this.phpToObjConvert(className, p.type, ["$value"], ["$this->", name]);
                this.emitLine("return $value;");
            });
    }
    protected emitValidateMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
        this.emitLine(" * @throws Exception");
        this.emitLine(" */");
        this.emitBlock([
            "public static function ",
            names.validate, "(", this.phpType(false, p.type), " $value)"], () => {
                this.phpValidate(className, p.type, name, `$value`);
            }
        );
    }
    protected emitGetMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        if (this._options.withGet) {
            this.emitLine("/**");
            if (desc) {
                this.emitLine(" * ", desc);
                this.emitLine(" *");
            }
            if (!this._options.fastGet) {
                this.emitLine(` * @throws Exception`);
            }
            const rendered = this.phpType(false, p.type);
            this.emitLine(" * @return ", rendered);
            this.emitLine(" */");
            this.emitBlock(["public function ", names.getter, "(): ", rendered], () => {
                if (!this._options.fastGet) {
                    this.emitLine(className, "::", names.validate, "($this->", name, ");");
                }
                this.emitLine("return $this->", name, ";");
            });
        }
    }
    protected emitSetMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        if (this._options.withSet) {
            this.emitLine("/**");
            if (desc) {
                this.emitLine(" * ", desc);
                this.emitLine(" *");
            }
            this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
            this.emitLine(` * @throws Exception`);
            this.emitLine(" */");
            this.emitBlock([
                "public function ",
                names.setter,
                "(", this.phpType(false, p.type), " $value)"], () => {
                    this.emitLine(className, "::", names.validate, "($value);");
                    this.emitLine("$this->", name, " = $value;");
                });
        }
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitFileHeader(className, []);

        this.emitBlock(["class ", className], () => {
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                this.emitLine(
                    "private ",
                    this.phpType(false, p.type),
                    " $",
                    name,
                    "; // json:",
                    jsonName,
                    " ",
                    p.type.isNullable ? "Optional" : "Required"
                );
            });

            this.ensureBlankLine();
            const comments: Sourcelike[][] = [];
            const args: Sourcelike[][] = [];
            let prefix = "";
            this.forEachClassProperty(c, "none", (name, __, p) => {
                args.push([prefix, this.phpType(false, p.type), " $", name]);
                prefix = ", ";
                comments.push([" * @param ", this.phpType(false, p.type, false, "", "|null"), " $", name, "\n"]);
            });
            this.emitBlock(["/**\n", ...comments, " */\n", "public function __construct(", ...args, ")"], () => {
                this.forEachClassProperty(c, "none", name => {
                    this.emitLine("$this->", name, " = $", name, ";");
                });
            });

            this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, p) => {
                const desc = this.descriptionForClassProperty(c, jsonName);
                const names = defined(this._gettersAndSettersForPropertyName.get(name));

                this.emitFromMethod(names, p, className, name, desc);
                this.emitToMethod(names, p, className, name, desc);
                this.emitValidateMethod(names, p, className, name, desc);
                this.emitGetMethod(names, p, className, name, desc);
                this.emitSetMethod(names, p, className, name, desc);
            });

            this.emitBlock(["/**\n",
                ` * @throws Exception\n`,
                " */\n",
                "public function validate()"], () => {
                    this.forEachClassProperty(c, "none", (name, _jsonName, _p) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        this.emitLine(className, "::", names.validate, "($this->", name, ");");
                    });
                });

            this.emitBlock(["/**\n",
                ` * @return stdClass\n`,
                ` * @throws Exception\n`,
                " */\n",
                "public function to(): stdClass "], () => {
                    this.emitLine("$out = new stdClass();");
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        this.emitLine("$out->{'", jsonName, "'} = $this->", names.to, "();");
                    });
                    this.emitLine("return $out;");
                });

            this.emitBlock(
                ["/**\n",
                    ` * @param stdClass $obj\n`,
                    ` * @return `, className, `\n`,
                    ` * @throws Exception\n`,
                    " */\n", "public static function from(stdClass $obj): ", className],
                () => {
                    if (this._options.fastGet) {
                        this.forEachClassProperty(c, "none", (name) => {
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine(className, "::", names.validate, "($this->", name, ", true);");
                        });
                    }
                    this.emitLine("return new ", className, "(");
                    let comma = " ";
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        this.emitLine(comma, className, "::", names.from, "($obj->{\'", jsonName, "\'})");
                        comma = ",";
                    });
                    this.emitLine(");");
                }
            );
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
        const caseNames: Sourcelike[] = [];
        caseNames.push(";");
        const enumSerdeType = "string";
        this.emitBlock(["class ", enumName], () => {
            this.forEachEnumCase(e, "none", (name, _jsonName) => {
                this.emitLine("public static ", enumName, " $", name, ";");
            });

            this.emitBlock("public static function init()", () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine(enumName, "::$", name, " = new ", enumName, "(\'", jsonName, "\');");
                });
            });

            this.emitLine("private ", enumSerdeType, " $enum;");
            this.emitBlock(["public function __construct(", enumSerdeType, " $enum)"], () => {
                this.emitLine("$this->enum = $enum;");
            });

            this.ensureBlankLine();
            this.emitEnumSerializationAttributes(e);
            this.emitBlock(["/**\n",
                ` * @param `, enumName, `\n`,
                ` * @return `, enumSerdeType, `\n`,
                ` * @throws Exception\n`,
                " */\n",
                "public static function to(", enumName, " $obj): ", enumSerdeType], () => {
                    this.emitLine("switch ($obj) {");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            // Todo String or Number
                            this.emitLine("case ", enumName, "::$", name, "->enum: return '", stringEscape(jsonName), "';");
                        });
                    });
                    this.emitLine("}");
                    this.emitLine("throw new Exception('the give value is not an enum-value.');");
                });
            this.ensureBlankLine();

            this.emitEnumDeserializationAttributes(e);

            this.emitBlock([
                "/**\n",
                ` * @param mixed\n`,
                ` * @return `, enumName, "\n",
                ` * @throws Exception\n`,
                " */\n",
                "public static function from($obj): ", enumName], () => {
                    this.emitLine("switch ($obj) {");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            // Todo String or Enum
                            this.emitLine("case '", stringEscape(jsonName), "': return ", enumName, "::$", name, ";");
                        });
                    });
                    this.emitLine("}");
                    this.emitLine('throw new Exception("Cannot deserialize ', enumName, '");');
                });
        });
        this.emitLine(enumName, "::init();");
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
        this.emitLine("?>");
        super.finishFile(defined(givenFilename));
    }
}
