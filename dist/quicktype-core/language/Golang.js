"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Naming_1 = require("../Naming");
const Strings_1 = require("../support/Strings");
const Support_1 = require("../support/Support");
const RendererOptions_1 = require("../RendererOptions");
const Source_1 = require("../Source");
const Annotation_1 = require("../Annotation");
const TargetLanguage_1 = require("../TargetLanguage");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
exports.goOptions = {
    justTypes: new RendererOptions_1.BooleanOption("just-types", "Plain types only", false),
    justTypesAndPackage: new RendererOptions_1.BooleanOption("just-types-and-package", "Plain types with package only", false),
    packageName: new RendererOptions_1.StringOption("package", "Generated package name", "NAME", "main"),
    multiFileOutput: new RendererOptions_1.BooleanOption("multi-file-output", "Renders each top-level object in its own Go file", false),
};
class GoTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Go", ["go", "golang"], "go");
    }
    getOptions() {
        return [exports.goOptions.justTypes, exports.goOptions.packageName, exports.goOptions.multiFileOutput, exports.goOptions.justTypesAndPackage];
    }
    get supportsUnionsWithBothNumberTypes() {
        return true;
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new GoRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.goOptions, untypedOptionValues));
    }
    get defaultIndentation() {
        return "\t";
    }
}
exports.GoTargetLanguage = GoTargetLanguage;
const namingFunction = Naming_1.funPrefixNamer("namer", goNameStyle);
const legalizeName = Strings_1.legalizeCharacters(Strings_1.isLetterOrUnderscoreOrDigit);
function goNameStyle(original) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, Strings_1.firstUpperWordStyle, Strings_1.firstUpperWordStyle, Strings_1.allUpperWordStyle, Strings_1.allUpperWordStyle, "", Strings_1.isLetterOrUnderscore);
}
const primitiveValueTypeKinds = ["integer", "double", "bool", "string"];
const compoundTypeKinds = ["array", "class", "map", "enum"];
function isValueType(t) {
    const kind = t.kind;
    return primitiveValueTypeKinds.indexOf(kind) >= 0 || kind === "class" || kind === "enum";
}
function singleDescriptionComment(description) {
    if (description === undefined)
        return "";
    return "// " + description.join("; ");
}
function canOmitEmpty(cp) {
    if (!cp.isOptional)
        return false;
    const t = cp.type;
    return ["union", "null", "any"].indexOf(t.kind) < 0;
}
class GoRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
        this._topLevelUnmarshalNames = new Map();
    }
    makeNamedTypeNamer() {
        return namingFunction;
    }
    namerForObjectProperty() {
        return namingFunction;
    }
    makeUnionMemberNamer() {
        return namingFunction;
    }
    makeEnumCaseNamer() {
        return namingFunction;
    }
    get enumCasesInGlobalNamespace() {
        return true;
    }
    makeTopLevelDependencyNames(_, topLevelName) {
        const unmarshalName = new Naming_1.DependencyName(namingFunction, topLevelName.order, (lookup) => `unmarshal_${lookup(topLevelName)}`);
        this._topLevelUnmarshalNames.set(topLevelName, unmarshalName);
        return [unmarshalName];
    }
    /// startFile takes a file name, lowercases it, appends ".go" to it, and sets it as the current filename.
    startFile(basename) {
        if (this._options.multiFileOutput === false) {
            return;
        }
        Support_1.assert(this._currentFilename === undefined, "Previous file wasn't finished: " + this._currentFilename);
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.go`.toLowerCase();
        this.initializeEmitContextForFilename(this._currentFilename);
    }
    /// endFile pushes the current file name onto the collection of finished files and then resets the current file name. These finished files are used in index.ts to write the output.
    endFile() {
        if (this._options.multiFileOutput === false) {
            return;
        }
        this.finishFile(Support_1.defined(this._currentFilename));
        this._currentFilename = undefined;
    }
    emitBlock(line, f) {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }
    emitFunc(decl, f) {
        this.emitBlock(["func ", decl], f);
    }
    emitStruct(name, table) {
        this.emitBlock(["type ", name, " struct"], () => this.emitTable(table));
    }
    nullableGoType(t, withIssues) {
        const goType = this.goType(t, withIssues);
        if (isValueType(t)) {
            return ["*", goType];
        }
        else {
            return goType;
        }
    }
    propertyGoType(cp) {
        const t = cp.type;
        if (t instanceof Type_1.UnionType && TypeUtils_1.nullableFromUnion(t) === null) {
            return ["*", this.goType(t, true)];
        }
        if (cp.isOptional) {
            return this.nullableGoType(t, true);
        }
        return this.goType(t, true);
    }
    goType(t, withIssues = false) {
        return TypeUtils_1.matchType(t, (_anyType) => Source_1.maybeAnnotated(withIssues, Annotation_1.anyTypeIssueAnnotation, "interface{}"), (_nullType) => Source_1.maybeAnnotated(withIssues, Annotation_1.nullTypeIssueAnnotation, "interface{}"), (_boolType) => "bool", (_integerType) => "int64", (_doubleType) => "float64", (_stringType) => "string", (arrayType) => ["[]", this.goType(arrayType.items, withIssues)], (classType) => this.nameForNamedType(classType), (mapType) => {
            let valueSource;
            const v = mapType.values;
            if (v instanceof Type_1.UnionType && TypeUtils_1.nullableFromUnion(v) === null) {
                valueSource = ["*", this.nameForNamedType(v)];
            }
            else {
                valueSource = this.goType(v, withIssues);
            }
            return ["map[string]", valueSource];
        }, (enumType) => this.nameForNamedType(enumType), (unionType) => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null)
                return this.nullableGoType(nullable, withIssues);
            return this.nameForNamedType(unionType);
        });
    }
    emitTopLevel(t, name) {
        this.startFile(name);
        if (this._options.multiFileOutput &&
            this._options.justTypes === false &&
            this._options.justTypesAndPackage === false &&
            this.leadingComments === undefined) {
            this.emitLineOnce("// This file was generated from JSON Schema using quicktype, do not modify it directly.");
            this.emitLineOnce("// To parse and unparse this JSON data, add this code to your project and do:");
            this.emitLineOnce("//");
            const ref = Source_1.modifySource(Strings_1.camelCase, name);
            this.emitLineOnce("//    ", ref, ", err := ", Support_1.defined(this._topLevelUnmarshalNames.get(name)), "(bytes)");
            this.emitLineOnce("//    bytes, err = ", ref, ".Marshal()");
        }
        this.emitPackageDefinitons(true);
        const unmarshalName = Support_1.defined(this._topLevelUnmarshalNames.get(name));
        if (this.namedTypeToNameForTopLevel(t) === undefined) {
            this.emitLine("type ", name, " ", this.goType(t));
        }
        if (this._options.justTypes || this._options.justTypesAndPackage)
            return;
        this.ensureBlankLine();
        this.emitFunc([unmarshalName, "(data []byte) (", name, ", error)"], () => {
            this.emitLine("var r ", name);
            this.emitLine("err := json.Unmarshal(data, &r)");
            this.emitLine("return r, err");
        });
        this.ensureBlankLine();
        this.emitFunc(["(r *", name, ") Marshal() ([]byte, error)"], () => {
            this.emitLine("return json.Marshal(r)");
        });
        this.endFile();
    }
    emitClass(c, className) {
        this.startFile(className);
        this.emitPackageDefinitons(false);
        let columns = [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const goType = this.propertyGoType(p);
            const comment = singleDescriptionComment(this.descriptionForClassProperty(c, jsonName));
            const omitEmpty = canOmitEmpty(p) ? ",omitempty" : [];
            columns.push([[name, " "], [goType, " "], ['`json:"', Strings_1.stringEscape(jsonName), omitEmpty, '"`'], comment]);
        });
        this.emitDescription(this.descriptionForType(c));
        this.emitStruct(className, columns);
        this.endFile();
    }
    emitEnum(e, enumName) {
        this.startFile(enumName);
        this.emitPackageDefinitons(false);
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("type ", enumName, " string");
        this.emitLine("const (");
        this.indent(() => this.forEachEnumCase(e, "none", (name, jsonName) => {
            this.emitLine(name, " ", enumName, ' = "', Strings_1.stringEscape(jsonName), '"');
        }));
        this.emitLine(")");
        this.endFile();
    }
    emitUnion(u, unionName) {
        this.startFile(unionName);
        this.emitPackageDefinitons(false);
        const [hasNull, nonNulls] = TypeUtils_1.removeNullFromUnion(u);
        const isNullableArg = hasNull !== null ? "true" : "false";
        const ifMember = (kind, ifNotMember, f) => {
            const maybeType = u.findMember(kind);
            if (maybeType === undefined)
                return ifNotMember;
            return f(maybeType, this.nameForUnionMember(u, maybeType), this.goType(maybeType));
        };
        const maybeAssignNil = (kind) => {
            ifMember(kind, undefined, (_1, fieldName, _2) => {
                this.emitLine("x.", fieldName, " = nil");
            });
        };
        const makeArgs = (primitiveArg, compoundArg) => {
            const args = [];
            for (const kind of primitiveValueTypeKinds) {
                args.push(ifMember(kind, "nil", (_1, fieldName, _2) => primitiveArg(fieldName)), ", ");
            }
            for (const kind of compoundTypeKinds) {
                args.push(ifMember(kind, "false, nil", (t, fieldName, _) => compoundArg(t.kind === "class", fieldName)), ", ");
            }
            args.push(isNullableArg);
            return args;
        };
        let columns = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
            const goType = this.nullableGoType(t, true);
            columns.push([[fieldName, " "], goType]);
        });
        this.emitDescription(this.descriptionForType(u));
        this.emitStruct(unionName, columns);
        if (this._options.justTypes || this._options.justTypesAndPackage)
            return;
        this.ensureBlankLine();
        this.emitFunc(["(x *", unionName, ") UnmarshalJSON(data []byte) error"], () => {
            for (const kind of compoundTypeKinds) {
                maybeAssignNil(kind);
            }
            ifMember("class", undefined, (_1, _2, goType) => {
                this.emitLine("var c ", goType);
            });
            const args = makeArgs((fn) => ["&x.", fn], (isClass, fn) => {
                if (isClass) {
                    return "true, &c";
                }
                else {
                    return ["true, &x.", fn];
                }
            });
            this.emitLine("object, err := unmarshalUnion(data, ", args, ")");
            this.emitBlock("if err != nil", () => {
                this.emitLine("return err");
            });
            this.emitBlock("if object", () => {
                ifMember("class", undefined, (_1, fieldName, _2) => {
                    this.emitLine("x.", fieldName, " = &c");
                });
            });
            this.emitLine("return nil");
        });
        this.ensureBlankLine();
        this.emitFunc(["(x *", unionName, ") MarshalJSON() ([]byte, error)"], () => {
            const args = makeArgs((fn) => ["x.", fn], (_, fn) => ["x.", fn, " != nil, x.", fn]);
            this.emitLine("return marshalUnion(", args, ")");
        });
        this.endFile();
    }
    emitSingleFileHeaderComments() {
        this.emitLineOnce("// This file was generated from JSON Schema using quicktype, do not modify it directly.");
        this.emitLineOnce("// To parse and unparse this JSON data, add this code to your project and do:");
        this.forEachTopLevel("none", (_, name) => {
            this.emitLine("//");
            const ref = Source_1.modifySource(Strings_1.camelCase, name);
            this.emitLine("//    ", ref, ", err := ", Support_1.defined(this._topLevelUnmarshalNames.get(name)), "(bytes)");
            this.emitLine("//    bytes, err = ", ref, ".Marshal()");
        });
    }
    emitPackageDefinitons(includeJSONEncodingImport) {
        if (!this._options.justTypes || this._options.justTypesAndPackage) {
            this.ensureBlankLine();
            const packageDeclaration = "package " + this._options.packageName;
            this.emitLineOnce(packageDeclaration);
            this.ensureBlankLine();
        }
        if (!this._options.justTypes && !this._options.justTypesAndPackage) {
            this.ensureBlankLine();
            if (this.haveNamedUnions && this._options.multiFileOutput === false) {
                this.emitLineOnce('import "bytes"');
                this.emitLineOnce('import "errors"');
            }
            if (includeJSONEncodingImport) {
                this.emitLineOnce('import "encoding/json"');
            }
            this.ensureBlankLine();
        }
    }
    emitHelperFunctions() {
        if (this.haveNamedUnions) {
            this.startFile("JSONSchemaSupport");
            this.emitPackageDefinitons(true);
            if (this._options.multiFileOutput) {
                this.emitLineOnce('import "bytes"');
                this.emitLineOnce('import "errors"');
            }
            this.ensureBlankLine();
            this
                .emitMultiline(`func unmarshalUnion(data []byte, pi **int64, pf **float64, pb **bool, ps **string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, haveEnum bool, pe interface{}, nullable bool) (bool, error) {
    if pi != nil {
        *pi = nil
    }
    if pf != nil {
        *pf = nil
    }
    if pb != nil {
        *pb = nil
    }
    if ps != nil {
        *ps = nil
    }

    dec := json.NewDecoder(bytes.NewReader(data))
    dec.UseNumber()
    tok, err := dec.Token()
    if err != nil {
        return false, err
    }

    switch v := tok.(type) {
    case json.Number:
        if pi != nil {
            i, err := v.Int64()
            if err == nil {
                *pi = &i
                return false, nil
            }
        }
        if pf != nil {
            f, err := v.Float64()
            if err == nil {
                *pf = &f
                return false, nil
            }
            return false, errors.New("Unparsable number")
        }
        return false, errors.New("Union does not contain number")
    case float64:
        return false, errors.New("Decoder should not return float64")
    case bool:
        if pb != nil {
            *pb = &v
            return false, nil
        }
        return false, errors.New("Union does not contain bool")
    case string:
        if haveEnum {
            return false, json.Unmarshal(data, pe)
        }
        if ps != nil {
            *ps = &v
            return false, nil
        }
        return false, errors.New("Union does not contain string")
    case nil:
        if nullable {
            return false, nil
        }
        return false, errors.New("Union does not contain null")
    case json.Delim:
        if v == '{' {
            if haveObject {
                return true, json.Unmarshal(data, pc)
            }
            if haveMap {
                return false, json.Unmarshal(data, pm)
            }
            return false, errors.New("Union does not contain object")
        }
        if v == '[' {
            if haveArray {
                return false, json.Unmarshal(data, pa)
            }
            return false, errors.New("Union does not contain array")
        }
        return false, errors.New("Cannot handle delimiter")
    }
    return false, errors.New("Cannot unmarshal union")

}

func marshalUnion(pi *int64, pf *float64, pb *bool, ps *string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, haveEnum bool, pe interface{}, nullable bool) ([]byte, error) {
    if pi != nil {
        return json.Marshal(*pi)
    }
    if pf != nil {
        return json.Marshal(*pf)
    }
    if pb != nil {
        return json.Marshal(*pb)
    }
    if ps != nil {
        return json.Marshal(*ps)
    }
    if haveArray {
        return json.Marshal(pa)
    }
    if haveObject {
        return json.Marshal(pc)
    }
    if haveMap {
        return json.Marshal(pm)
    }
    if haveEnum {
        return json.Marshal(pe)
    }
    if nullable {
        return json.Marshal(nil)
    }
    return nil, errors.New("Union must not be null")
}`);
            this.endFile();
        }
    }
    emitSourceStructure() {
        if (this._options.multiFileOutput === false &&
            this._options.justTypes === false &&
            this._options.justTypesAndPackage === false &&
            this.leadingComments === undefined) {
            this.emitSingleFileHeaderComments();
        }
        this.forEachTopLevel("leading-and-interposing", (t, name) => this.emitTopLevel(t, name), (t) => !(this._options.justTypes || this._options.justTypesAndPackage) ||
            this.namedTypeToNameForTopLevel(t) === undefined);
        this.forEachObject("leading-and-interposing", (c, className) => this.emitClass(c, className));
        this.forEachEnum("leading-and-interposing", (u, enumName) => this.emitEnum(u, enumName));
        this.forEachUnion("leading-and-interposing", (u, unionName) => this.emitUnion(u, unionName));
        if (this._options.justTypes || this._options.justTypesAndPackage) {
            return;
        }
        this.emitHelperFunctions();
    }
}
exports.GoRenderer = GoRenderer;
