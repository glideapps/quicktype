// import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { DependencyName, funPrefixNamer, Name, Namer } from "../Naming";
import { RenderContext } from "../Renderer";
import { BooleanOption, getOptionValues, Option, OptionValues } from "../RendererOptions";
import { Sourcelike } from "../Source";
import { acronymOption, acronymStyle, AcronymStyleOptions } from "../support/Acronyms";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    splitIntoWords,
    utf16ConcatMap
} from "../support/Strings";
import { defined } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { ArrayType, ClassProperty, ClassType, EnumType, MapType, Type, UnionType } from "../Type";
import { directlyReachableSingleNamedType, matchType, nullableFromUnion } from "../TypeUtils";
import { StringTypeMapping, TransformedStringTypeKind, PrimitiveStringTypeKind, PrimitiveType } from "..";
import * as _ from "lodash";

// type ArrayBlockFN = (
//     className: Name,
//     t: ArrayType,
//     attr: Sourcelike,
//     scopeAttr: Sourcelike,
//     isBlockFn: IsBlockFN,
//     afterBlockFn: IsBlockFN,
//     arrayBlock: (i: IsBlockFN) => ArrayBlockFN,
//     mapBlock: (i: IsBlockFN) => IsBlockFN
// ) => void;
interface IsAndBlock<T extends Type> {
    readonly is: Sourcelike;
    readonly block: IsBlockFN<T>;
}
type IsBlockFN<T extends Type> = (
    className: Name,
    t: T,
    attr: Sourcelike,
    scopeAttr: Sourcelike,
    isBlockFn: IsBlockFN<T>,
    afterBlockFn: IsBlockFN<T> | undefined,
    classMatch: (ct: ClassType, scoped: Sourcelike) => IsAndBlock<T>,
    arrayBlock: (i: IsBlockFN<T>) => IsBlockFN<ArrayType>,
    mapBlock: (i: IsBlockFN<T>) => IsBlockFN<MapType>,
    unionIsNullAfterBlock: IsBlockFN<T> | undefined
) => boolean;

export const phpOptions = {
    withGet: new BooleanOption("with-get", "Create Getter", true),
    fast: new BooleanOption("fast", "setter and getter without validation", false),
    withSet: new BooleanOption("with-set", "Create Setter", true),
    withSample: new BooleanOption("with-sample", "Create Sample", false),
    withClosing: new BooleanOption("with-closing", "PHP Closing Tag", false),
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

export const stringEscape = (m: string) => {
    return utf16ConcatMap(u => (u === 0x27 ? "\\'" : u === 0x5c ? "\\\\" : String.fromCharCode(u)))(m);
};

const legalStartChars = [
    0x5f,
    ...Array(26)
        .fill(0)
        .map((__, i) => i + 65),
    ...Array(26)
        .fill(0)
        .map((__, i) => i + 97)
];
function isStartCharacter(codePoint: number): boolean {
    return legalStartChars.indexOf(codePoint) >= 0;
}

const legalChars = [
    0x5f,
    ...Array(10)
        .fill(0)
        .map((__, i) => i + 48),
    ...Array(26)
        .fill(0)
        .map((__, i) => i + 65),
    ...Array(26)
        .fill(0)
        .map((__, i) => i + 97)
];
function isIdentifier(codePoint: number): boolean {
    return legalChars.indexOf(codePoint) >= 0;
}

const legalizeName = (m: string) => {
    return utf16ConcatMap(u => (isIdentifier(u) ? String.fromCharCode(u) : `U${u}`))(m);
};

export function phpNameStyle(
    startWithUpper: boolean,
    upperUnderscore: boolean,
    original: string,
    acronymsStyle: (s: string) => string = allUpperWordStyle
): string {
    const words = splitIntoWords(legalizeName(original));
    const ret = combineWords(
        words,
        legalizeName,
        upperUnderscore ? allUpperWordStyle : startWithUpper ? firstUpperWordStyle : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper ? allUpperWordStyle : allLowerWordStyle,
        acronymsStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
    return ret;
}

export interface FunctionNames {
    readonly getter: Name;
    readonly setter: Name;
    readonly validate: Name;
    readonly match: Name;
    readonly from: Name;
    readonly to: Name;
    readonly sample: Name;
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
        // console.log("Name:", jsonName, "::", name as SimpleNameType);
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
        const matchName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `match_${lookup(name)}`
        );
        const toName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `to_${lookup(name)}`
        );
        const sampleName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            lookup => `sample_${lookup(name)}`
        );
        return {
            getter: getterName,
            setter: setterName,
            validate: validateName,
            match: matchName,
            from: fromName,
            to: toName,
            sample: sampleName
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
            getterAndSetterNames.match,
            getterAndSetterNames.to,
            getterAndSetterNames.from,
            getterAndSetterNames.sample
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

    public emitBlock(line: Sourcelike, f: () => void, suffix: Sourcelike = []): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}", suffix);
    }

    protected phpType(t: Type, nullType: string = "?bool"): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "mixed",
            _nullType => nullType,
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "float",
            _stringType => "string",
            _arrayType => "array",
            classType => [this.nameForNamedType(classType), ""],
            _mapType => "stdClass",
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return ["?", this.phpType(nullable)];
                }
                let prefix = "";
                return _.flatten(
                    Array.from(unionType.sortedMembers).map(m => {
                        const ret = [prefix, this.phpType(m, "null")];
                        prefix = "|";
                        return ret;
                    })
                );
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

    protected phpDocType(t: Type, nullValue: string = "bool|null"): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "mixed",
            _nullType => nullValue,
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "float",
            _stringType => "string",
            _arrayType => ["array<", this.phpType(_arrayType.items), ">"],
            classType => [this.nameForNamedType(classType), ""],
            _mapType => "stdClass",
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return [this.phpDocType(nullable), "|null"];
                }
                let prefix = "";
                return _.flatten(
                    Array.from(unionType.sortedMembers).map(m => {
                        const ret = [prefix, this.phpDocType(m, "null")];
                        prefix = "|";
                        return ret;
                    })
                );
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

    protected phpDocConvertType(className: Name, t: Type, nullValue: string = "bool|null"): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "any",
            _nullType => nullValue,
            _boolType => "bool",
            _integerType => "int",
            _doubleType => "float",
            _stringType => "string",
            arrayType => {
                return ["array<", this.phpDocConvertType(className, arrayType.items), ">"];
            },
            _classType => "stdClass",
            _mapType => "stdClass",
            _enumType => "string",
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return [this.phpDocConvertType(className, nullable), "|null"];
                }
                let prefix = "";
                return _.flatten(
                    Array.from(unionType.sortedMembers).map(m => {
                        const ret = [prefix, this.phpDocConvertType(className, m, "null")];
                        prefix = "|";
                        return ret;
                    })
                );
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return "DateTime";
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    protected phpConvertType(className: Name, t: Type, nullType: string = "?bool"): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "any",
            _nullType => nullType,
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
                return "mixed";
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return "string";
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    protected phpToObjConvert(className: Name, t: Type, attrName: Sourcelike, scopeAttrName: Sourcelike) {
        const isBlock = (_className: any, _t: any, _attr: any, scoped: Sourcelike) => {
            this.emitLine("return ", scoped, ";");
            return true;
        };
        const afterBlock = (_className: any, _t: any, attr: any, scoped: Sourcelike) => {
            this.emitLine(
                "throw new Exception('from not valid:",
                className,
                "::",
                attr,
                "=>['.serialize(",
                scoped,
                ").']');"
            );
            // this.emitLine("throw new Exception('not valid:", className, "::", attrName, "');")
            // this.emitLine("return false;");
            return true;
        };
        let mapBlock = (_ib: IsBlockFN<Type>): IsBlockFN<MapType> => {
            throw Error("never reached");
        };
        const arrayBlock = (_isBFn: IsBlockFN<Type>) => (
            _name: Name,
            itemT: ArrayType,
            attr: Sourcelike,
            scoped: Sourcelike
        ) => {
            this.emitLine("return (function(array $arr): array {");
            this.indent(() => {
                this.emitLine("$idx = 0;");
                this.emitLine("return array_map(function($v) use($idx) {");
                this.indent(() => {
                    this.emitLine("$idx++;");
                    this.phpToObjConvert(className, itemT.items, [attr, "['.($idx-1).']"], "$v");
                });
                this.emitLine("}, $arr);");
            });
            this.emitLine("})(", scoped, ");");
            return true;
        };
        mapBlock = (_isBFn: IsBlockFN<Type>) => (_name: Name, itemT: MapType, attr: Sourcelike, scoped: Sourcelike) => {
            this.emitLine("return (function($myi) {");
            this.indent(() => {
                this.emitLine("$myo = new stdClass();");
                this.emitLine("foreach ($myi as $k => $v) {");
                this.indent(() => {
                    this.emitLine("$myo->$k = (function($k, $v) {");
                    this.indent(() => this.phpToObjConvert(className, itemT.values, [attr, "['.$k.']"], ["$v"]));
                    this.emitLine("})($k, $v);");
                });
                this.emitLine("}");
                this.emitLine("return $myo;");
            });
            this.emitLine("})(", scoped, ");");
            return true;
        };
        const classBlock = (ct: ClassType, scoped: Sourcelike): IsAndBlock<Type> => {
            return {
                is: ["is_a(", scoped, ", '", this.nameForNamedType(ct), "')"],
                block: () => {
                    this.emitLine("return ", scoped, "->to();");
                    return true;
                }
            };
        };
        this.phpIsBlock(
            className,
            t,
            attrName,
            scopeAttrName,
            isBlock,
            afterBlock,
            classBlock,
            arrayBlock,
            mapBlock,
            () => {
                this.emitLine("return null;");
                return true;
            }
        );
    }

    private transformDateTime(
        className: Name,
        attrName: Sourcelike,
        scopeAttrName: Sourcelike[],
        returnVal: Sourcelike,
        skipThrow: boolean
    ) {
        this.emitBlock(["if (is_a(", scopeAttrName, ", 'DateTime'))"], () => this.emitLine(returnVal));
        if (!skipThrow) {
            this.emitLine("throw new Exception('Attribute Error:", className, "::", attrName, "');");
        }
        // if (lhs !== undefined) {
        //     this.emitLine(lhs, "$tmp;");
        // }
    }

    protected phpFromObjConvert(className: Name, t: Type, attrName: Sourcelike, scopeAttrName: Sourcelike) {
        const isBlock = (_className: any, _t: any, _attr: any, scoped: Sourcelike) => {
            this.emitLine("return ", scoped, ";");
            return true;
        };
        const afterBlock = (_className: any, _t: any, attr: any, scoped: Sourcelike) => {
            this.emitLine(
                "throw new Exception('from not valid:",
                className,
                "::",
                attr,
                "=>['.serialize(",
                scoped,
                ").']');"
            );
            return true;
        };
        let mapBlock = (_ib: IsBlockFN<Type>): IsBlockFN<MapType> => {
            throw Error("never reached");
        };
        const arrayBlock = (_isBFn: IsBlockFN<Type>) => (
            _name: Name,
            itemT: ArrayType,
            attr: Sourcelike,
            scoped: Sourcelike
        ) => {
            this.emitLine("return (function(array $arr): array {");
            this.indent(() => {
                this.emitLine("$idx = 0;");
                this.emitLine("return array_map(function($v) use($idx) {");
                this.indent(() => {
                    this.emitLine("$idx++;");
                    this.phpFromObjConvert(className, itemT.items, [attr, "['.($idx-1).']"], "$v");
                });
                this.emitLine("}, $arr);");
            });
            this.emitLine("})(", scoped, ");");
            return true;
        };
        mapBlock = (_isBFn: IsBlockFN<Type>) => (_name: Name, itemT: MapType, attr: Sourcelike, scoped: Sourcelike) => {
            this.emitLine("return (function($myi) {");
            this.indent(() => {
                this.emitLine("$myo = new stdClass();");
                this.emitLine("foreach ($myi  as $k => $v) {");
                this.indent(() => {
                    this.emitLine("$myo->$k = (function($k, $v) {");
                    this.indent(() => this.phpFromObjConvert(className, itemT.values, [attr, "['.$k.']"], ["$v"]));
                    this.emitLine("})($k, $v);");
                });
                this.emitLine("}");
                this.emitLine("return $myo;");
            });
            this.emitLine("})(", scoped, ");");
            return true;
        };
        const classBlock = (itemT: ClassType, scoped: Sourcelike) => {
            return {
                is: ["is_a(", scoped, ", 'stdClass') && ", this.nameForNamedType(itemT), "::match(", scoped, ")"],
                block: () => {
                    this.emitLine("return ", this.nameForNamedType(itemT), "::from(", scoped, ");");
                    return true;
                }
            };
        };
        this.phpIsBlock(
            className,
            t,
            attrName,
            scopeAttrName,
            isBlock,
            afterBlock,
            classBlock,
            arrayBlock,
            mapBlock,
            () => {
                this.emitLine("return null;");
                return true;
            }
        );
    }

    protected phpSampleConvert(
        className: Name,
        t: Type,
        lhs: Sourcelike[],
        args: Sourcelike[],
        idx: number,
        suffix: Sourcelike
    ) {
        return matchType<void>(
            t,
            _anyType =>
                this.emitLine(
                    ...lhs,
                    "'AnyType::",
                    className,
                    "::",
                    args,
                    "::" + idx,
                    "'",
                    suffix,
                    "/*",
                    "" + idx,
                    ":",
                    args,
                    "*/"
                ),
            _nullType => this.emitLine(...lhs, "null", suffix, " /*", "" + idx, ":", args, "*/"),
            _boolType => this.emitLine(...lhs, "true", suffix, " /*", "" + idx, ":", args, "*/"),
            _integerType => this.emitLine(...lhs, "" + idx, suffix, " /*", "" + idx, ":", args, "*/"),
            _doubleType => this.emitLine(...lhs, "" + (idx + idx / 1000), suffix, " /*", "" + idx, ":", args, "*/"),
            _stringType =>
                this.emitLine(
                    ...lhs,
                    "'",
                    className,
                    "::",
                    args,
                    "::" + idx,
                    "'",
                    suffix,
                    " /*",
                    "" + idx,
                    ":",
                    args,
                    "*/"
                ),
            arrayType => {
                this.emitLine(...lhs, " array(");
                this.indent(() => {
                    this.phpSampleConvert(className, arrayType.items, [], [], idx, "");
                });
                this.emitLine(")", suffix, "/* ", "" + idx, ":", args, "*/");
            },
            classType =>
                this.emitLine(
                    ...lhs,
                    this.nameForNamedType(classType),
                    "::sample()",
                    suffix,
                    " /*",
                    "" + idx,
                    ":",
                    args,
                    "*/"
                ),
            mapType => {
                this.emitBlock(
                    [...lhs, "(function(): stdClass"],
                    () => {
                        this.emitLine("$out = new stdClass();");
                        this.phpSampleConvert(
                            className,
                            mapType.values,
                            ["$out->{'", className, "'} = "],
                            args,
                            idx,
                            ";"
                        );
                        this.emitLine("return $out;");
                    },
                    [")()", suffix]
                );
            },
            enumType => this.emitLine(...lhs, this.nameForNamedType(enumType), "::sample()", suffix, " /*enum*/"),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitLine("// Nullable:", this.phpType(unionType));
                    this.phpSampleConvert(className, nullable, lhs, args, idx, suffix);
                    return;
                }
                this.emitLine("// Enum:", this.phpType(unionType));
                // this.emitLine(lhs, "array(");
                Array.from(unionType.sortedMembers).forEach((u, sidx, arr) => {
                    this.phpSampleConvert(className, u, lhs, args, idx + sidx, arr.length === sidx + 1 ? "" : ",");
                });
                // this.emitLine(")", suffix);
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    const x = _.pad("" + (1 + (idx % 31)), 2, "0");
                    this.emitLine(
                        ...lhs,
                        "DateTime::createFromFormat(DateTimeInterface::ISO8601, '",
                        `2020-12-${x}T12:${x}:${x}+00:00`,
                        "')",
                        suffix
                    );
                    // this.emitLine("return sample();");
                    return;
                }
                throw Error('transformedStringType.kind === "unknown"');
            }
        );
    }

    private phpIsBlock<T extends Type>(
        className: Name,
        t: Type,
        attrName: Sourcelike,
        scopeAttrName: Sourcelike,
        isBlockFn: IsBlockFN<T>,
        afterBlockFn: IsBlockFN<T> | undefined,
        classBlock: (ct: ClassType, scoped: Sourcelike) => IsAndBlock<T>,
        arrayBlock: (is: IsBlockFN<T>) => IsBlockFN<ArrayType>,
        mapBlock: (is: IsBlockFN<T>) => IsBlockFN<MapType>,
        unionIsNullAfterBlock: IsBlockFN<T>
    ) {
        const is = (isfn: Sourcelike, myT: Type, isBlockFn1: IsBlockFN<T>, afterBlockFn1?: IsBlockFN<T>) => {
            this.emitBlock(
                ["if (", isfn, ")"],
                () =>
                    isBlockFn1(
                        className,
                        myT as T,
                        attrName,
                        scopeAttrName,
                        isBlockFn1,
                        afterBlockFn1,
                        classBlock,
                        arrayBlock,
                        mapBlock,
                        unionIsNullAfterBlock
                    ),
                afterBlockFn1 ? " else {" : ""
            );
            if (afterBlockFn1) {
                this.indent(() =>
                    afterBlockFn1(
                        className,
                        myT as T,
                        attrName,
                        scopeAttrName,
                        isBlockFn1,
                        afterBlockFn1,
                        classBlock,
                        arrayBlock,
                        mapBlock,
                        unionIsNullAfterBlock
                    )
                );
                this.emitLine("}");
            }
        };
        return matchType<void>(
            t,
            _anyType => is(["defined(", scopeAttrName, ")"], _anyType, isBlockFn, afterBlockFn),
            _nullType =>
                is(
                    ["is_null(", scopeAttrName, ") || (is_bool(", scopeAttrName, ") && !(", scopeAttrName, "))"],
                    _nullType,
                    isBlockFn,
                    afterBlockFn
                ),
            _boolType => is(["is_bool(", scopeAttrName, ")"], _boolType, isBlockFn, afterBlockFn),
            _integerType => is(["is_integer(", scopeAttrName, ")"], _integerType, isBlockFn, afterBlockFn),
            _doubleType =>
                is(
                    ["is_float(", scopeAttrName, ") || is_integer(", scopeAttrName, ")"],
                    _doubleType,
                    isBlockFn,
                    afterBlockFn
                ),
            _stringType => is(["is_string(", scopeAttrName, ")"], _stringType, isBlockFn, afterBlockFn),
            _arrayType =>
                is(
                    ["is_array(", scopeAttrName, ")"],
                    _arrayType,
                    (arrayBlock(isBlockFn) as unknown) as IsBlockFN<T>,
                    afterBlockFn
                ),
            classType => {
                const cb = classBlock(classType, scopeAttrName);
                is(cb.is, classType, cb.block, afterBlockFn);
            },
            mapType =>
                is(
                    ["is_a(", scopeAttrName, ", 'stdClass')"],
                    mapType,
                    (mapBlock(isBlockFn) as unknown) as IsBlockFN<T>,
                    afterBlockFn
                ),
            enumType =>
                is([this.nameForNamedType(enumType), "::to(", scopeAttrName, ")"], enumType, isBlockFn, afterBlockFn),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    is(
                        ["!is_null(", scopeAttrName, ")"],
                        nullable,
                        () => {
                            this.phpIsBlock(
                                className,
                                nullable,
                                attrName,
                                scopeAttrName,
                                isBlockFn,
                                afterBlockFn,
                                classBlock,
                                arrayBlock,
                                mapBlock,
                                unionIsNullAfterBlock
                            );
                            return true;
                        },
                        unionIsNullAfterBlock
                    );
                    return;
                }
                Array.from(unionType.sortedMembers).map(m => {
                    this.phpIsBlock(
                        className,
                        m,
                        attrName,
                        scopeAttrName,
                        isBlockFn,
                        undefined,
                        classBlock,
                        arrayBlock,
                        mapBlock,
                        unionIsNullAfterBlock
                    );
                });
                if (afterBlockFn) {
                    afterBlockFn(
                        className,
                        (unionType as unknown) as T,
                        attrName,
                        scopeAttrName,
                        isBlockFn,
                        afterBlockFn,
                        classBlock,
                        arrayBlock,
                        mapBlock,
                        unionIsNullAfterBlock
                    );
                }
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    this.transformDateTime(className, attrName, [scopeAttrName], "WTF", false);
                    return;
                }
                throw Error(`transformedStringType.kind === ${transformedStringType.kind}`);
            }
        );
    }

    private phpValidate(className: Name, t: Type, attrName: Sourcelike, scopeAttrName: Sourcelike) {
        const isBlock = () => {
            this.emitLine("return true;");
            return true;
        };
        const afterBlock = () => {
            // this.emitLine("throw new Exception('not valid:", className, "::", attrName, "');")
            this.emitLine("return false;");
            return true;
        };
        let mapBlock = (_ib: IsBlockFN<Type>): IsBlockFN<MapType> => {
            throw Error("never reached");
        };
        const arrayBlock = (_isBFn: IsBlockFN<Type>) => (
            _name: Name,
            itemT: ArrayType,
            attr: Sourcelike,
            scoped: Sourcelike
        ): boolean => {
            this.emitLine("return array_filter(", scoped, ", function(", scoped, "_v) {");
            this.indent(() => {
                this.phpValidate(className, itemT.items, attr, [scoped, "_v"]);
            });
            this.emitLine("}) == count(", scoped, ");");
            return true;
        };
        mapBlock = (_isBFn: IsBlockFN<Type>) => (_name: Name, itemT: MapType, attr: Sourcelike, scoped: Sourcelike) => {
            this.emitLine("return (function($myi) {");
            this.indent(() => {
                this.emitLine("foreach ($myi as $k => $v) {");
                this.indent(() => this.phpValidate(className, itemT.values, attr, "$v"));
                this.emitLine("}");
                afterBlock();
            });
            this.emitLine("})(", scoped, ");");
            return true;
        };
        const classBlock = (itemT: ClassType, scoped: Sourcelike) => {
            return {
                is: ["is_a(", scoped, ", '", this.nameForNamedType(itemT), "') && ", scoped, "->validate()"],
                block: () => {
                    this.emitLine("return true;");
                    return true;
                }
            };
        };
        this.phpIsBlock(
            className,
            t,
            attrName,
            scopeAttrName,
            isBlock,
            afterBlock,
            classBlock,
            arrayBlock,
            mapBlock,
            () => {
                this.emitLine("return true;");
                return true;
            }
        );
    }

    private phpMatch(className: Name, t: Type, attrName: Sourcelike, scopeAttrName: Sourcelike) {
        const isBlock = () => {
            this.emitLine("return true;");
            return true;
        };
        const afterBlock = () => {
            // this.emitLine("throw new Exception('not valid:", className, "::", attrName, "');")
            this.emitLine("return false;");
            return true;
        };
        let mapBlock = (_ib: IsBlockFN<Type>): IsBlockFN<MapType> => {
            throw Error("never reached");
        };
        const arrayBlock = (_isBFn: IsBlockFN<Type>) => (
            _name: Name,
            itemT: ArrayType,
            attr: Sourcelike,
            scoped: Sourcelike
        ): boolean => {
            this.emitLine("return array_filter(", scoped, ", function(", scoped, "_v) {");
            this.indent(() => {
                this.phpMatch(className, itemT.items, attr, [scoped, "_v"]);
            });
            this.emitLine("}) == count(", scoped, ");");
            return true;
        };
        mapBlock = (_isBFn: IsBlockFN<Type>) => (_name: Name, itemT: MapType, attr: Sourcelike, scoped: Sourcelike) => {
            this.emitLine("return (function($myi) {");
            this.indent(() => {
                this.emitLine("foreach ($myi as $k => $v) {");
                this.indent(() => this.phpMatch(className, itemT.values, attr, "$v"));
                this.emitLine("}");
                afterBlock();
            });
            this.emitLine("})(", scoped, ");");
            return true;
        };
        const classBlock = (itemT: ClassType, scoped: Sourcelike) => {
            return {
                is: ["is_a(", scoped, ", 'stdClass') && ", this.nameForNamedType(itemT), "::match(", scoped, ")"],
                block: () => {
                    this.emitLine("return true;");
                    return true;
                }
            };
        };
        this.phpIsBlock(
            className,
            t,
            attrName,
            scopeAttrName,
            isBlock,
            afterBlock,
            classBlock,
            arrayBlock,
            mapBlock,
            () => {
                this.emitLine("return true;");
                return true;
            }
        );
    }

    // private phpFromValidate(className: Name, t: Type, attrName: Sourcelike, scopeAttrName: Sourcelike) {
    //     const isBlock = () => {
    //         this.emitLine("return true;");
    //         return true;
    //     };
    //     const afterBlock = () => {
    //         // this.emitLine("throw new Exception('not valid:", className, "::", attrName, "');")
    //         this.emitLine("return false;");
    //         return true;
    //     };
    //     let mapBlock = (_ib: IsBlockFN<Type>): IsBlockFN<MapType> => {
    //         throw Error("never reached");
    //     };
    //     const arrayBlock = (_isBFn: IsBlockFN<Type>) => (
    //         _name: Name,
    //         itemT: ArrayType,
    //         attr: Sourcelike,
    //         scoped: Sourcelike
    //     ): boolean => {
    //         this.emitLine("return array_filter(", scoped, ", function(", scoped, "_v) {");
    //         this.indent(() => {
    //             this.phpFromValidate(className, itemT.items, attr, [scoped, "_v"]);
    //         });
    //         this.emitLine("}) == count(", scoped, ");");
    //         return true;
    //     };
    //     mapBlock = (_isBFn: IsBlockFN<Type>) => (_name: Name, itemT: MapType, attr: Sourcelike, scoped: Sourcelike) => {
    //         this.emitLine("return (function($myi) {");
    //         this.indent(() => {
    //             this.emitLine("foreach ($myi as $k => $v) {");
    //             this.indent(() => this.phpFromValidate(className, itemT.values, attr, "$v"));
    //             this.emitLine("}");
    //             afterBlock();
    //         });
    //         this.emitLine("})(", scoped, ");");
    //         return true;
    //     };
    //     this.phpIsBlock(className, t, attrName, scopeAttrName, isBlock, afterBlock, arrayBlock, mapBlock);
    // }

    protected emitFromMethod(names: FunctionNames, p: ClassProperty, className: Name, _name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        // this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
        this.emitLine(" * @param ", this.phpDocConvertType(className, p.type), " $value");
        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpDocType(p.type));
        this.emitLine(" */");
        this.emitBlock(
            [
                "public static function ",
                names.from,
                "(",
                this.phpConvertType(className, p.type),
                " $value): ",
                this.phpType(p.type)
            ],
            () => {
                this.phpFromObjConvert(className, p.type, names.from, `$value`);
                // this.emitLine("return $ret;");
            }
        );
    }

    protected emitToMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpDocConvertType(className, p.type));
        this.emitLine(" */");
        this.emitBlock(["public function ", names.to, "(): ", this.phpConvertType(className, p.type)], () => {
            this.phpToObjConvert(className, p.type, "return ", ["$this->", name]);
        });
    }

    protected emitMatchMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        let nullable: Type = p.type;
        if (nullable instanceof UnionType) {
            const my = nullableFromUnion(nullable);
            if (my !== null) {
                this.emitLine(" * xxxx", this.phpType(nullable), this.phpType(my));
                nullable = my;
            }
        }
        this.emitLine(" * @param ", this.phpDocConvertType(className, nullable, "bool"), "|null $value");
        this.emitLine(" * @return bool");
        this.emitLine(" */");
        this.emitBlock(
            [
                "public static function ",
                names.match,
                "(?",
                this.phpConvertType(className, nullable, "bool"),
                " $value): bool"
            ],
            () => {
                this.phpMatch(className, p.type, name, `$value`);
            }
        );
    }

    protected emitValidateMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        this.emitLine(" * @param ", this.phpDocType(p.type), " $value");
        this.emitLine(" * @return bool");
        this.emitLine(" * @throws Exception");
        this.emitLine(" */");
        this.emitBlock(["public static function ", names.validate, "(", this.phpType(p.type), " $value): bool"], () => {
            this.phpValidate(className, p.type, name, `$value`);
        });
    }
    protected emitGetMethod(names: FunctionNames, p: ClassProperty, className: Name, name: Name, desc?: string[]) {
        if (this._options.withGet) {
            this.emitLine("/**");
            if (desc !== undefined) {
                this.emitLine(" * ", desc);
                this.emitLine(" *");
            }
            if (!this._options.fast) {
                this.emitLine(` * @throws Exception`);
            }
            this.emitLine(" * @return ", this.phpDocType(p.type));
            this.emitLine(" */");
            this.emitBlock(["public function ", names.getter, "(): ", this.phpType(p.type)], () => {
                if (!this._options.fast) {
                    this.emitBlock(["if (", className, "::", names.validate, "($this->", name, ")) "], () => {
                        this.emitLine("return $this->", name, ";");
                    });
                    this.emitLine(
                        "throw new Exception('never get to ",
                        names.getter,
                        " ",
                        className,
                        "::",
                        name,
                        "');"
                    );
                } else {
                    this.emitLine("return $this->", name, ";");
                }
            });
        }
    }
    protected emitSetMethod(names: FunctionNames, p: ClassProperty, _className: Name, name: Name, desc?: string[]) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        this.emitLine(" * @param ", this.phpDocType(p.type), " $value");
        this.emitLine(` * @throws Exception`);
        this.emitLine(" */");
        this.emitBlock(
            [
                this._options.withSet ? "public" : "private",
                " function ",
                names.setter,
                "(",
                this.phpType(p.type),
                " $value)"
            ],
            () => {
                this.emitLine("$this->", name, " = $value;");
                this.emitLine("return;");
            }
        );
    }
    protected emitSampleMethod(
        names: FunctionNames,
        p: ClassProperty,
        className: Name,
        name: Name,
        desc: string[] | undefined,
        idx: number
    ) {
        if (this._options.withSample) {
            this.emitLine("/**");
            if (desc !== undefined) {
                this.emitLine(" * ", desc);
                this.emitLine(" *");
            }
            this.emitLine(" * @return ", this.phpDocConvertType(className, p.type));
            this.emitLine(" * @throws Exception");
            this.emitLine(" */");
            this.emitBlock(
                ["public static function ", names.sample, "(): ", this.phpConvertType(className, p.type)],
                () => {
                    this.phpSampleConvert(className, p.type, ["return "], [name], idx, ";");
                }
            );
        }
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitFileHeader(className, []);

        this.emitBlock(["class ", className], () => {
            this.forEachClassProperty(c, "none", (name, _jsonName, p) => {
                this.emitDescriptionBlock([_.flatten(["@var ", this.phpDocType(p.type)])]);
                this.emitLine("private ", this.phpType(p.type), " $", name, ";");
            });

            this.ensureBlankLine();
            const comments: Sourcelike[][] = [];
            const args: Sourcelike[][] = [];
            let prefix = "";
            this.forEachClassProperty(c, "none", (name, __, p, pos) => {
                args.push([prefix, this.phpType(p.type), " $", name, pos === "last" ? "" : "\n"]);
                prefix = ",";
                comments.push([" * @param ", this.phpDocType(p.type), " $", name, "\n"]);
            });
            comments.push([" * @throws Exception"]);
            this.emitBlock(["/**\n", ...comments, " */\n", "public function __construct(", ...args, ")"], () => {
                this.forEachClassProperty(c, "none", name => {
                    const names = defined(this._gettersAndSettersForPropertyName.get(name));
                    this.emitLine("$this->", names.setter, "($", name, ");");
                });
            });

            this.emitBlock(
                [
                    "/**\n",
                    " * @return ",
                    className,
                    "\n",
                    " * @throws Exception\n",
                    " */\n",
                    "public function clone(): ",
                    className
                ],
                () => {
                    this.emitLine("return new ", className, "(");
                    this.indent(() => {
                        let prefix1: string = " ";
                        this.forEachClassProperty(c, "none", name => {
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine(prefix1, "$this->", names.getter, "()");
                            prefix1 = ", ";
                        });
                    });
                    this.emitLine(");");
                }
            );

            let idx = 31;
            this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, p) => {
                const desc = this.descriptionForClassProperty(c, jsonName);
                const names = defined(this._gettersAndSettersForPropertyName.get(name));

                this.ensureBlankLine();
                this.emitMatchMethod(names, p, className, name, desc);
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
                this.ensureBlankLine();
                this.emitSampleMethod(names, p, className, name, desc, idx++);
            });

            this.ensureBlankLine();
            this.emitBlock(
                ["/**\n", ` * @throws Exception\n`, ` * @return bool\n`, " */\n", "public function validate(): bool"],
                () => {
                    let lines: Sourcelike[][] = [];
                    let p = "return ";
                    this.forEachClassProperty(c, "none", (name, jsonName, _p) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        lines.push([p, className, "::", names.validate, "($this->{'", stringEscape(jsonName), "'})"]);
                        p = "|| ";
                    });
                    lines.forEach((line, jdx) => {
                        this.emitLine(...line, lines.length === jdx + 1 ? ";" : "");
                    });
                }
            );

            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    ` * @return stdClass\n`,
                    ` * @throws Exception\n`,
                    " */\n",
                    "public function to(): stdClass "
                ],
                () => {
                    this.emitLine("$out = new stdClass();");
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        this.emitLine("$out->{'", stringEscape(jsonName), "'} = $this->", names.to, "();");
                    });
                    this.emitLine("return $out;");
                }
            );

            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    ` * @param stdClass $obj\n`,
                    ` * @return bool\n`,
                    ` * @throws Exception\n`,
                    " */\n",
                    "public static function match(stdClass $obj): bool"
                ],
                () => {
                    let comma = "return ";
                    this.forEachClassProperty(c, "none", (name, jsonName, _x, pos) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        this.emitLine(
                            comma,
                            className,
                            "::",
                            names.match,
                            "(property_exists($obj, '",
                            stringEscape(jsonName),
                            "') ? $obj->{'",
                            stringEscape(jsonName),
                            "'} : null)",
                            pos === "only" || pos === "last" ? ";" : ""
                        );
                        comma = "|| ";
                    });
                }
            );

            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    ` * @param stdClass $obj\n`,
                    ` * @return `,
                    className,
                    `\n`,
                    ` * @throws Exception\n`,
                    " */\n",
                    "public static function from(stdClass $obj): ",
                    className
                ],
                () => {
                    this.emitLine("return new ", className, "(");
                    let comma = " ";
                    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                        const names = defined(this._gettersAndSettersForPropertyName.get(name));
                        let nullable: Type = p.type;
                        let optional: Sourcelike = ["$obj->{'", stringEscape(jsonName), "'}"];
                        if (nullable instanceof PrimitiveType && nullable.kind === "null") {
                            optional = [
                                "property_exists($obj, '",
                                stringEscape(jsonName),
                                "') ? $obj->{'",
                                stringEscape(jsonName),
                                "'} : null"
                            ];
                        } else if (nullable instanceof UnionType) {
                            const my = nullableFromUnion(nullable);
                            if (my !== null) {
                                optional = [
                                    "property_exists($obj, '",
                                    stringEscape(jsonName),
                                    "') ? $obj->{'",
                                    stringEscape(jsonName),
                                    "'} : null"
                                ];
                            }
                        }
                        this.emitLine(
                            comma,
                            className,
                            "::",
                            names.from,
                            "(",
                            optional,
                            ") /*",
                            this.phpType(p.type),
                            "*/"
                        );
                        comma = ",";
                    });
                    this.emitLine(");");
                }
            );
            this.ensureBlankLine();
            if (this._options.withSample) {
                this.emitBlock(
                    [
                        "/**\n",
                        " * @return ",
                        className,
                        "\n",
                        " * @throws Exception\n",
                        " */\n",
                        "public static function sample(): ",
                        className
                    ],
                    () => {
                        this.emitLine("return new ", className, "(");
                        let comma = " ";
                        this.forEachClassProperty(c, "none", name => {
                            const names = defined(this._gettersAndSettersForPropertyName.get(name));
                            this.emitLine(comma, className, "::", names.sample, "()");
                            comma = ",";
                        });
                        this.emitLine(");");
                    }
                );
            }
        });
        this.finishFile();
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
                    this.emitLine(enumName, "::$", name, " = new ", enumName, "('", jsonName, "');");
                });
            });

            this.emitLine("private ", enumSerdeType, " $enum;");
            this.emitBlock(["public function __construct(", enumSerdeType, " $enum)"], () => {
                this.emitLine("$this->enum = $enum;");
            });

            this.ensureBlankLine();
            this.emitEnumSerializationAttributes(e);

            this.emitBlock(
                [
                    "/**\n",
                    ` * @param `,
                    enumName,
                    `\n`,
                    ` * @return `,
                    enumSerdeType,
                    `\n`,
                    ` * @throws Exception\n`,
                    " */\n",
                    "public static function to(",
                    enumName,
                    " $obj): ",
                    enumSerdeType
                ],
                () => {
                    this.emitLine("switch ($obj->enum) {");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            // Todo String or Number
                            this.emitLine(
                                "case ",
                                enumName,
                                "::$",
                                name,
                                "->enum: return '",
                                stringEscape(jsonName),
                                "';"
                            );
                        });
                    });
                    this.emitLine("}");
                    this.emitLine("throw new Exception('the give value is not an enum-value.');");
                }
            );
            this.ensureBlankLine();
            this.emitEnumDeserializationAttributes(e);

            this.emitBlock(
                [
                    "/**\n",
                    ` * @param mixed\n`,
                    ` * @return `,
                    enumName,
                    "\n",
                    ` * @throws Exception\n`,
                    " */\n",
                    "public static function from($obj): ",
                    enumName
                ],
                () => {
                    this.emitLine("switch ($obj) {");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            // Todo String or Enum
                            this.emitLine("case '", stringEscape(jsonName), "': return ", enumName, "::$", name, ";");
                        });
                    });
                    this.emitLine("}");
                    this.emitLine('throw new Exception("Cannot deserialize ', enumName, '");');
                }
            );
            this.ensureBlankLine();
            this.emitBlock(
                ["/**\n", ` * @return `, enumName, "\n", " */\n", "public static function sample(): ", enumName],
                () => {
                    const lines: Sourcelike[] = [];
                    this.forEachEnumCase(e, "none", name => {
                        lines.push([enumName, "::$", name]);
                    });
                    this.emitLine("return ", lines[0], ";");
                }
            );
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
            () => {
                /* empty */
            }
        );
        if (this._options.withClosing) {
            this.emitLine("?>");
        }
        super.finishFile(defined(givenFilename));
    }
}
