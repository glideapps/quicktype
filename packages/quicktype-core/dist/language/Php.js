"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhpRenderer = exports.phpNameStyle = exports.stringEscape = exports.PhpTargetLanguage = exports.phpOptions = void 0;
const Annotation_1 = require("../Annotation");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Naming_1 = require("../Naming");
const RendererOptions_1 = require("../RendererOptions");
const Source_1 = require("../Source");
const Acronyms_1 = require("../support/Acronyms");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const TargetLanguage_1 = require("../TargetLanguage");
const TypeUtils_1 = require("../TypeUtils");
const _ = __importStar(require("lodash"));
exports.phpOptions = {
    withGet: new RendererOptions_1.BooleanOption("with-get", "Create Getter", true),
    fastGet: new RendererOptions_1.BooleanOption("fast-get", "getter without validation", false),
    withSet: new RendererOptions_1.BooleanOption("with-set", "Create Setter", false),
    withClosing: new RendererOptions_1.BooleanOption("with-closing", "PHP Closing Tag", false),
    acronymStyle: (0, Acronyms_1.acronymOption)(Acronyms_1.AcronymStyleOptions.Pascal)
};
class PhpTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Php", ["php"], "php");
    }
    getOptions() {
        return _.values(exports.phpOptions);
    }
    get supportsUnionsWithBothNumberTypes() {
        return true;
    }
    makeRenderer(renderContext, untypedOptionValues) {
        const options = (0, RendererOptions_1.getOptionValues)(exports.phpOptions, untypedOptionValues);
        return new PhpRenderer(this, renderContext, options);
    }
    get stringTypeMapping() {
        const mapping = new Map();
        mapping.set("date", "date"); // TODO is not implemented yet
        mapping.set("time", "time"); // TODO is not implemented yet
        mapping.set("uuid", "uuid"); // TODO is not implemented yet
        mapping.set("date-time", "date-time");
        return mapping;
    }
}
exports.PhpTargetLanguage = PhpTargetLanguage;
exports.stringEscape = (0, Strings_1.utf16ConcatMap)((0, Strings_1.escapeNonPrintableMapper)(Strings_1.isAscii, Strings_1.standardUnicodeHexEscape));
function isStartCharacter(codePoint) {
    if (codePoint === 0x5f)
        return true; // underscore
    return (0, Strings_1.isAscii)(codePoint) && (0, Strings_1.isLetter)(codePoint);
}
function isPartCharacter(codePoint) {
    return isStartCharacter(codePoint) || ((0, Strings_1.isAscii)(codePoint) && (0, Strings_1.isDigit)(codePoint));
}
const legalizeName = (0, Strings_1.utf16LegalizeCharacters)(isPartCharacter);
function phpNameStyle(startWithUpper, upperUnderscore, original, acronymsStyle = Strings_1.allUpperWordStyle) {
    const words = (0, Strings_1.splitIntoWords)(original);
    return (0, Strings_1.combineWords)(words, legalizeName, upperUnderscore ? Strings_1.allUpperWordStyle : startWithUpper ? Strings_1.firstUpperWordStyle : Strings_1.allLowerWordStyle, upperUnderscore ? Strings_1.allUpperWordStyle : Strings_1.firstUpperWordStyle, upperUnderscore || startWithUpper ? Strings_1.allUpperWordStyle : Strings_1.allLowerWordStyle, acronymsStyle, upperUnderscore ? "_" : "", isStartCharacter);
}
exports.phpNameStyle = phpNameStyle;
class PhpRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
        this._gettersAndSettersForPropertyName = new Map();
        this._haveEmittedLeadingComments = false;
        this._converterClassname = "Converter";
        this._converterKeywords = [];
    }
    forbiddenForObjectProperties(_c, _className) {
        return { names: [], includeGlobalForbidden: true };
    }
    makeNamedTypeNamer() {
        return this.getNameStyling("typeNamingFunction");
    }
    namerForObjectProperty() {
        return this.getNameStyling("propertyNamingFunction");
    }
    makeUnionMemberNamer() {
        return this.getNameStyling("propertyNamingFunction");
    }
    makeEnumCaseNamer() {
        return this.getNameStyling("enumCaseNamingFunction");
    }
    unionNeedsName(u) {
        return (0, TypeUtils_1.nullableFromUnion)(u) === null;
    }
    namedTypeToNameForTopLevel(type) {
        return (0, TypeUtils_1.directlyReachableSingleNamedType)(type);
    }
    makeNamesForPropertyGetterAndSetter(_c, _className, _p, _jsonName, name) {
        const getterName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, lookup => `get_${lookup(name)}`);
        const setterName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, lookup => `set_${lookup(name)}`);
        const validateName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, lookup => `validate_${lookup(name)}`);
        const fromName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, lookup => `from_${lookup(name)}`);
        const toName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, lookup => `to_${lookup(name)}`);
        const sampleName = new Naming_1.DependencyName(this.getNameStyling("propertyNamingFunction"), name.order, lookup => `sample_${lookup(name)}`);
        return {
            getter: getterName,
            setter: setterName,
            validate: validateName,
            from: fromName,
            to: toName,
            sample: sampleName
        };
    }
    makePropertyDependencyNames(c, className, p, jsonName, name) {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(c, className, p, jsonName, name);
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return [
            getterAndSetterNames.getter,
            getterAndSetterNames.setter,
            getterAndSetterNames.validate,
            getterAndSetterNames.to,
            getterAndSetterNames.from,
            getterAndSetterNames.sample
        ];
    }
    getNameStyling(convention) {
        const styling = {
            typeNamingFunction: (0, Naming_1.funPrefixNamer)("types", n => phpNameStyle(true, false, n, (0, Acronyms_1.acronymStyle)(this._options.acronymStyle))),
            propertyNamingFunction: (0, Naming_1.funPrefixNamer)("properties", n => phpNameStyle(false, false, n, (0, Acronyms_1.acronymStyle)(this._options.acronymStyle))),
            enumCaseNamingFunction: (0, Naming_1.funPrefixNamer)("enum-cases", n => phpNameStyle(true, true, n, (0, Acronyms_1.acronymStyle)(this._options.acronymStyle)))
        };
        return styling[convention];
    }
    startFile(_basename) {
        this.ensureBlankLine();
        if (!this._haveEmittedLeadingComments && this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            this.ensureBlankLine();
            this._haveEmittedLeadingComments = true;
        }
    }
    finishFile() {
        // empty
    }
    emitFileHeader(fileName, _imports) {
        this.startFile(fileName);
        this.emitLine("// This is a autogenerated file:", fileName);
        this.ensureBlankLine();
    }
    emitDescriptionBlock(lines) {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }
    emitBlock(line, f) {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }
    phpType(_reference, t, isOptional = false, prefix = "?", suffix = "") {
        function optionalize(s) {
            return [isOptional ? prefix : "", s, isOptional ? suffix : ""];
        }
        return (0, TypeUtils_1.matchType)(t, _anyType => (0, Source_1.maybeAnnotated)(isOptional, Annotation_1.anyTypeIssueAnnotation, "Object"), _nullType => (0, Source_1.maybeAnnotated)(isOptional, Annotation_1.nullTypeIssueAnnotation, "Object"), _boolType => optionalize("bool"), _integerType => optionalize("int"), _doubleType => optionalize("float"), _stringType => optionalize("string"), _arrayType => optionalize("array"), classType => optionalize(this.nameForNamedType(classType)), _mapType => optionalize("stdClass"), enumType => optionalize(this.nameForNamedType(enumType)), unionType => {
            const nullable = (0, TypeUtils_1.nullableFromUnion)(unionType);
            if (nullable !== null)
                return this.phpType(true, nullable, true, prefix, suffix);
            return this.nameForNamedType(unionType);
        }, transformedStringType => {
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
        });
    }
    phpDocConvertType(className, t) {
        return (0, TypeUtils_1.matchType)(t, _anyType => "any", _nullType => "null", _boolType => "bool", _integerType => "int", _doubleType => "float", _stringType => "string", arrayType => [this.phpDocConvertType(className, arrayType.items), "[]"], _classType => _classType.getCombinedName(), _mapType => "stdClass", enumType => this.nameForNamedType(enumType), unionType => {
            const nullable = (0, TypeUtils_1.nullableFromUnion)(unionType);
            if (nullable !== null) {
                return [this.phpDocConvertType(className, nullable), "|null"];
            }
            throw Error("union are not supported");
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                return "DateTime";
            }
            throw Error('transformedStringType.kind === "unknown"');
        });
    }
    phpConvertType(className, t) {
        return (0, TypeUtils_1.matchType)(t, _anyType => "any", _nullType => "null", _boolType => "bool", _integerType => "int", _doubleType => "float", _stringType => "string", _arrayType => "array", _classType => "stdClass", _mapType => "stdClass", _enumType => "string", // TODO number this.nameForNamedType(enumType),
        // TODO number this.nameForNamedType(enumType),
        unionType => {
            const nullable = (0, TypeUtils_1.nullableFromUnion)(unionType);
            if (nullable !== null) {
                return ["?", this.phpConvertType(className, nullable)];
            }
            throw Error("union are not supported");
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                return "string";
            }
            throw Error('transformedStringType.kind === "unknown"');
        });
    }
    phpToObjConvert(className, t, lhs, args) {
        return (0, TypeUtils_1.matchType)(t, _anyType => this.emitLine(...lhs, ...args, "; /*any*/"), _nullType => this.emitLine(...lhs, ...args, "; /*null*/"), _boolType => this.emitLine(...lhs, ...args, "; /*bool*/"), _integerType => this.emitLine(...lhs, ...args, "; /*int*/"), _doubleType => this.emitLine(...lhs, ...args, "; /*float*/"), _stringType => this.emitLine(...lhs, ...args, "; /*string*/"), arrayType => {
            this.emitLine(...lhs, "array_map(function ($value) {");
            this.indent(() => {
                this.phpToObjConvert(className, arrayType.items, ["return "], ["$value"]);
                // this.emitLine("return $tmp;");
            });
            this.emitLine("}, ", ...args, ");");
        }, _classType => this.emitLine(...lhs, ...args, "->to(); ", "/*class*/"), mapType => {
            this.emitBlock(["function to($my): stdClass"], () => {
                this.emitLine("$out = new stdClass();");
                this.emitBlock(["foreach ($my as $k => $v)"], () => {
                    this.phpToObjConvert(className, mapType.values, ["$my->$k = "], ["$v"]);
                });
                this.emitLine("return $out;");
            });
            this.emitLine("return to(", ...args, ");");
        }, enumType => this.emitLine(...lhs, this.nameForNamedType(enumType), "::to(", ...args, "); ", "/*enum*/"), unionType => {
            const nullable = (0, TypeUtils_1.nullableFromUnion)(unionType);
            if (nullable !== null) {
                this.emitLine("if (!is_null(", ...args, ")) {");
                this.indent(() => this.phpToObjConvert(className, nullable, lhs, args));
                this.emitLine("} else {");
                this.indent(() => this.emitLine(...lhs, " null;"));
                this.emitLine("}");
                return;
            }
            throw Error("union are not supported");
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                this.emitLine(...lhs, ...args, "->format(DateTimeInterface::ISO8601);");
                return;
            }
            throw Error('transformedStringType.kind === "unknown"');
        });
    }
    transformDateTime(className, attrName, scopeAttrName) {
        this.emitBlock(["if (!is_a(", scopeAttrName, ", 'DateTime'))"], () => this.emitLine("throw new Exception('Attribute Error:", className, "::", attrName, "');"));
        // if (lhs !== undefined) {
        //     this.emitLine(lhs, "$tmp;");
        // }
    }
    phpFromObjConvert(className, t, lhs, args) {
        return (0, TypeUtils_1.matchType)(t, _anyType => this.emitLine(...lhs, ...args, "; /*any*/"), _nullType => this.emitLine(...lhs, ...args, "; /*null*/"), _boolType => this.emitLine(...lhs, ...args, "; /*bool*/"), _integerType => this.emitLine(...lhs, ...args, "; /*int*/"), _doubleType => this.emitLine(...lhs, ...args, "; /*float*/"), _stringType => this.emitLine(...lhs, ...args, "; /*string*/"), arrayType => {
            this.emitLine(...lhs, " array_map(function ($value) {");
            this.indent(() => {
                this.phpFromObjConvert(className, arrayType.items, ["return "], ["$value"]);
                // this.emitLine("return $tmp;");
            });
            this.emitLine("}, ", ...args, ");");
        }, classType => this.emitLine(...lhs, this.nameForNamedType(classType), "::from(", ...args, "); ", "/*class*/"), mapType => {
            this.emitBlock(["function from($my): stdClass"], () => {
                this.emitLine("$out = new stdClass();");
                this.emitBlock(["foreach ($my as $k => $v)"], () => {
                    this.phpFromObjConvert(className, mapType.values, ["$out->$k = "], ["$v"]);
                });
                this.emitLine("return $out;");
            });
            this.emitLine("return from(", ...args, ");");
        }, enumType => this.emitLine(...lhs, this.nameForNamedType(enumType), "::from(", ...args, "); ", "/*enum*/"), unionType => {
            const nullable = (0, TypeUtils_1.nullableFromUnion)(unionType);
            if (nullable !== null) {
                this.emitLine("if (!is_null(", ...args, ")) {");
                this.indent(() => this.phpFromObjConvert(className, nullable, lhs, args));
                this.emitLine("} else {");
                this.indent(() => this.emitLine("return null;"));
                this.emitLine("}");
                return;
            }
            throw Error("union are not supported");
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                this.emitLine("$tmp = ", "DateTime::createFromFormat(DateTimeInterface::ISO8601, ", args, ");");
                this.transformDateTime(className, "", ["$tmp"]);
                this.emitLine("return $tmp;");
                return;
            }
            throw Error('transformedStringType.kind === "unknown"');
        });
    }
    phpSampleConvert(className, t, lhs, args, idx, suffix) {
        return (0, TypeUtils_1.matchType)(t, _anyType => this.emitLine(...lhs, "'AnyType::", className, "::", args, "::" + idx, "'", suffix, "/*", "" + idx, ":", args, "*/"), _nullType => this.emitLine(...lhs, "null", suffix, " /*", "" + idx, ":", args, "*/"), _boolType => this.emitLine(...lhs, "true", suffix, " /*", "" + idx, ":", args, "*/"), _integerType => this.emitLine(...lhs, "" + idx, suffix, " /*", "" + idx, ":", args, "*/"), _doubleType => this.emitLine(...lhs, "" + (idx + idx / 1000), suffix, " /*", "" + idx, ":", args, "*/"), _stringType => this.emitLine(...lhs, "'", className, "::", args, "::" + idx, "'", suffix, " /*", "" + idx, ":", args, "*/"), arrayType => {
            this.emitLine(...lhs, " array(");
            this.indent(() => {
                this.phpSampleConvert(className, arrayType.items, [], [], idx, "");
            });
            this.emitLine("); /* ", "" + idx, ":", args, "*/");
        }, classType => this.emitLine(...lhs, this.nameForNamedType(classType), "::sample()", suffix, " /*", "" + idx, ":", args, "*/"), mapType => {
            this.emitBlock(["function sample(): stdClass"], () => {
                this.emitLine("$out = new stdClass();");
                this.phpSampleConvert(className, mapType.values, ["$out->{'", className, "'} = "], args, idx, ";");
                this.emitLine("return $out;");
            });
            this.emitLine("return sample();");
        }, enumType => this.emitLine(...lhs, this.nameForNamedType(enumType), "::sample()", suffix, " /*enum*/"), unionType => {
            const nullable = (0, TypeUtils_1.nullableFromUnion)(unionType);
            if (nullable !== null) {
                this.phpSampleConvert(className, nullable, lhs, args, idx, suffix);
                return;
            }
            throw Error("union are not supported:" + unionType);
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                const x = _.pad("" + (1 + (idx % 31)), 2, "0");
                this.emitLine(...lhs, "DateTime::createFromFormat(DateTimeInterface::ISO8601, '", `2020-12-${x}T12:${x}:${x}+00:00`, "')", suffix);
                // this.emitLine("return sample();");
                return;
            }
            throw Error('transformedStringType.kind === "unknown"');
        });
    }
    phpValidate(className, t, attrName, scopeAttrName) {
        const is = (isfn, myT = className) => {
            this.emitBlock(["if (!", isfn, "(", scopeAttrName, "))"], () => this.emitLine('throw new Exception("Attribute Error:', myT, "::", attrName, '");'));
        };
        return (0, TypeUtils_1.matchType)(t, _anyType => is("defined"), _nullType => is("is_null"), _boolType => is("is_bool"), _integerType => is("is_integer"), _doubleType => is("is_float"), _stringType => is("is_string"), arrayType => {
            is("is_array");
            this.emitLine("array_walk(", scopeAttrName, ", function(", scopeAttrName, "_v) {");
            this.indent(() => {
                this.phpValidate(className, arrayType.items, attrName, `${scopeAttrName}_v`);
            });
            this.emitLine("});");
        }, _classType => {
            this.emitLine(scopeAttrName, "->validate();");
        }, mapType => {
            this.emitLine("foreach (", scopeAttrName, " as $k => $v) {");
            this.indent(() => {
                this.phpValidate(className, mapType.values, attrName, "$v");
            });
            this.emitLine("}");
        }, enumType => {
            this.emitLine(this.phpType(false, enumType), "::to(", scopeAttrName, ");");
        }, unionType => {
            const nullable = (0, TypeUtils_1.nullableFromUnion)(unionType);
            if (nullable !== null) {
                this.emitBlock(["if (!is_null(", scopeAttrName, "))"], () => {
                    this.phpValidate(className, nullable, attrName, scopeAttrName);
                });
                return;
            }
            throw Error("not implemented");
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                this.transformDateTime(className, attrName, [scopeAttrName]);
                return;
            }
            throw Error(`transformedStringType.kind === ${transformedStringType.kind}`);
        });
    }
    emitFromMethod(names, p, className, _name, desc) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        // this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
        this.emitLine(" * @param ", this.phpConvertType(className, p.type), " $value");
        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpType(false, p.type));
        this.emitLine(" */");
        this.emitBlock([
            "public static function ",
            names.from,
            "(",
            this.phpConvertType(className, p.type),
            " $value): ",
            this.phpType(false, p.type)
        ], () => {
            this.phpFromObjConvert(className, p.type, ["return "], [`$value`]);
            // this.emitLine("return $ret;");
        });
    }
    emitToMethod(names, p, className, name, desc) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpConvertType(className, p.type));
        this.emitLine(" */");
        this.emitBlock(["public function ", names.to, "(): ", this.phpConvertType(className, p.type)], () => {
            this.emitBlock(["if (", className, "::", names.validate, "($this->", name, ")) "], () => {
                this.phpToObjConvert(className, p.type, ["return "], ["$this->", name]);
            });
            this.emitLine("throw new Exception('never get to this ", className, "::", name, "');");
        });
    }
    emitValidateMethod(names, p, className, name, desc) {
        this.emitLine("/**");
        if (desc !== undefined) {
            this.emitLine(" * ", desc);
            this.emitLine(" *");
        }
        this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
        this.emitLine(" * @return bool");
        this.emitLine(" * @throws Exception");
        this.emitLine(" */");
        this.emitBlock(["public static function ", names.validate, "(", this.phpType(false, p.type), " $value): bool"], () => {
            this.phpValidate(className, p.type, name, `$value`);
            this.emitLine("return true;");
        });
    }
    emitGetMethod(names, p, className, name, desc) {
        if (this._options.withGet) {
            this.emitLine("/**");
            if (desc !== undefined) {
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
                    this.emitBlock(["if (", className, "::", names.validate, "($this->", name, ")) "], () => {
                        this.emitLine("return $this->", name, ";");
                    });
                    this.emitLine("throw new Exception('never get to ", names.getter, " ", className, "::", name, "');");
                }
                else {
                    this.emitLine("return $this->", name, ";");
                }
            });
        }
    }
    emitSetMethod(names, p, className, name, desc) {
        if (this._options.withSet) {
            this.emitLine("/**");
            if (desc !== undefined) {
                this.emitLine(" * ", desc);
                this.emitLine(" *");
            }
            this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
            this.emitLine(` * @throws Exception`);
            this.emitLine(" */");
            this.emitBlock(["public function ", names.setter, "(", this.phpType(false, p.type), " $value)"], () => {
                this.emitBlock(["if (", className, "::", names.validate, "($value)) "], () => {
                    this.emitLine("$this->", name, " = $value;");
                });
            });
        }
    }
    emitSampleMethod(names, p, className, name, desc, idx) {
        if (this._options.withGet) {
            this.emitLine("/**");
            if (desc !== undefined) {
                this.emitLine(" * ", desc);
                this.emitLine(" *");
            }
            const rendered = this.phpType(false, p.type);
            this.emitLine(" * @return ", rendered);
            this.emitLine(" */");
            this.emitBlock(["public static function ", names.sample, "(): ", rendered], () => {
                this.phpSampleConvert(className, p.type, ["return "], [name], idx, ";");
            });
        }
    }
    emitClassDefinition(c, className) {
        this.emitFileHeader(className, []);
        this.emitBlock(["class ", className], () => {
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                this.emitLine("private ", this.phpType(false, p.type), " $", name, "; // json:", jsonName, " ", p.type.isNullable ? "Optional" : "Required");
            });
            this.ensureBlankLine();
            const comments = [];
            const args = [];
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
            let idx = 31;
            this.forEachClassProperty(c, "leading-and-interposing", (name, jsonName, p) => {
                const desc = this.descriptionForClassProperty(c, jsonName);
                const names = (0, Support_1.defined)(this._gettersAndSettersForPropertyName.get(name));
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
            this.emitBlock(["/**\n", ` * @throws Exception\n`, ` * @return bool\n`, " */\n", "public function validate(): bool"], () => {
                let lines = [];
                let p = "return ";
                this.forEachClassProperty(c, "none", (name, _jsonName, _p) => {
                    const names = (0, Support_1.defined)(this._gettersAndSettersForPropertyName.get(name));
                    lines.push([p, className, "::", names.validate, "($this->", name, ")"]);
                    p = "|| ";
                });
                lines.forEach((line, jdx) => {
                    this.emitLine(...line, lines.length === jdx + 1 ? ";" : "");
                });
            });
            this.ensureBlankLine();
            this.emitBlock([
                "/**\n",
                ` * @return stdClass\n`,
                ` * @throws Exception\n`,
                " */\n",
                "public function to(): stdClass "
            ], () => {
                this.emitLine("$out = new stdClass();");
                this.forEachClassProperty(c, "none", (name, jsonName) => {
                    const names = (0, Support_1.defined)(this._gettersAndSettersForPropertyName.get(name));
                    this.emitLine("$out->{'", jsonName, "'} = $this->", names.to, "();");
                });
                this.emitLine("return $out;");
            });
            this.ensureBlankLine();
            this.emitBlock([
                "/**\n",
                ` * @param stdClass $obj\n`,
                ` * @return `,
                className,
                `\n`,
                ` * @throws Exception\n`,
                " */\n",
                "public static function from(stdClass $obj): ",
                className
            ], () => {
                if (this._options.fastGet) {
                    this.forEachClassProperty(c, "none", name => {
                        const names = (0, Support_1.defined)(this._gettersAndSettersForPropertyName.get(name));
                        this.emitLine(className, "::", names.validate, "($this->", name, ", true);");
                    });
                }
                this.emitLine("return new ", className, "(");
                let comma = " ";
                this.forEachClassProperty(c, "none", (name, jsonName) => {
                    const names = (0, Support_1.defined)(this._gettersAndSettersForPropertyName.get(name));
                    this.emitLine(comma, className, "::", names.from, "($obj->{'", jsonName, "'})");
                    comma = ",";
                });
                this.emitLine(");");
            });
            this.ensureBlankLine();
            this.emitBlock(["/**\n", " * @return ", className, "\n", " */\n", "public static function sample(): ", className], () => {
                this.emitLine("return new ", className, "(");
                let comma = " ";
                this.forEachClassProperty(c, "none", name => {
                    const names = (0, Support_1.defined)(this._gettersAndSettersForPropertyName.get(name));
                    this.emitLine(comma, className, "::", names.sample, "()");
                    comma = ",";
                });
                this.emitLine(");");
            });
        });
        this.finishFile();
    }
    emitUnionAttributes(_u, _unionName) {
        // empty
    }
    emitUnionSerializer(_u, _unionName) {
        // empty
    }
    emitUnionDefinition(_u, _unionName) {
        throw Error("emitUnionDefinition not implemented");
    }
    emitEnumSerializationAttributes(_e) {
        // Empty
    }
    emitEnumDeserializationAttributes(_e) {
        // Empty
    }
    emitEnumDefinition(e, enumName) {
        this.emitFileHeader(enumName, []);
        this.emitDescription(this.descriptionForType(e));
        const caseNames = [];
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
            this.emitBlock([
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
            ], () => {
                this.emitLine("switch ($obj->enum) {");
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        // Todo String or Number
                        this.emitLine("case ", enumName, "::$", name, "->enum: return '", (0, exports.stringEscape)(jsonName), "';");
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
                ` * @return `,
                enumName,
                "\n",
                ` * @throws Exception\n`,
                " */\n",
                "public static function from($obj): ",
                enumName
            ], () => {
                this.emitLine("switch ($obj) {");
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        // Todo String or Enum
                        this.emitLine("case '", (0, exports.stringEscape)(jsonName), "': return ", enumName, "::$", name, ";");
                    });
                });
                this.emitLine("}");
                this.emitLine('throw new Exception("Cannot deserialize ', enumName, '");');
            });
            this.ensureBlankLine();
            this.emitBlock(["/**\n", ` * @return `, enumName, "\n", " */\n", "public static function sample(): ", enumName], () => {
                const lines = [];
                this.forEachEnumCase(e, "none", name => {
                    lines.push([enumName, "::$", name]);
                });
                this.emitLine("return ", lines[0], ";");
            });
        });
        this.emitLine(enumName, "::init();");
        this.finishFile();
    }
    emitSourceStructure(givenFilename) {
        this.emitLine("<?php");
        this.forEachNamedType("leading-and-interposing", (c, n) => this.emitClassDefinition(c, n), (e, n) => this.emitEnumDefinition(e, n), (u, n) => this.emitUnionDefinition(u, n));
        if (this._options.withClosing) {
            this.emitLine("?>");
        }
        super.finishFile((0, Support_1.defined)(givenFilename));
    }
}
exports.PhpRenderer = PhpRenderer;
