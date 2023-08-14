/**
 * CJSON.ts
 * This file is used to generate cJSON code with quicktype
 * The generated code depends of https://github.com/DaveGamble/cJSON, https://github.com/joelguittet/c-list and https://github.com/joelguittet/c-hashtable
 *
 * Similarly to C++ generator, it is possible to generate a single header file or multiple header files.
 * To generate multiple header files, use the following option: --source-style multi-source
 *
 * JSON data are represented using structures, and functions in the cJSON style are created to use them.
 * To parse json data from json string use the following: struct <type> * data = cJSON_Parse<type>(<string>);
 * To get json data from cJSON object use the following: struct <type> * data = cJSON_Get<type>Value(<cjson>);
 * To get cJSON object from json data use the following: cJSON * cjson = cJSON_Create<type>(<data>);
 * To print json string from json data use the following: char * string = cJSON_Print<type>(<data>);
 * To delete json data use the following: cJSON_Delete<type>(<data>);
 *
 * TODO list for futur enhancements:
 * - Management of Class, Union and TopLevel should be mutualized to reduce code size and to permit Union and TopLevel having recursive Array/Map
 * - Types check should be added to verify unwanted inputs (for example a Number passed while a String is expected, etc)
 * - Constraints should be implemented (verification of Enum values, min/max values for Numbers and min/max length for Strings, regex)
 * - Support of pure Any type for example providing a callback from the application to handle these cases dynamically
 * See test/languages.ts for the test cases which are not implmented/checked.
 */

/* Imports */
import { TargetLanguage } from "../TargetLanguage";
import { Type, TypeKind, ClassType, ArrayType, MapType, EnumType, UnionType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { NameStyle, Name, Namer, funPrefixNamer } from "../Naming";
import { Sourcelike } from "../Source";
import {
    allUpperWordStyle,
    legalizeCharacters,
    isAscii,
    isLetterOrUnderscoreOrDigit,
    NamingStyle,
    makeNameStyle
} from "../support/Strings";
import { defined, assertNever, panic, numberEnumValues } from "../support/Support";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { EnumOption, StringOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { assert } from "../support/Support";
import { RenderContext } from "../Renderer";
import { getAccessorName } from "../attributes/AccessorNames";
import { enumCaseValues } from "../attributes/EnumValues";

/* Naming styles */
const pascalValue: [string, NamingStyle] = ["pascal-case", "pascal"];
const underscoreValue: [string, NamingStyle] = ["underscore-case", "underscore"];
const camelValue: [string, NamingStyle] = ["camel-case", "camel"];
const upperUnderscoreValue: [string, NamingStyle] = ["upper-underscore-case", "upper-underscore"];
const pascalUpperAcronymsValue: [string, NamingStyle] = ["pascal-case-upper-acronyms", "pascal-upper-acronyms"];
const camelUpperAcronymsValue: [string, NamingStyle] = ["camel-case-upper-acronyms", "camel-upper-acronyms"];

/* cJSON generator options */
export const cJSONOptions = {
    typeSourceStyle: new EnumOption(
        "source-style",
        "Source code generation type, whether to generate single or multiple source files",
        [
            ["single-source", true],
            ["multi-source", false]
        ],
        "single-source",
        "secondary"
    ),
    typeIntegerSize: new EnumOption(
        "integer-size",
        "Integer code generation type (int64_t by default)",
        [
            ["int8_t", "int8_t"],
            ["int16_t", "int16_t"],
            ["int32_t", "int32_t"],
            ["int64_t", "int64_t"]
        ],
        "int64_t",
        "secondary"
    ),
    hashtableSize: new StringOption(
        "hashtable-size",
        "Hashtable size, used when maps are created (64 by default)",
        "SIZE",
        "64"
    ),
    addTypedefAlias: new EnumOption(
        "typedef-alias",
        "Add typedef alias to unions, structs, and enums (no typedef by default)",
        [
            ["no-typedef", false],
            ["add-typedef", true]
        ],
        "no-typedef",
        "secondary"
    ),
    printStyle: new EnumOption(
        "print-style",
        "Which cJSON print should be used (formatted by default)",
        [
            ["print-formatted", false],
            ["print-unformatted", true]
        ],
        "print-formatted",
        "secondary"
    ),
    typeNamingStyle: new EnumOption<NamingStyle>("type-style", "Naming style for types", [
        pascalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    memberNamingStyle: new EnumOption<NamingStyle>("member-style", "Naming style for members", [
        underscoreValue,
        pascalValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    enumeratorNamingStyle: new EnumOption<NamingStyle>("enumerator-style", "Naming style for enumerators", [
        upperUnderscoreValue,
        underscoreValue,
        pascalValue,
        camelValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ])
};

/* cJSON generator target language */
export class CJSONTargetLanguage extends TargetLanguage {
    /**
     * Constructor
     * @param displayName: display name
     * @params names: names
     * @param extension: extension of files
     */
    constructor(displayName = "C (cJSON)", names: string[] = ["cjson", "cJSON"], extension = "h") {
        super(displayName, names, extension);
    }

    /**
     * Return cJSON generator options
     * @return cJSON generator options array
     */
    protected getOptions(): Option<any>[] {
        return [
            cJSONOptions.typeSourceStyle,
            cJSONOptions.typeIntegerSize,
            cJSONOptions.addTypedefAlias,
            cJSONOptions.printStyle,
            cJSONOptions.hashtableSize,
            cJSONOptions.typeNamingStyle,
            cJSONOptions.memberNamingStyle,
            cJSONOptions.enumeratorNamingStyle
        ];
    }

    /**
     * Indicate if language support union with both number types
     * @return true
     */
    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    /**
     * Indicate if language support optional class properties
     * @return true
     */
    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    /**
     * Create renderer
     * @param renderContext: render context
     * @param untypedOptionValues
     * @return cJSON renderer
     */
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): CJSONRenderer {
        return new CJSONRenderer(this, renderContext, getOptionValues(cJSONOptions, untypedOptionValues));
    }
}

/* Function used to format names */
const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

/* Forbidden names for namespace */
const keywords = [
    /* C and C++ keywords */
    "alignas",
    "alignof",
    "and",
    "and_eq",
    "asm",
    "atomic_cancel",
    "atomic_commit",
    "atomic_noexcept",
    "auto",
    "bitand",
    "bitor",
    "bool",
    "break",
    "case",
    "catch",
    "char",
    "char16_t",
    "char32_t",
    "class",
    "compl",
    "concept",
    "const",
    "constexpr",
    "const_cast",
    "continue",
    "co_await",
    "co_return",
    "co_yield",
    "decltype",
    "default",
    "delete",
    "do",
    "double",
    "dynamic_cast",
    "else",
    "enum",
    "explicit",
    "export",
    "extern",
    "false",
    "float",
    "for",
    "friend",
    "goto",
    "if",
    "import",
    "inline",
    "int",
    "long",
    "module",
    "mutable",
    "namespace",
    "new",
    "noexcept",
    "not",
    "not_eq",
    "nullptr",
    "operator",
    "or",
    "or_eq",
    "private",
    "protected",
    "public",
    "register",
    "reinterpret_cast",
    "requires",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "static_assert",
    "static_cast",
    "struct",
    "switch",
    "synchronized",
    "template",
    "this",
    "thread_local",
    "throw",
    "true",
    "try",
    "typedef",
    "typeid",
    "typename",
    "typeof",
    "union",
    "unsigned",
    "using",
    "virtual",
    "void",
    "volatile",
    "wchar_t",
    "while",
    "xor",
    "xor_eq",
    "override",
    "final",
    "transaction_safe",
    "transaction_safe_dynamic",
    "NULL",
    /* cJSON keywords */
    "Array",
    "ArrayReference",
    "Bool",
    "DoubleArray",
    "False",
    "FloatArray",
    "IntArray",
    "Object",
    "Null",
    "Number",
    "Raw",
    "String",
    "StringArray",
    "StringReference",
    "True"
];

/* Used to build forbidden global names */
export enum GlobalNames {
    ClassMemberConstraints,
    ClassMemberConstraintException,
    ValueTooLowException,
    ValueTooHighException,
    ValueTooShortException,
    ValueTooLongException,
    InvalidPatternException,
    CheckConstraint
}

/* To be able to support circles in multiple files - e.g. class#A using class#B using class#A (obviously not directly) we can forward declare them */
export enum IncludeKind {
    ForwardDeclare,
    Include
}

/* Used to map includes */
export type IncludeRecord = {
    kind: IncludeKind | undefined /* How to include that */;
    typeKind: TypeKind | undefined /* What exactly to include */;
};

/* Used to map includes */
export type TypeRecord = {
    name: Name;
    type: Type;
    level: number;
    variant: boolean;
    forceInclude: boolean;
};

/* Map each and every unique type to a include kind, e.g. how to include the given type */
export type IncludeMap = Map<string, IncludeRecord>;

/* cJSON type */
export type TypeCJSON = {
    cType: Sourcelike /* C type */;
    optionalQualifier: string /* C optional qualifier, empty string if not defined */;
    cjsonType: string /* cJSON type */;
    isType: Sourcelike /* cJSON check type function */;
    getValue: Sourcelike /* cJSON get value function */;
    addToObject: Sourcelike /* cJSON add to object function */;
    createObject: Sourcelike /* cJSON create object function */;
    deleteType: Sourcelike /* cJSON delete function */;
    items: TypeCJSON | undefined /* Sub-items, used for arrays and map */;
    isNullable: boolean /* True if the field is nullable */;
};

/* cJSON renderer */
export class CJSONRenderer extends ConvenienceRenderer {
    private currentFilename: string | undefined; /* Current filename */
    private memberNameStyle: NameStyle; /* Member name style */
    private namedTypeNameStyle: NameStyle; /* Named type name style */
    private forbiddenGlobalNames: string[]; /* Forbidden global names */
    protected readonly typeIntegerSize: string; /* Integer code generation type */
    protected readonly hashtableSize: string; /* Hashtable default size */
    protected readonly typeNamingStyle: NamingStyle; /* Type naming style */
    protected readonly enumeratorNamingStyle: NamingStyle; /* Enum naming style */

    /**
     * Constructor
     * @param targetLanguage: target language
     * @param renderContext: render context
     * @param _options: renderer options
     */
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof cJSONOptions>
    ) {
        super(targetLanguage, renderContext);
        this.typeIntegerSize = _options.typeIntegerSize;
        this.hashtableSize = _options.hashtableSize;
        this.typeNamingStyle = _options.typeNamingStyle;
        this.namedTypeNameStyle = makeNameStyle(this.typeNamingStyle, legalizeName);
        this.enumeratorNamingStyle = _options.enumeratorNamingStyle;
        this.memberNameStyle = makeNameStyle(_options.memberNamingStyle, legalizeName);
        this.forbiddenGlobalNames = [];
        for (const type of numberEnumValues(GlobalNames)) {
            const genName = this.namedTypeNameStyle(GlobalNames[type]);
            this.forbiddenGlobalNames.push(genName);
        }
    }

    /**
     * Build forbidden names for namespace
     * @return Forbidden names for namespace
     */
    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [...keywords, ...this.forbiddenGlobalNames];
    }

    /**
     * Build forbidden names for enums
     * @return Forbidden names for enums
     */
    protected forbiddenForEnumCases(_enumType: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    /**
     * Build forbidden names for unions members
     * @return Forbidden names for unions members
     */
    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    /**
     * Build forbidden names for objects
     * @return Forbidden names for objects
     */
    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    /**
     * Build types member names
     * @return types member namer
     */
    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", this.namedTypeNameStyle);
    }

    /**
     * Build object properties member names
     * @return object properties member namer
     */
    protected namerForObjectProperty(): Namer {
        return funPrefixNamer("members", this.memberNameStyle);
    }

    /**
     * Build union member names
     * @return union member namer
     */
    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer("members", this.memberNameStyle);
    }

    /**
     * Build enum member names
     * @return enum member namer
     */
    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enumerators", makeNameStyle(this.enumeratorNamingStyle, legalizeName));
    }

    /**
     * Override of super proposeUnionMemberName function
     * @param unionType: union type
     * @param unionName: union name
     * @param fieldType: field type
     * @param lookup: Lookup function
     * @return Proposed union member name
     */
    protected proposeUnionMemberName(
        unionType: UnionType,
        unionName: Name,
        fieldType: Type,
        lookup: (n: Name) => string
    ): string {
        let fieldName = super.proposeUnionMemberName(unionType, unionName, fieldType, lookup);
        if ("bool" === fieldName) {
            fieldName = "boolean";
        } else if ("double" === fieldName) {
            fieldName = "number";
        }
        return fieldName;
    }

    /**
     * Function called to emit typedef alias for a a given type
     * @param fieldType: the variable type
     * @param fieldName: name of the variable
     */
    protected emitTypdefAlias(fieldType: Type, fieldName: Name) {
        if (this._options.addTypedefAlias) {
            this.emitLine("typedef ", this.quicktypeTypeToCJSON(fieldType, false).cType, " ", fieldName, ";");
            this.ensureBlankLine();
        }
    }

    /**
     * Function called to create header file(s)
     * @param proposedFilename: source filename provided from stdin
     */
    protected emitSourceStructure(proposedFilename: string): void {
        /* Depending of source style option, generate a unique header or multiple header files */
        if (this._options.typeSourceStyle) {
            this.emitSingleSourceStructure(proposedFilename);
        } else {
            this.emitMultiSourceStructure();
        }
    }

    /**
     * Function called to create a single header file with types and generators
     * @param proposedFilename: source filename provided from stdin
     */
    protected emitSingleSourceStructure(proposedFilename: string): void {
        /* Create file */
        this.startFile(proposedFilename);

        /* Create types */
        this.forEachDeclaration("leading-and-interposing", decl => {
            if (decl.kind === "forward") {
                this.emitLine("struct ", this.nameForNamedType(decl.type), ";");
            } else if (decl.kind === "define") {
                const type = decl.type;
                if (type instanceof ClassType) {
                    this.emitClassTypedef(type);
                } else if (type instanceof EnumType) {
                    this.emitEnumTypedef(type);
                } else if (type instanceof UnionType) {
                    this.emitUnionTypedef(type);
                } else {
                    panic("Cannot declare type");
                }
            } else {
                assertNever(decl.kind);
            }
        });

        /* Create top level type */
        this.forEachTopLevel(
            "leading",
            (type: Type, className: Name) => this.emitTopLevelTypedef(type, className),
            type => this.namedTypeToNameForTopLevel(type) === undefined
        );

        /* Create enum prototypes */
        this.forEachEnum("leading-and-interposing", (enumType: EnumType, _enumName: Name) =>
            this.emitEnumPrototypes(enumType)
        );

        /* Create union prototypes */
        this.forEachUnion("leading-and-interposing", (unionType: UnionType) => this.emitUnionPrototypes(unionType));

        /* Create class prototypes */
        this.forEachObject("leading-and-interposing", (classType: ClassType, _className: Name) =>
            this.emitClassPrototypes(classType)
        );

        /* Create top level prototypes */
        this.forEachTopLevel(
            "leading",
            (type: Type, className: Name) => this.emitTopLevelPrototypes(type, className),
            type => this.namedTypeToNameForTopLevel(type) === undefined
        );

        /* Create enum functions */
        this.forEachEnum("leading-and-interposing", (enumType: EnumType, _enumName: Name) =>
            this.emitEnumFunctions(enumType)
        );

        /* Create union functions */
        this.forEachUnion("leading-and-interposing", (unionType: UnionType) => this.emitUnionFunctions(unionType));

        /* Create class functions */
        this.forEachObject("leading-and-interposing", (classType: ClassType, _className: Name) =>
            this.emitClassFunctions(classType)
        );

        /* Create top level functions */
        this.forEachTopLevel(
            "leading",
            (type: Type, className: Name) => this.emitTopLevelFunctions(type, className),
            type => this.namedTypeToNameForTopLevel(type) === undefined
        );

        /* Close file */
        this.finishFile();
    }

    /**
     * Function called to create a multiple header files with types and generators
     */
    protected emitMultiSourceStructure(): void {
        /* Array of includes */
        let includes: string[];

        /* Create each file */
        this.forEachNamedType(
            "leading-and-interposing",
            (classType: ClassType, _name: Name) => {
                this.emitClass(classType, includes);
            },
            (enumType, _name) => {
                this.emitEnum(enumType, includes);
            },
            (unionType, _name) => {
                this.emitUnion(unionType, includes);
            }
        );

        /* Create top level file */
        this.forEachTopLevel(
            "leading",
            (type: Type, className: Name) => this.emitTopLevel(type, className, includes),
            type => this.namedTypeToNameForTopLevel(type) === undefined
        );
    }

    /**
     * Function called to create an enum header files with types and generators
     * @param enumType: enum type
     * @param includes: Array of includes
     */
    protected emitEnum(enumType: EnumType, includes: string[]): void {
        /* Create file */
        const enumName = this.nameForNamedType(enumType);
        const filename = this.sourcelikeToString(enumName).concat(".h");
        includes.push(filename);
        this.startFile(filename);

        /* Create includes */
        this.emitIncludes(enumType, this.sourcelikeToString(filename));

        /* Create types */
        this.emitEnumTypedef(enumType);

        /* Create prototypes */
        this.emitEnumPrototypes(enumType);

        /* Create functions */
        this.emitEnumFunctions(enumType);

        /* Close file */
        this.finishFile();
    }

    /**
     * Function called to create enum typedef
     * @param enumType: enum type
     */
    protected emitEnumTypedef(enumType: EnumType): void {
        /* FIXME: Now there is a language with need of global enum name, see FIXME in makeNameForEnumCase of ConvenienceRenderer.ts, should simplify here when fixed */

        const enumName = this.nameForNamedType(enumType);
        const enumValues = enumCaseValues(enumType, this.targetLanguage.name);

        this.emitDescription(this.descriptionForType(enumType));
        this.emitBlock(
            ["enum ", enumName],
            () => {
                const combinedName = allUpperWordStyle(this.sourcelikeToString(enumName));
                this.forEachEnumCase(enumType, "none", (name, jsonName) => {
                    if (enumValues !== undefined) {
                        const [enumValue] = getAccessorName(enumValues, jsonName);
                        if (enumValue !== undefined) {
                            this.emitLine(combinedName, "_", name, " = ", enumValue.toString(), ",");
                        } else {
                            this.emitLine(combinedName, "_", name, ",");
                        }
                    } else {
                        this.emitLine(combinedName, "_", name, ",");
                    }
                });
            },
            "",
            true
        );
        this.ensureBlankLine();
        this.emitTypdefAlias(enumType, enumName);
    }

    /**
     * Function called to create enum prototypes
     * @param enumType: enum type
     */
    protected emitEnumPrototypes(enumType: EnumType): void {
        const enumName = this.nameForNamedType(enumType);

        this.emitLine("enum ", enumName, " cJSON_Get", enumName, "Value(", this.withConst("cJSON"), " * j);");
        this.emitLine("cJSON * cJSON_Create", enumName, "(", this.withConst(["enum ", enumName]), " x);");
        this.ensureBlankLine();
    }

    /**
     * Function called to create enum functions
     * @param enumType: enum type
     */
    protected emitEnumFunctions(enumType: EnumType): void {
        const enumName = this.nameForNamedType(enumType);

        /* Create cJSON to enumName generator function */
        this.emitBlock(["enum ", enumName, " cJSON_Get", enumName, "Value(", this.withConst("cJSON"), " * j)"], () => {
            this.emitLine("enum ", enumName, " x = 0;");
            this.emitBlock(["if (NULL != j)"], () => {
                let onFirst = true;
                const combinedName = allUpperWordStyle(this.sourcelikeToString(enumName));
                this.forEachEnumCase(enumType, "none", (name, jsonName) => {
                    this.emitLine(
                        onFirst ? "" : "else ",
                        'if (!strcmp(cJSON_GetStringValue(j), "',
                        jsonName,
                        '")) x = ',
                        combinedName,
                        "_",
                        name,
                        ";"
                    );
                    onFirst = false;
                });
            });
            this.emitLine("return x;");
        });
        this.ensureBlankLine();

        /* Create enumName to cJSON generator function */
        this.emitBlock(["cJSON * cJSON_Create", enumName, "(", this.withConst(["enum ", enumName]), " x)"], () => {
            this.emitLine("cJSON * j = NULL;");
            this.emitBlock(["switch (x)"], () => {
                const combinedName = allUpperWordStyle(this.sourcelikeToString(enumName));
                this.forEachEnumCase(enumType, "none", (name, jsonName) => {
                    this.emitLine(
                        "case ",
                        combinedName,
                        "_",
                        name,
                        ': j = cJSON_CreateString("',
                        jsonName,
                        '"); break;'
                    );
                });
            });
            this.emitLine("return j;");
        });
        this.ensureBlankLine();
    }

    /**
     * Function called to create a union header files with types and generators
     * @param unionType: union type
     * @param includes: Array of includes
     */
    protected emitUnion(unionType: UnionType, includes: string[]): void {
        /* Create file */
        const unionName = this.nameForNamedType(unionType);
        const filename = this.sourcelikeToString(unionName).concat(".h");
        includes.push(filename);
        this.startFile(filename);

        /* Create includes */
        this.emitIncludes(unionType, this.sourcelikeToString(filename));

        /* Create types */
        this.emitUnionTypedef(unionType);

        /* Create prototypes */
        this.emitUnionPrototypes(unionType);

        /* Create functions */
        this.emitUnionFunctions(unionType);

        /* Close file */
        this.finishFile();
    }

    /**
     * Function called to create union typedef
     * @param unionType: union type
     */
    protected emitUnionTypedef(unionType: UnionType): void {
        const [_hasNull, nonNulls] = removeNullFromUnion(unionType);
        const unionName = this.nameForNamedType(unionType);

        this.emitDescription(this.descriptionForType(unionType));
        this.emitBlock(
            ["struct ", unionName],
            () => {
                this.emitLine("int type;");
                this.emitBlock(
                    ["union"],
                    () => {
                        for (const type of nonNulls) {
                            const cJSON = this.quicktypeTypeToCJSON(type, false);
                            this.emitLine(
                                cJSON.cType,
                                cJSON.optionalQualifier !== "" ? " " : "",
                                cJSON.optionalQualifier,
                                " ",
                                this.nameForUnionMember(unionType, type),
                                ";"
                            );
                        }
                    },
                    "value",
                    true
                );
            },
            "",
            true
        );
        this.ensureBlankLine();
        this.emitTypdefAlias(unionType, unionName);
    }

    /**
     * Function called to create union prototypes
     * @param unionType: union type
     */
    protected emitUnionPrototypes(unionType: UnionType): void {
        const unionName = this.nameForNamedType(unionType);

        this.emitLine("struct ", unionName, " * cJSON_Get", unionName, "Value(const cJSON * j);");
        this.emitLine("cJSON * cJSON_Create", unionName, "(", this.withConst(["struct ", unionName]), " * x);");
        this.emitLine("void cJSON_Delete", unionName, "(struct ", unionName, " * x);");
        this.ensureBlankLine();
    }

    /**
     * Function called to create union functions
     * @param unionType: union type
     */
    protected emitUnionFunctions(unionType: UnionType): void {
        const [hasNull, nonNulls] = removeNullFromUnion(unionType);
        const unionName = this.nameForNamedType(unionType);

        /* Create cJSON to unionType generator function */
        this.emitBlock(["struct ", unionName, " * cJSON_Get", unionName, "Value(const cJSON * j)"], () => {
            let onFirst = true;
            this.emitLine("struct ", unionName, " * x = cJSON_malloc(sizeof(struct ", unionName, "));");
            this.emitBlock(["if (NULL != x)"], () => {
                this.emitLine("memset(x, 0, sizeof(struct ", unionName, "));");
                if (hasNull !== null) {
                    this.emitBlock(["if (cJSON_IsNull(j))"], () => {
                        this.emitLine("x->type = cJSON_NULL;");
                    });
                    onFirst = false;
                }
                for (const type of nonNulls) {
                    const cJSON = this.quicktypeTypeToCJSON(type, false);
                    this.emitBlock([onFirst === true ? "if (" : "else if (", cJSON.isType, "(j))"], () => {
                        this.emitLine("x->type = ", cJSON.cjsonType, ";");
                        if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                            const level = 0;
                            const child_level = 1;
                            this.emitLine(cJSON.cType, " * x", child_level.toString(), " = list_create(false, NULL);");
                            this.emitBlock(["if (NULL != x", child_level.toString(), ")"], () => {
                                this.emitLine("cJSON * e", child_level.toString(), " = NULL;");
                                this.emitBlock(
                                    [
                                        "cJSON_ArrayForEach(e",
                                        child_level.toString(),
                                        ", j",
                                        level > 0 ? level.toString() : "",
                                        ")"
                                    ],
                                    () => {
                                        const add = (cJSON: TypeCJSON, level: number, child_level: number) => {
                                            if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                /* Not supported */
                                            } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                /* Not supported */
                                            } else if (
                                                cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                                cJSON.items!.cjsonType === "cJSON_NULL"
                                            ) {
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", (",
                                                    cJSON.items!.cType,
                                                    " *)0xDEADBEEF, sizeof(",
                                                    cJSON.items!.cType,
                                                    " *));"
                                                );
                                            } else if (cJSON.items!.cjsonType === "cJSON_String") {
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", strdup(",
                                                    cJSON.items!.getValue,
                                                    "(e",
                                                    child_level.toString(),
                                                    ")), sizeof(",
                                                    cJSON.items!.cType,
                                                    " *));"
                                                );
                                            } else if (
                                                cJSON.items!.cjsonType === "cJSON_Object" ||
                                                cJSON.items!.cjsonType === "cJSON_Union"
                                            ) {
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", ",
                                                    cJSON.items!.getValue,
                                                    "(e",
                                                    child_level.toString(),
                                                    "), sizeof(",
                                                    cJSON.items!.cType,
                                                    " *));"
                                                );
                                            } else {
                                                this.emitLine(
                                                    cJSON.items!.cType,
                                                    " * tmp",
                                                    level > 0 ? level.toString() : "",
                                                    " = cJSON_malloc(sizeof(",
                                                    cJSON.items!.cType,
                                                    "));"
                                                );
                                                this.emitBlock(
                                                    ["if (NULL != tmp", level > 0 ? level.toString() : "", ")"],
                                                    () => {
                                                        this.emitLine(
                                                            "* tmp",
                                                            level > 0 ? level.toString() : "",
                                                            " = ",
                                                            cJSON.items!.getValue,
                                                            "(e",
                                                            child_level.toString(),
                                                            ");"
                                                        );
                                                        this.emitLine(
                                                            "list_add_tail(x",
                                                            child_level.toString(),
                                                            ", tmp",
                                                            level > 0 ? level.toString() : "",
                                                            ", sizeof(",
                                                            cJSON.items!.cType,
                                                            " *));"
                                                        );
                                                    }
                                                );
                                            }
                                        };
                                        if (cJSON.items!.isNullable) {
                                            this.emitBlock(
                                                ["if (!cJSON_IsNull(e", child_level.toString(), "))"],
                                                () => {
                                                    add(cJSON, level, child_level);
                                                }
                                            );
                                            this.emitBlock(["else"], () => {
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", (void *)0xDEADBEEF, sizeof(void *));"
                                                );
                                            });
                                        } else {
                                            add(cJSON, level, child_level);
                                        }
                                    }
                                );
                                this.emitLine(
                                    "x->value.",
                                    this.nameForUnionMember(unionType, type),
                                    " = x",
                                    child_level.toString(),
                                    ";"
                                );
                            });
                        } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                            const level = 0;
                            const child_level = 1;
                            this.emitLine(
                                cJSON.cType,
                                " * x",
                                child_level.toString(),
                                " = hashtable_create(",
                                this.hashtableSize,
                                ", false);"
                            );
                            this.emitBlock(["if (NULL != x", child_level.toString(), ")"], () => {
                                this.emitLine("cJSON * e", child_level.toString(), " = NULL;");
                                this.emitBlock(
                                    [
                                        "cJSON_ArrayForEach(e",
                                        child_level.toString(),
                                        ", j",
                                        level > 0 ? level.toString() : "",
                                        ")"
                                    ],
                                    () => {
                                        const add = (cJSON: TypeCJSON, level: number, child_level: number) => {
                                            if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                /* Not supported */
                                            } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                /* Not supported */
                                            } else if (
                                                cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                                cJSON.items!.cjsonType === "cJSON_NULL"
                                            ) {
                                                this.emitLine(
                                                    "hashtable_add(x",
                                                    child_level.toString(),
                                                    ", e",
                                                    child_level.toString(),
                                                    "->string, (",
                                                    cJSON.items!.cType,
                                                    " *)0xDEADBEEF, sizeof(",
                                                    cJSON.items!.cType,
                                                    " *));"
                                                );
                                            } else if (cJSON.items!.cjsonType === "cJSON_String") {
                                                this.emitLine(
                                                    "hashtable_add(x",
                                                    child_level.toString(),
                                                    ", e",
                                                    child_level.toString(),
                                                    "->string, strdup(",
                                                    cJSON.items!.getValue,
                                                    "(e",
                                                    child_level.toString(),
                                                    ")), sizeof(",
                                                    cJSON.items!.cType,
                                                    " *));"
                                                );
                                            } else if (
                                                cJSON.items!.cjsonType === "cJSON_Object" ||
                                                cJSON.items!.cjsonType === "cJSON_Union"
                                            ) {
                                                this.emitLine(
                                                    "hashtable_add(x",
                                                    child_level.toString(),
                                                    ", e",
                                                    child_level.toString(),
                                                    "->string, ",
                                                    cJSON.items!.getValue,
                                                    "(e",
                                                    child_level.toString(),
                                                    "), sizeof(",
                                                    cJSON.items!.cType,
                                                    " *));"
                                                );
                                            } else {
                                                this.emitLine(
                                                    cJSON.items!.cType,
                                                    " * tmp",
                                                    level > 0 ? level.toString() : "",
                                                    " = cJSON_malloc(sizeof(",
                                                    cJSON.items!.cType,
                                                    "));"
                                                );
                                                this.emitBlock(
                                                    ["if (NULL != tmp", level > 0 ? level.toString() : "", ")"],
                                                    () => {
                                                        this.emitLine(
                                                            "* tmp",
                                                            level > 0 ? level.toString() : "",
                                                            " = ",
                                                            cJSON.items!.getValue,
                                                            "(e",
                                                            child_level.toString(),
                                                            ");"
                                                        );
                                                        this.emitLine(
                                                            "hashtable_add(x",
                                                            child_level.toString(),
                                                            ", e",
                                                            child_level.toString(),
                                                            "->string, tmp",
                                                            level > 0 ? level.toString() : "",
                                                            ", sizeof(",
                                                            cJSON.items!.cType,
                                                            " *));"
                                                        );
                                                    }
                                                );
                                            }
                                        };
                                        if (cJSON.items!.isNullable) {
                                            this.emitBlock(
                                                ["if (!cJSON_IsNull(e", child_level.toString(), "))"],
                                                () => {
                                                    add(cJSON, level, child_level);
                                                }
                                            );
                                            this.emitBlock(["else"], () => {
                                                this.emitLine(
                                                    "hashtable_add(x",
                                                    child_level.toString(),
                                                    ", e",
                                                    child_level.toString(),
                                                    "->string, (void *)0xDEADBEEF, sizeof(void *));"
                                                );
                                            });
                                        } else {
                                            add(cJSON, level, child_level);
                                        }
                                    }
                                );
                                this.emitLine(
                                    "x->value.",
                                    this.nameForUnionMember(unionType, type),
                                    " = x",
                                    child_level.toString(),
                                    ";"
                                );
                            });
                        } else if (cJSON.cjsonType === "cJSON_Invalid" || cJSON.cjsonType === "cJSON_NULL") {
                            this.emitLine(
                                "x->value.",
                                this.nameForUnionMember(unionType, type),
                                " = (",
                                cJSON.cType,
                                " *)0xDEADBEEF;"
                            );
                        } else if (cJSON.cjsonType === "cJSON_String") {
                            this.emitLine(
                                "x->value.",
                                this.nameForUnionMember(unionType, type),
                                " = strdup(",
                                cJSON.getValue,
                                "(j));"
                            );
                        } else {
                            this.emitLine(
                                "x->value.",
                                this.nameForUnionMember(unionType, type),
                                " = ",
                                cJSON.getValue,
                                "(j);"
                            );
                        }
                    });
                    onFirst = false;
                }
            });
            this.emitLine("return x;");
        });
        this.ensureBlankLine();

        /* Create unionName to cJSON generator function */
        this.emitBlock(
            ["cJSON * cJSON_Create", unionName, "(", this.withConst(["struct ", unionName]), " * x)"],
            () => {
                this.emitLine("cJSON * j = NULL;");
                this.emitBlock(["if (NULL != x)"], () => {
                    let onFirst = true;
                    if (hasNull !== null) {
                        this.emitBlock(["if (cJSON_NULL == x->type)"], () => {
                            this.emitLine("j = cJSON_CreateNull();");
                        });
                        onFirst = false;
                    }
                    for (const type of nonNulls) {
                        const cJSON = this.quicktypeTypeToCJSON(type, false);
                        this.emitBlock(
                            [onFirst === true ? "if (" : "else if (", cJSON.cjsonType, " == x->type)"],
                            () => {
                                if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                                    const level = 0;
                                    const child_level = 1;
                                    this.emitLine(
                                        "cJSON * j",
                                        child_level.toString(),
                                        " = ",
                                        cJSON.createObject,
                                        "();"
                                    );
                                    this.emitBlock(["if (NULL != j", child_level.toString(), ")"], () => {
                                        this.emitLine(
                                            cJSON.items!.cType,
                                            " * x",
                                            child_level.toString(),
                                            " = list_get_head(x",
                                            level > 0 ? level.toString() : "",
                                            "->value.",
                                            this.nameForUnionMember(unionType, type),
                                            ");"
                                        );
                                        this.emitBlock(["while (NULL != x", child_level.toString(), ")"], () => {
                                            const add = (cJSON: TypeCJSON, child_level: number) => {
                                                if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                    /* Not supported */
                                                } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                    /* Not supported */
                                                } else if (cJSON.items!.cjsonType === "cJSON_Invalid") {
                                                    /* Nothing to do */
                                                } else if (cJSON.items!.cjsonType === "cJSON_NULL") {
                                                    this.emitLine(
                                                        "cJSON_AddItemToArray(j",
                                                        child_level.toString(),
                                                        ", ",
                                                        cJSON.items!.createObject,
                                                        "());"
                                                    );
                                                } else if (
                                                    cJSON.items!.cjsonType === "cJSON_String" ||
                                                    cJSON.items!.cjsonType === "cJSON_Object" ||
                                                    cJSON.items!.cjsonType === "cJSON_Union"
                                                ) {
                                                    this.emitLine(
                                                        "cJSON_AddItemToArray(j",
                                                        child_level.toString(),
                                                        ", ",
                                                        cJSON.items!.createObject,
                                                        "(x",
                                                        child_level.toString(),
                                                        "));"
                                                    );
                                                } else {
                                                    this.emitLine(
                                                        "cJSON_AddItemToArray(j",
                                                        child_level.toString(),
                                                        ", ",
                                                        cJSON.items!.createObject,
                                                        "(*x",
                                                        child_level.toString(),
                                                        "));"
                                                    );
                                                }
                                            };
                                            if (cJSON.items!.isNullable) {
                                                this.emitBlock(
                                                    ["if ((void *)0xDEADBEEF != x", child_level.toString(), ")"],
                                                    () => {
                                                        add(cJSON, child_level);
                                                    }
                                                );
                                                this.emitBlock(["else"], () => {
                                                    this.emitLine(
                                                        "cJSON_AddItemToArray(j",
                                                        child_level.toString(),
                                                        ", cJSON_CreateNull());"
                                                    );
                                                });
                                            } else {
                                                add(cJSON, child_level);
                                            }
                                            this.emitLine(
                                                "x",
                                                child_level.toString(),
                                                " = list_get_next(x",
                                                level > 0 ? level.toString() : "",
                                                "->value.",
                                                this.nameForUnionMember(unionType, type),
                                                ");"
                                            );
                                        });
                                        this.emitLine("j = j", child_level.toString(), ";");
                                    });
                                } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                                    const level = 0;
                                    const child_level = 1;
                                    this.emitLine(
                                        "cJSON * j",
                                        child_level.toString(),
                                        " = ",
                                        cJSON.createObject,
                                        "();"
                                    );
                                    this.emitBlock(["if (NULL != j", child_level.toString(), ")"], () => {
                                        this.emitLine("char **keys", child_level.toString(), " = NULL;");
                                        this.emitLine(
                                            "size_t count",
                                            child_level.toString(),
                                            " = hashtable_get_keys(x",
                                            level > 0 ? level.toString() : "",
                                            "->value.",
                                            this.nameForUnionMember(unionType, type),
                                            ", &keys",
                                            child_level.toString(),
                                            ");"
                                        );
                                        this.emitBlock(["if (NULL != keys", child_level.toString(), ")"], () => {
                                            this.emitBlock(
                                                [
                                                    "for (size_t index",
                                                    child_level.toString(),
                                                    " = 0; index",
                                                    child_level.toString(),
                                                    " < count",
                                                    child_level.toString(),
                                                    "; index",
                                                    child_level.toString(),
                                                    "++)"
                                                ],
                                                () => {
                                                    this.emitLine(
                                                        cJSON.items!.cType,
                                                        " *x",
                                                        child_level.toString(),
                                                        " = hashtable_lookup(x",
                                                        level > 0 ? level.toString() : "",
                                                        "->value.",
                                                        this.nameForUnionMember(unionType, type),
                                                        ", keys",
                                                        child_level.toString(),
                                                        "[index",
                                                        child_level.toString(),
                                                        "]);"
                                                    );
                                                    const add = (cJSON: TypeCJSON, child_level: number) => {
                                                        if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                            /* Not supported */
                                                        } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                            /* Not supported */
                                                        } else if (cJSON.items!.cjsonType === "cJSON_Invalid") {
                                                            /* Nothing to do */
                                                        } else if (cJSON.items!.cjsonType === "cJSON_NULL") {
                                                            this.emitLine(
                                                                cJSON.addToObject,
                                                                "(j",
                                                                child_level.toString(),
                                                                ", keys",
                                                                child_level.toString(),
                                                                "[index",
                                                                child_level.toString(),
                                                                "], ",
                                                                cJSON.items!.createObject,
                                                                "());"
                                                            );
                                                        } else if (
                                                            cJSON.items!.cjsonType === "cJSON_String" ||
                                                            cJSON.items!.cjsonType === "cJSON_Object" ||
                                                            cJSON.items!.cjsonType === "cJSON_Union"
                                                        ) {
                                                            this.emitLine(
                                                                cJSON.addToObject,
                                                                "(j",
                                                                child_level.toString(),
                                                                ", keys",
                                                                child_level.toString(),
                                                                "[index",
                                                                child_level.toString(),
                                                                "], ",
                                                                cJSON.items!.createObject,
                                                                "(x",
                                                                child_level.toString(),
                                                                "));"
                                                            );
                                                        } else {
                                                            this.emitLine(
                                                                cJSON.addToObject,
                                                                "(j",
                                                                child_level.toString(),
                                                                ", keys",
                                                                child_level.toString(),
                                                                "[index",
                                                                child_level.toString(),
                                                                "], ",
                                                                cJSON.items!.createObject,
                                                                "(*x",
                                                                child_level.toString(),
                                                                "));"
                                                            );
                                                        }
                                                    };
                                                    if (cJSON.items!.isNullable) {
                                                        this.emitBlock(
                                                            [
                                                                "if ((void *)0xDEADBEEF != x",
                                                                child_level.toString(),
                                                                ")"
                                                            ],
                                                            () => {
                                                                add(cJSON, child_level);
                                                            }
                                                        );
                                                        this.emitBlock(["else"], () => {
                                                            this.emitLine(
                                                                cJSON.addToObject,
                                                                "(j",
                                                                child_level.toString(),
                                                                ", keys",
                                                                child_level.toString(),
                                                                "[index",
                                                                child_level.toString(),
                                                                "], cJSON_CreateNull());"
                                                            );
                                                        });
                                                    } else {
                                                        add(cJSON, child_level);
                                                    }
                                                }
                                            );
                                            this.emitLine("cJSON_free(keys", child_level.toString(), ");");
                                        });
                                        this.emitLine("j = j", child_level.toString(), ";");
                                    });
                                } else if (cJSON.cjsonType === "cJSON_Invalid") {
                                    /* Nothing to do */
                                } else if (cJSON.cjsonType === "cJSON_NULL") {
                                    this.emitLine("j = ", cJSON.createObject, "();");
                                } else {
                                    this.emitLine(
                                        "j = ",
                                        cJSON.createObject,
                                        "(x->value.",
                                        this.nameForUnionMember(unionType, type),
                                        ");"
                                    );
                                }
                            }
                        );
                        onFirst = false;
                    }
                });
                this.emitLine("return j;");
            }
        );
        this.ensureBlankLine();

        /* Create unionName delete function */
        this.emitBlock(["void cJSON_Delete", unionName, "(struct ", unionName, " * x)"], () => {
            this.emitBlock(["if (NULL != x)"], () => {
                let onFirst = true;
                for (const type of nonNulls) {
                    const cJSON = this.quicktypeTypeToCJSON(type, false);
                    this.emitBlock([onFirst === true ? "if (" : "else if (", cJSON.cjsonType, " == x->type)"], () => {
                        if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                            const level = 0;
                            const child_level = 1;
                            this.emitBlock(
                                [
                                    "if (NULL != x",
                                    level > 0 ? level.toString() : "",
                                    "->value.",
                                    this.nameForUnionMember(unionType, type),
                                    ")"
                                ],
                                () => {
                                    this.emitLine(
                                        cJSON.items!.cType,
                                        " * x",
                                        child_level.toString(),
                                        " = list_get_head(x",
                                        level > 0 ? level.toString() : "",
                                        "->value.",
                                        this.nameForUnionMember(unionType, type),
                                        ");"
                                    );
                                    this.emitBlock(["while (NULL != x", child_level.toString(), ")"], () => {
                                        if (cJSON.items!.cjsonType === "cJSON_Array") {
                                            /* Not supported */
                                        } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                            /* Not supported */
                                        } else if (
                                            cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                            cJSON.items!.cjsonType === "cJSON_NULL"
                                        ) {
                                            /* Nothing to do */
                                        } else {
                                            if (cJSON.items!.isNullable) {
                                                this.emitBlock(
                                                    ["if ((void *)0xDEADBEEF != x", child_level.toString(), ")"],
                                                    () => {
                                                        this.emitLine(
                                                            cJSON.items!.deleteType,
                                                            "(x",
                                                            child_level.toString(),
                                                            ");"
                                                        );
                                                    }
                                                );
                                            } else {
                                                this.emitLine(
                                                    cJSON.items!.deleteType,
                                                    "(x",
                                                    child_level.toString(),
                                                    ");"
                                                );
                                            }
                                        }
                                        this.emitLine(
                                            "x",
                                            child_level.toString(),
                                            " = list_get_next(x",
                                            level > 0 ? level.toString() : "",
                                            "->value.",
                                            this.nameForUnionMember(unionType, type),
                                            ");"
                                        );
                                    });
                                    this.emitLine(
                                        cJSON.deleteType,
                                        "(x",
                                        level > 0 ? level.toString() : "",
                                        "->value.",
                                        this.nameForUnionMember(unionType, type),
                                        ");"
                                    );
                                }
                            );
                        } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                            const level = 0;
                            const child_level = 1;
                            this.emitBlock(
                                [
                                    "if (NULL != x",
                                    level > 0 ? level.toString() : "",
                                    "->value.",
                                    this.nameForUnionMember(unionType, type),
                                    ")"
                                ],
                                () => {
                                    this.emitLine("char **keys", child_level.toString(), " = NULL;");
                                    this.emitLine(
                                        "size_t count",
                                        child_level.toString(),
                                        " = hashtable_get_keys(x",
                                        level > 0 ? level.toString() : "",
                                        "->value.",
                                        this.nameForUnionMember(unionType, type),
                                        ", &keys",
                                        child_level.toString(),
                                        ");"
                                    );
                                    this.emitBlock(["if (NULL != keys", child_level.toString(), ")"], () => {
                                        this.emitBlock(
                                            [
                                                "for (size_t index",
                                                child_level.toString(),
                                                " = 0; index",
                                                child_level.toString(),
                                                " < count",
                                                child_level.toString(),
                                                "; index",
                                                child_level.toString(),
                                                "++)"
                                            ],
                                            () => {
                                                this.emitLine(
                                                    cJSON.items!.cType,
                                                    " *x",
                                                    child_level.toString(),
                                                    " = hashtable_lookup(x",
                                                    level > 0 ? level.toString() : "",
                                                    "->value.",
                                                    this.nameForUnionMember(unionType, type),
                                                    ", keys",
                                                    child_level.toString(),
                                                    "[index",
                                                    child_level.toString(),
                                                    "]);"
                                                );
                                                this.emitBlock(["if (NULL != x", child_level.toString(), ")"], () => {
                                                    if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                        /* Not supported */
                                                    } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                        /* Not supported */
                                                    } else if (
                                                        cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                                        cJSON.items!.cjsonType === "cJSON_NULL"
                                                    ) {
                                                        /* Nothing to do */
                                                    } else {
                                                        if (cJSON.items!.isNullable) {
                                                            this.emitBlock(
                                                                [
                                                                    "if ((void *)0xDEADBEEF != x",
                                                                    child_level.toString(),
                                                                    ")"
                                                                ],
                                                                () => {
                                                                    this.emitLine(
                                                                        cJSON.items!.deleteType,
                                                                        "(x",
                                                                        child_level.toString(),
                                                                        ");"
                                                                    );
                                                                }
                                                            );
                                                        } else {
                                                            this.emitLine(
                                                                cJSON.items!.deleteType,
                                                                "(x",
                                                                child_level.toString(),
                                                                ");"
                                                            );
                                                        }
                                                    }
                                                });
                                            }
                                        );
                                        this.emitLine("cJSON_free(keys", child_level.toString(), ");");
                                    });
                                    this.emitLine(
                                        cJSON.deleteType,
                                        "(x",
                                        level > 0 ? level.toString() : "",
                                        "->value.",
                                        this.nameForUnionMember(unionType, type),
                                        ");"
                                    );
                                }
                            );
                        } else if (cJSON.cjsonType === "cJSON_Invalid" || cJSON.cjsonType === "cJSON_NULL") {
                            /* Nothing to do */
                        } else if (
                            cJSON.cjsonType === "cJSON_String" ||
                            cJSON.cjsonType === "cJSON_Object" ||
                            cJSON.cjsonType === "cJSON_Union"
                        ) {
                            this.emitLine(
                                cJSON.deleteType,
                                "(x->value.",
                                this.nameForUnionMember(unionType, type),
                                ");"
                            );
                        } else {
                            /* Nothing to do */
                        }
                    });
                    onFirst = false;
                }
                this.emitLine("cJSON_free(x);");
            });
        });
        this.ensureBlankLine();
    }

    /**
     * Function called to create a class header files with types and generators
     * @param classType: class type
     * @param includes: Array of includes
     */
    protected emitClass(classType: ClassType, includes: string[]): void {
        /* Create file */
        const className = this.nameForNamedType(classType);
        const filename = this.sourcelikeToString(className).concat(".h");
        includes.push(filename);
        this.startFile(filename);

        /* Create includes */
        this.emitIncludes(classType, this.sourcelikeToString(filename));

        /* Create types */
        this.emitClassTypedef(classType);

        /* Create prototypes */
        this.emitClassPrototypes(classType);

        /* Create functions */
        this.emitClassFunctions(classType);

        /* Close file */
        this.finishFile();
    }

    /**
     * Function called to create class typedef
     * @param classType: class type
     */
    protected emitClassTypedef(classType: ClassType): void {
        const className = this.nameForNamedType(classType);

        this.emitDescription(this.descriptionForType(classType));
        this.emitBlock(
            ["struct ", className],
            () => {
                this.forEachClassProperty(classType, "none", (name, jsonName, property) => {
                    this.emitDescription(this.descriptionForClassProperty(classType, jsonName));
                    const cJSON = this.quicktypeTypeToCJSON(property.type, property.isOptional);
                    this.emitLine(
                        cJSON.cType,
                        cJSON.optionalQualifier !== "" ? " " : "",
                        cJSON.optionalQualifier,
                        " ",
                        name,
                        ";"
                    );
                });
            },
            "",
            true
        );
        this.ensureBlankLine();
        this.emitTypdefAlias(classType, className);
    }

    /**
     * Function called to create class prototypes
     * @param classType: class type
     */
    protected emitClassPrototypes(classType: ClassType): void {
        const className = this.nameForNamedType(classType);

        this.emitLine("struct ", className, " * cJSON_Parse", className, "(", this.withConst("char"), " * s);");
        this.emitLine("struct ", className, " * cJSON_Get", className, "Value(", this.withConst("cJSON"), " * j);");
        this.emitLine("cJSON * cJSON_Create", className, "(", this.withConst(["struct ", className]), " * x);");
        this.emitLine("char * cJSON_Print", className, "(", this.withConst(["struct ", className]), " * x);");
        this.emitLine("void cJSON_Delete", className, "(struct ", className, " * x);");
        this.ensureBlankLine();
    }

    /**
     * Function called to create class functions
     * @param classType: class type
     */
    protected emitClassFunctions(classType: ClassType): void {
        const className = this.nameForNamedType(classType);

        /* Create string to className generator function */
        this.emitBlock(
            ["struct ", className, " * cJSON_Parse", className, "(", this.withConst("char"), " * s)"],
            () => {
                this.emitLine("struct ", className, " * x = NULL;");
                this.emitBlock(["if (NULL != s)"], () => {
                    this.emitLine("cJSON * j = cJSON_Parse(s);");
                    this.emitBlock(["if (NULL != j)"], () => {
                        this.emitLine("x = cJSON_Get", className, "Value(j);");
                        this.emitLine("cJSON_Delete(j);");
                    });
                });
                this.emitLine("return x;");
            }
        );
        this.ensureBlankLine();

        /* Create cJSON to className generator function */
        this.emitBlock(
            ["struct ", className, " * cJSON_Get", className, "Value(", this.withConst("cJSON"), " * j)"],
            () => {
                this.emitLine("struct ", className, " * x = NULL;");
                this.emitBlock(["if (NULL != j)"], () => {
                    this.emitBlock(["if (NULL != (x = cJSON_malloc(sizeof(struct ", className, "))))"], () => {
                        this.emitLine("memset(x, 0, sizeof(struct ", className, "));");
                        const recur = (type: Type, level: number) => {
                            if (type instanceof ArrayType) {
                                const child_level = level + 1;
                                const cJSON = this.quicktypeTypeToCJSON(type.items, false);
                                this.emitLine("list_t * x", child_level.toString(), " = list_create(false, NULL);");
                                this.emitBlock(["if (NULL != x", child_level.toString(), ")"], () => {
                                    this.emitLine("cJSON * e", child_level.toString(), " = NULL;");
                                    this.emitBlock(
                                        ["cJSON_ArrayForEach(e", child_level.toString(), ", e", level.toString(), ")"],
                                        () => {
                                            if (cJSON.cjsonType === "cJSON_Array") {
                                                const child_level2 = child_level + 1;
                                                recur(type.items, child_level);
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", x",
                                                    child_level2.toString(),
                                                    ", sizeof(",
                                                    cJSON.items!.cType,
                                                    " *));"
                                                );
                                            } else if (cJSON.cjsonType === "cJSON_Map") {
                                                /* Not supported */
                                            } else if (
                                                cJSON.cjsonType === "cJSON_Invalid" ||
                                                cJSON.cjsonType === "cJSON_NULL"
                                            ) {
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", (",
                                                    cJSON.cType,
                                                    " *)0xDEADBEEF, sizeof(",
                                                    cJSON.cType,
                                                    " *));"
                                                );
                                            } else if (cJSON.cjsonType === "cJSON_String") {
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", strdup(",
                                                    cJSON.getValue,
                                                    "(e",
                                                    child_level.toString(),
                                                    ")), sizeof(",
                                                    cJSON.cType,
                                                    " *));"
                                                );
                                            } else if (
                                                cJSON.cjsonType === "cJSON_Object" ||
                                                cJSON.cjsonType === "cJSON_Union"
                                            ) {
                                                this.emitLine(
                                                    "list_add_tail(x",
                                                    child_level.toString(),
                                                    ", ",
                                                    cJSON.getValue,
                                                    "(e",
                                                    child_level.toString(),
                                                    "), sizeof(",
                                                    cJSON.cType,
                                                    " *));"
                                                );
                                            } else {
                                                this.emitLine(
                                                    cJSON.cType,
                                                    " * tmp",
                                                    level > 0 ? level.toString() : "",
                                                    " = cJSON_malloc(sizeof(",
                                                    cJSON.cType,
                                                    "));"
                                                );
                                                this.emitBlock(
                                                    ["if (NULL != tmp", level > 0 ? level.toString() : "", ")"],
                                                    () => {
                                                        this.emitLine(
                                                            "* tmp",
                                                            level > 0 ? level.toString() : "",
                                                            " = ",
                                                            cJSON.getValue,
                                                            "(e",
                                                            child_level.toString(),
                                                            ");"
                                                        );
                                                        this.emitLine(
                                                            "list_add_tail(x",
                                                            child_level.toString(),
                                                            ", tmp",
                                                            level > 0 ? level.toString() : "",
                                                            ", sizeof(",
                                                            cJSON.cType,
                                                            " *));"
                                                        );
                                                    }
                                                );
                                            }
                                        }
                                    );
                                });
                            } else if (type instanceof ClassType) {
                                this.forEachClassProperty(type, "none", (name, jsonName, property) => {
                                    const cJSON = this.quicktypeTypeToCJSON(property.type, property.isOptional);
                                    this.emitBlock(
                                        !cJSON.isNullable
                                            ? [
                                                  "if (cJSON_HasObjectItem(j",
                                                  level > 0 ? level.toString() : "",
                                                  ', "',
                                                  jsonName,
                                                  '"))'
                                              ]
                                            : [
                                                  "if ((cJSON_HasObjectItem(j",
                                                  level > 0 ? level.toString() : "",
                                                  ', "',
                                                  jsonName,
                                                  '")) && (!cJSON_IsNull(cJSON_GetObjectItemCaseSensitive(j',
                                                  level > 0 ? level.toString() : "",
                                                  ', "',
                                                  jsonName,
                                                  '"))))'
                                              ],
                                        () => {
                                            if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                                                const child_level = level + 1;
                                                this.emitLine(
                                                    cJSON.cType,
                                                    " * x",
                                                    child_level.toString(),
                                                    " = list_create(false, NULL);"
                                                );
                                                this.emitBlock(["if (NULL != x", child_level.toString(), ")"], () => {
                                                    this.emitLine("cJSON * e", child_level.toString(), " = NULL;");
                                                    this.emitLine(
                                                        "cJSON * j",
                                                        child_level.toString(),
                                                        " = cJSON_GetObjectItemCaseSensitive(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '");'
                                                    );
                                                    this.emitBlock(
                                                        [
                                                            "cJSON_ArrayForEach(e",
                                                            child_level.toString(),
                                                            ", j",
                                                            child_level.toString(),
                                                            ")"
                                                        ],
                                                        () => {
                                                            const add = (
                                                                type: Type,
                                                                cJSON: TypeCJSON,
                                                                level: number,
                                                                child_level: number
                                                            ) => {
                                                                if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                                    if (type instanceof ArrayType) {
                                                                        const child_level2 = child_level + 1;
                                                                        recur(type.items, child_level);
                                                                        this.emitLine(
                                                                            "list_add_tail(x",
                                                                            child_level.toString(),
                                                                            ", x",
                                                                            child_level2.toString(),
                                                                            ", sizeof(",
                                                                            cJSON.items!.cType,
                                                                            " *));"
                                                                        );
                                                                    } else {
                                                                        panic("Invalid type");
                                                                    }
                                                                } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                                    /* Not supported */
                                                                } else if (
                                                                    cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                                                    cJSON.items!.cjsonType === "cJSON_NULL"
                                                                ) {
                                                                    this.emitLine(
                                                                        "list_add_tail(x",
                                                                        child_level.toString(),
                                                                        ", (",
                                                                        cJSON.items!.cType,
                                                                        " *)0xDEADBEEF, sizeof(",
                                                                        cJSON.items!.cType,
                                                                        " *));"
                                                                    );
                                                                } else if (cJSON.items!.cjsonType === "cJSON_String") {
                                                                    this.emitLine(
                                                                        "list_add_tail(x",
                                                                        child_level.toString(),
                                                                        ", strdup(",
                                                                        cJSON.items!.getValue,
                                                                        "(e",
                                                                        child_level.toString(),
                                                                        ")), sizeof(",
                                                                        cJSON.items!.cType,
                                                                        " *));"
                                                                    );
                                                                } else if (
                                                                    cJSON.items!.cjsonType === "cJSON_Object" ||
                                                                    cJSON.items!.cjsonType === "cJSON_Union"
                                                                ) {
                                                                    this.emitLine(
                                                                        "list_add_tail(x",
                                                                        child_level.toString(),
                                                                        ", ",
                                                                        cJSON.items!.getValue,
                                                                        "(e",
                                                                        child_level.toString(),
                                                                        "), sizeof(",
                                                                        cJSON.items!.cType,
                                                                        " *));"
                                                                    );
                                                                } else {
                                                                    this.emitLine(
                                                                        cJSON.items!.cType,
                                                                        " * tmp",
                                                                        level > 0 ? level.toString() : "",
                                                                        " = cJSON_malloc(sizeof(",
                                                                        cJSON.items!.cType,
                                                                        "));"
                                                                    );
                                                                    this.emitBlock(
                                                                        [
                                                                            "if (NULL != tmp",
                                                                            level > 0 ? level.toString() : "",
                                                                            ")"
                                                                        ],
                                                                        () => {
                                                                            this.emitLine(
                                                                                "* tmp",
                                                                                level > 0 ? level.toString() : "",
                                                                                " = ",
                                                                                cJSON.items!.getValue,
                                                                                "(e",
                                                                                child_level.toString(),
                                                                                ");"
                                                                            );
                                                                            this.emitLine(
                                                                                "list_add_tail(x",
                                                                                child_level.toString(),
                                                                                ", tmp",
                                                                                level > 0 ? level.toString() : "",
                                                                                ", sizeof(",
                                                                                cJSON.items!.cType,
                                                                                " *));"
                                                                            );
                                                                        }
                                                                    );
                                                                }
                                                            };
                                                            if (cJSON.items!.isNullable) {
                                                                this.emitBlock(
                                                                    [
                                                                        "if (!cJSON_IsNull(e",
                                                                        child_level.toString(),
                                                                        "))"
                                                                    ],
                                                                    () => {
                                                                        add(property.type, cJSON, level, child_level);
                                                                    }
                                                                );
                                                                this.emitBlock(["else"], () => {
                                                                    this.emitLine(
                                                                        "list_add_tail(x",
                                                                        child_level.toString(),
                                                                        ", (void *)0xDEADBEEF, sizeof(void *));"
                                                                    );
                                                                });
                                                            } else {
                                                                add(property.type, cJSON, level, child_level);
                                                            }
                                                        }
                                                    );
                                                    this.emitLine(
                                                        "x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        " = x",
                                                        child_level.toString(),
                                                        ";"
                                                    );
                                                });
                                            } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                                                const child_level = level + 1;
                                                this.emitLine(
                                                    cJSON.cType,
                                                    " * x",
                                                    child_level.toString(),
                                                    " = hashtable_create(",
                                                    this.hashtableSize,
                                                    ", false);"
                                                );
                                                this.emitBlock(["if (NULL != x", child_level.toString(), ")"], () => {
                                                    this.emitLine("cJSON * e", child_level.toString(), " = NULL;");
                                                    this.emitLine(
                                                        "cJSON * j",
                                                        child_level.toString(),
                                                        " = cJSON_GetObjectItemCaseSensitive(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '");'
                                                    );
                                                    this.emitBlock(
                                                        [
                                                            "cJSON_ArrayForEach(e",
                                                            child_level.toString(),
                                                            ", j",
                                                            child_level.toString(),
                                                            ")"
                                                        ],
                                                        () => {
                                                            const add = (
                                                                type: Type,
                                                                cJSON: TypeCJSON,
                                                                level: number,
                                                                child_level: number
                                                            ) => {
                                                                if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                                    if (type instanceof MapType) {
                                                                        const child_level2 = child_level + 1;
                                                                        recur(type.values, child_level);
                                                                        this.emitLine(
                                                                            "hashtable_add(x",
                                                                            child_level.toString(),
                                                                            ", e",
                                                                            child_level.toString(),
                                                                            "->string, x",
                                                                            child_level2.toString(),
                                                                            ", sizeof(",
                                                                            cJSON.items!.cType,
                                                                            " *));"
                                                                        );
                                                                    } else {
                                                                        panic("Invalid type");
                                                                    }
                                                                } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                                    /* Not supported */
                                                                } else if (
                                                                    cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                                                    cJSON.items!.cjsonType === "cJSON_NULL"
                                                                ) {
                                                                    this.emitLine(
                                                                        "hashtable_add(x",
                                                                        child_level.toString(),
                                                                        ", e",
                                                                        child_level.toString(),
                                                                        "->string, (",
                                                                        cJSON.items!.cType,
                                                                        " *)0xDEADBEEF, sizeof(",
                                                                        cJSON.items!.cType,
                                                                        " *));"
                                                                    );
                                                                } else if (cJSON.items!.cjsonType === "cJSON_String") {
                                                                    this.emitLine(
                                                                        "hashtable_add(x",
                                                                        child_level.toString(),
                                                                        ", e",
                                                                        child_level.toString(),
                                                                        "->string, strdup(",
                                                                        cJSON.items!.getValue,
                                                                        "(e",
                                                                        child_level.toString(),
                                                                        ")), sizeof(",
                                                                        cJSON.items!.cType,
                                                                        " *));"
                                                                    );
                                                                } else if (
                                                                    cJSON.items!.cjsonType === "cJSON_Object" ||
                                                                    cJSON.items!.cjsonType === "cJSON_Union"
                                                                ) {
                                                                    this.emitLine(
                                                                        "hashtable_add(x",
                                                                        child_level.toString(),
                                                                        ", e",
                                                                        child_level.toString(),
                                                                        "->string, ",
                                                                        cJSON.items!.getValue,
                                                                        "(e",
                                                                        child_level.toString(),
                                                                        "), sizeof(",
                                                                        cJSON.items!.cType,
                                                                        " *));"
                                                                    );
                                                                } else {
                                                                    this.emitLine(
                                                                        cJSON.items!.cType,
                                                                        " * tmp",
                                                                        level > 0 ? level.toString() : "",
                                                                        " = cJSON_malloc(sizeof(",
                                                                        cJSON.items!.cType,
                                                                        "));"
                                                                    );
                                                                    this.emitBlock(
                                                                        [
                                                                            "if (NULL != tmp",
                                                                            level > 0 ? level.toString() : "",
                                                                            ")"
                                                                        ],
                                                                        () => {
                                                                            this.emitLine(
                                                                                "* tmp",
                                                                                level > 0 ? level.toString() : "",
                                                                                " = ",
                                                                                cJSON.items!.getValue,
                                                                                "(e",
                                                                                child_level.toString(),
                                                                                ");"
                                                                            );
                                                                            this.emitLine(
                                                                                "hashtable_add(x",
                                                                                child_level.toString(),
                                                                                ", e",
                                                                                child_level.toString(),
                                                                                "->string, tmp",
                                                                                level > 0 ? level.toString() : "",
                                                                                ", sizeof(",
                                                                                cJSON.items!.cType,
                                                                                " *));"
                                                                            );
                                                                        }
                                                                    );
                                                                }
                                                            };
                                                            if (cJSON.items!.isNullable) {
                                                                this.emitBlock(
                                                                    [
                                                                        "if (!cJSON_IsNull(e",
                                                                        child_level.toString(),
                                                                        "))"
                                                                    ],
                                                                    () => {
                                                                        add(property.type, cJSON, level, child_level);
                                                                    }
                                                                );
                                                                this.emitBlock(["else"], () => {
                                                                    this.emitLine(
                                                                        "hashtable_add(x",
                                                                        child_level.toString(),
                                                                        ", e",
                                                                        child_level.toString(),
                                                                        "->string, (void *)0xDEADBEEF, sizeof(void *));"
                                                                    );
                                                                });
                                                            } else {
                                                                add(property.type, cJSON, level, child_level);
                                                            }
                                                        }
                                                    );
                                                    this.emitLine(
                                                        "x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        " = x",
                                                        child_level.toString(),
                                                        ";"
                                                    );
                                                });
                                            } else if (
                                                cJSON.cjsonType === "cJSON_Invalid" ||
                                                cJSON.cjsonType === "cJSON_NULL"
                                            ) {
                                                this.emitLine(
                                                    "x",
                                                    level > 0 ? level.toString() : "",
                                                    "->",
                                                    name,
                                                    " = (",
                                                    cJSON.cType,
                                                    " *)0xDEADBEEF;"
                                                );
                                            } else if (cJSON.cjsonType === "cJSON_String") {
                                                this.emitLine(
                                                    "x",
                                                    level > 0 ? level.toString() : "",
                                                    "->",
                                                    name,
                                                    " = strdup(",
                                                    cJSON.getValue,
                                                    "(cJSON_GetObjectItemCaseSensitive(j",
                                                    level > 0 ? level.toString() : "",
                                                    ', "',
                                                    jsonName,
                                                    '")));'
                                                );
                                            } else if (
                                                cJSON.cjsonType === "cJSON_Object" ||
                                                cJSON.cjsonType === "cJSON_Union"
                                            ) {
                                                this.emitLine(
                                                    "x",
                                                    level > 0 ? level.toString() : "",
                                                    "->",
                                                    name,
                                                    " = ",
                                                    cJSON.getValue,
                                                    "(cJSON_GetObjectItemCaseSensitive(j",
                                                    level > 0 ? level.toString() : "",
                                                    ', "',
                                                    jsonName,
                                                    '"));'
                                                );
                                            } else {
                                                if (property.isOptional || cJSON.isNullable) {
                                                    this.emitBlock(
                                                        [
                                                            "if (NULL != (x",
                                                            level > 0 ? level.toString() : "",
                                                            "->",
                                                            name,
                                                            " = cJSON_malloc(sizeof(",
                                                            cJSON.cType,
                                                            "))))"
                                                        ],
                                                        () => {
                                                            this.emitLine(
                                                                "*x",
                                                                level > 0 ? level.toString() : "",
                                                                "->",
                                                                name,
                                                                " = ",
                                                                cJSON.getValue,
                                                                "(cJSON_GetObjectItemCaseSensitive(j",
                                                                level > 0 ? level.toString() : "",
                                                                ', "',
                                                                jsonName,
                                                                '"));'
                                                            );
                                                        }
                                                    );
                                                } else {
                                                    this.emitLine(
                                                        "x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        " = ",
                                                        cJSON.getValue,
                                                        "(cJSON_GetObjectItemCaseSensitive(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '"));'
                                                    );
                                                }
                                            }
                                        }
                                    );
                                    if (!property.isOptional && !cJSON.isNullable) {
                                        if (cJSON.cjsonType === "cJSON_Array") {
                                            this.emitBlock(["else"], () => {
                                                this.emitLine(
                                                    "x",
                                                    level > 0 ? level.toString() : "",
                                                    "->",
                                                    name,
                                                    " = list_create(false, NULL);"
                                                );
                                            });
                                        } else if (cJSON.cjsonType === "cJSON_Map") {
                                            this.emitBlock(["else"], () => {
                                                this.emitLine(
                                                    "x",
                                                    level > 0 ? level.toString() : "",
                                                    "->",
                                                    name,
                                                    " = hashtable_create(",
                                                    this.hashtableSize,
                                                    ", false);"
                                                );
                                            });
                                        } else if (
                                            cJSON.cjsonType === "cJSON_Invalid" ||
                                            cJSON.cjsonType === "cJSON_NULL"
                                        ) {
                                            this.emitBlock(["else"], () => {
                                                this.emitLine(
                                                    "x",
                                                    level > 0 ? level.toString() : "",
                                                    "->",
                                                    name,
                                                    " = (",
                                                    cJSON.cType,
                                                    " *)0xDEADBEEF;"
                                                );
                                            });
                                        } else if (cJSON.cjsonType === "cJSON_String") {
                                            this.emitBlock(["else"], () => {
                                                this.emitBlock(
                                                    [
                                                        "if (NULL != (x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        " = cJSON_malloc(sizeof(",
                                                        cJSON.cType,
                                                        "))))"
                                                    ],
                                                    () => {
                                                        this.emitLine(
                                                            "x",
                                                            level > 0 ? level.toString() : "",
                                                            "->",
                                                            name,
                                                            "[0] = '\\0';"
                                                        );
                                                    }
                                                );
                                            });
                                        } else {
                                            /* Nothing to do */
                                        }
                                    }
                                });
                            }
                        };
                        recur(classType, 0);
                    });
                });
                this.emitLine("return x;");
            }
        );
        this.ensureBlankLine();

        /* Create className to cJSON generator function */
        this.emitBlock(
            ["cJSON * cJSON_Create", className, "(", this.withConst(["struct ", className]), " * x)"],
            () => {
                this.emitLine("cJSON * j = NULL;");
                this.emitBlock(["if (NULL != x)"], () => {
                    this.emitBlock(["if (NULL != (j = cJSON_CreateObject()))"], () => {
                        const recur = (type: Type, level: number) => {
                            if (type instanceof ArrayType) {
                                const child_level = level + 1;
                                const cJSON = this.quicktypeTypeToCJSON(type.items, false);
                                this.emitLine("cJSON * j", child_level.toString(), " = cJSON_CreateArray();");
                                this.emitBlock(["if (NULL != j", child_level.toString(), ")"], () => {
                                    this.emitLine(
                                        cJSON.cType,
                                        " * x",
                                        child_level.toString(),
                                        " = list_get_head(x",
                                        level.toString(),
                                        ");"
                                    );
                                    this.emitBlock(["while (NULL != x", child_level.toString(), ")"], () => {
                                        if (cJSON.cjsonType === "cJSON_Array") {
                                            const child_level2 = child_level + 1;
                                            recur(type.items, child_level);
                                            this.emitLine(
                                                "cJSON_AddItemToArray(j",
                                                child_level.toString(),
                                                ", j",
                                                child_level2.toString(),
                                                ");"
                                            );
                                        } else if (cJSON.cjsonType === "cJSON_Map") {
                                            /* Not supported */
                                        } else if (cJSON.cjsonType === "cJSON_Invalid") {
                                            /* Nothing to do */
                                        } else if (cJSON.cjsonType === "cJSON_NULL") {
                                            this.emitLine(
                                                "cJSON_AddItemToArray(j",
                                                child_level.toString(),
                                                ", ",
                                                cJSON.createObject,
                                                "());"
                                            );
                                        } else if (
                                            cJSON.cjsonType === "cJSON_String" ||
                                            cJSON.cjsonType === "cJSON_Object" ||
                                            cJSON.cjsonType === "cJSON_Union"
                                        ) {
                                            this.emitLine(
                                                "cJSON_AddItemToArray(j",
                                                child_level.toString(),
                                                ", ",
                                                cJSON.createObject,
                                                "(x",
                                                child_level.toString(),
                                                "));"
                                            );
                                        } else {
                                            this.emitLine(
                                                "cJSON_AddItemToArray(j",
                                                child_level.toString(),
                                                ", ",
                                                cJSON.createObject,
                                                "(*x",
                                                child_level.toString(),
                                                "));"
                                            );
                                        }
                                        this.emitLine(
                                            "x",
                                            child_level.toString(),
                                            " = list_get_next(x",
                                            level.toString(),
                                            ");"
                                        );
                                    });
                                });
                            } else if (type instanceof ClassType) {
                                this.forEachClassProperty(type, "none", (name, jsonName, property) => {
                                    const cJSON = this.quicktypeTypeToCJSON(property.type, property.isOptional);
                                    if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                                        const child_level = level + 1;
                                        this.emitBlock(
                                            ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                            () => {
                                                this.emitLine(
                                                    "cJSON * j",
                                                    child_level.toString(),
                                                    " = cJSON_AddArrayToObject(j",
                                                    level > 0 ? level.toString() : "",
                                                    ', "',
                                                    jsonName,
                                                    '");'
                                                );
                                                this.emitBlock(["if (NULL != j", child_level.toString(), ")"], () => {
                                                    this.emitLine(
                                                        cJSON.items!.cType,
                                                        " * x",
                                                        child_level.toString(),
                                                        " = list_get_head(x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        ");"
                                                    );
                                                    this.emitBlock(
                                                        ["while (NULL != x", child_level.toString(), ")"],
                                                        () => {
                                                            const add = (
                                                                type: Type,
                                                                cJSON: TypeCJSON,
                                                                child_level: number
                                                            ) => {
                                                                if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                                    if (type instanceof ArrayType) {
                                                                        const child_level2 = child_level + 1;
                                                                        recur(type.items, child_level);
                                                                        this.emitLine(
                                                                            "cJSON_AddItemToArray(j",
                                                                            child_level.toString(),
                                                                            ", j",
                                                                            child_level2.toString(),
                                                                            ");"
                                                                        );
                                                                    } else {
                                                                        panic("Invalid type");
                                                                    }
                                                                } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                                    /* Not supported */
                                                                } else if (cJSON.items!.cjsonType === "cJSON_Invalid") {
                                                                    /* Nothing to do */
                                                                } else if (cJSON.items!.cjsonType === "cJSON_NULL") {
                                                                    this.emitLine(
                                                                        "cJSON_AddItemToArray(j",
                                                                        child_level.toString(),
                                                                        ", ",
                                                                        cJSON.items!.createObject,
                                                                        "());"
                                                                    );
                                                                } else if (
                                                                    cJSON.items!.cjsonType === "cJSON_String" ||
                                                                    cJSON.items!.cjsonType === "cJSON_Object" ||
                                                                    cJSON.items!.cjsonType === "cJSON_Union"
                                                                ) {
                                                                    this.emitLine(
                                                                        "cJSON_AddItemToArray(j",
                                                                        child_level.toString(),
                                                                        ", ",
                                                                        cJSON.items!.createObject,
                                                                        "(x",
                                                                        child_level.toString(),
                                                                        "));"
                                                                    );
                                                                } else {
                                                                    this.emitLine(
                                                                        "cJSON_AddItemToArray(j",
                                                                        child_level.toString(),
                                                                        ", ",
                                                                        cJSON.items!.createObject,
                                                                        "(*x",
                                                                        child_level.toString(),
                                                                        "));"
                                                                    );
                                                                }
                                                            };
                                                            if (cJSON.items!.isNullable) {
                                                                this.emitBlock(
                                                                    [
                                                                        "if ((void *)0xDEADBEEF != x",
                                                                        child_level.toString(),
                                                                        ")"
                                                                    ],
                                                                    () => {
                                                                        add(property.type, cJSON, child_level);
                                                                    }
                                                                );
                                                                this.emitBlock(["else"], () => {
                                                                    this.emitLine(
                                                                        "cJSON_AddItemToArray(j",
                                                                        child_level.toString(),
                                                                        ", cJSON_CreateNull());"
                                                                    );
                                                                });
                                                            } else {
                                                                add(property.type, cJSON, child_level);
                                                            }
                                                            this.emitLine(
                                                                "x",
                                                                child_level.toString(),
                                                                " = list_get_next(x",
                                                                level > 0 ? level.toString() : "",
                                                                "->",
                                                                name,
                                                                ");"
                                                            );
                                                        }
                                                    );
                                                });
                                            }
                                        );
                                    } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                                        const child_level = level + 1;
                                        this.emitBlock(
                                            ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                            () => {
                                                this.emitLine(
                                                    "cJSON * j",
                                                    child_level.toString(),
                                                    " = ",
                                                    cJSON.createObject,
                                                    "();"
                                                );
                                                this.emitBlock(["if (NULL != j", child_level.toString(), ")"], () => {
                                                    this.emitLine("char **keys", child_level.toString(), " = NULL;");
                                                    this.emitLine(
                                                        "size_t count",
                                                        child_level.toString(),
                                                        " = hashtable_get_keys(x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        ", &keys",
                                                        child_level.toString(),
                                                        ");"
                                                    );
                                                    this.emitBlock(
                                                        ["if (NULL != keys", child_level.toString(), ")"],
                                                        () => {
                                                            this.emitBlock(
                                                                [
                                                                    "for (size_t index",
                                                                    child_level.toString(),
                                                                    " = 0; index",
                                                                    child_level.toString(),
                                                                    " < count",
                                                                    child_level.toString(),
                                                                    "; index",
                                                                    child_level.toString(),
                                                                    "++)"
                                                                ],
                                                                () => {
                                                                    this.emitLine(
                                                                        cJSON.items!.cType,
                                                                        " *x",
                                                                        child_level.toString(),
                                                                        " = hashtable_lookup(x",
                                                                        level > 0 ? level.toString() : "",
                                                                        "->",
                                                                        name,
                                                                        ", keys",
                                                                        child_level.toString(),
                                                                        "[index",
                                                                        child_level.toString(),
                                                                        "]);"
                                                                    );
                                                                    const add = (
                                                                        type: Type,
                                                                        cJSON: TypeCJSON,
                                                                        child_level: number
                                                                    ) => {
                                                                        if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                                            if (type instanceof MapType) {
                                                                                const child_level2 = child_level + 1;
                                                                                recur(type.values, child_level);
                                                                                this.emitLine(
                                                                                    cJSON.addToObject,
                                                                                    "(j",
                                                                                    child_level.toString(),
                                                                                    ", keys",
                                                                                    child_level.toString(),
                                                                                    "[index",
                                                                                    child_level.toString(),
                                                                                    "], j",
                                                                                    child_level2.toString(),
                                                                                    ");"
                                                                                );
                                                                            } else {
                                                                                panic("Invalid type");
                                                                            }
                                                                        } else if (
                                                                            cJSON.items!.cjsonType === "cJSON_Map"
                                                                        ) {
                                                                            /* Not supported */
                                                                        } else if (
                                                                            cJSON.items!.cjsonType === "cJSON_Invalid"
                                                                        ) {
                                                                            /* Nothing to do */
                                                                        } else if (
                                                                            cJSON.items!.cjsonType === "cJSON_NULL"
                                                                        ) {
                                                                            this.emitLine(
                                                                                cJSON.addToObject,
                                                                                "(j",
                                                                                child_level.toString(),
                                                                                ", keys",
                                                                                child_level.toString(),
                                                                                "[index",
                                                                                child_level.toString(),
                                                                                "], ",
                                                                                cJSON.items!.createObject,
                                                                                "());"
                                                                            );
                                                                        } else if (
                                                                            cJSON.items!.cjsonType === "cJSON_String" ||
                                                                            cJSON.items!.cjsonType === "cJSON_Object" ||
                                                                            cJSON.items!.cjsonType === "cJSON_Union"
                                                                        ) {
                                                                            this.emitLine(
                                                                                cJSON.addToObject,
                                                                                "(j",
                                                                                child_level.toString(),
                                                                                ", keys",
                                                                                child_level.toString(),
                                                                                "[index",
                                                                                child_level.toString(),
                                                                                "], ",
                                                                                cJSON.items!.createObject,
                                                                                "(x",
                                                                                child_level.toString(),
                                                                                "));"
                                                                            );
                                                                        } else {
                                                                            this.emitLine(
                                                                                cJSON.addToObject,
                                                                                "(j",
                                                                                child_level.toString(),
                                                                                ", keys",
                                                                                child_level.toString(),
                                                                                "[index",
                                                                                child_level.toString(),
                                                                                "], ",
                                                                                cJSON.items!.createObject,
                                                                                "(*x",
                                                                                child_level.toString(),
                                                                                "));"
                                                                            );
                                                                        }
                                                                    };
                                                                    if (cJSON.items!.isNullable) {
                                                                        this.emitBlock(
                                                                            [
                                                                                "if ((void *)0xDEADBEEF != x",
                                                                                child_level.toString(),
                                                                                ")"
                                                                            ],
                                                                            () => {
                                                                                add(property.type, cJSON, child_level);
                                                                            }
                                                                        );
                                                                        this.emitBlock(["else"], () => {
                                                                            this.emitLine(
                                                                                cJSON.addToObject,
                                                                                "(j",
                                                                                child_level.toString(),
                                                                                ", keys",
                                                                                child_level.toString(),
                                                                                "[index",
                                                                                child_level.toString(),
                                                                                "], cJSON_CreateNull());"
                                                                            );
                                                                        });
                                                                    } else {
                                                                        add(property.type, cJSON, child_level);
                                                                    }
                                                                }
                                                            );
                                                            this.emitLine(
                                                                "cJSON_free(keys",
                                                                child_level.toString(),
                                                                ");"
                                                            );
                                                        }
                                                    );
                                                    this.emitLine(
                                                        cJSON.addToObject,
                                                        "(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '", j',
                                                        child_level.toString(),
                                                        ");"
                                                    );
                                                });
                                            }
                                        );
                                    } else if (cJSON.cjsonType === "cJSON_Invalid") {
                                        /* Nothing to do */
                                    } else if (cJSON.cjsonType === "cJSON_NULL") {
                                        if (property.isOptional) {
                                            this.emitBlock(
                                                ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                                () => {
                                                    this.emitLine(
                                                        cJSON.addToObject,
                                                        "(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '");'
                                                    );
                                                }
                                            );
                                        } else {
                                            this.emitLine(
                                                cJSON.addToObject,
                                                "(j",
                                                level > 0 ? level.toString() : "",
                                                ', "',
                                                jsonName,
                                                '");'
                                            );
                                        }
                                    } else if (cJSON.cjsonType === "cJSON_String") {
                                        this.emitBlock(
                                            ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                            () => {
                                                this.emitLine(
                                                    cJSON.addToObject,
                                                    "(j",
                                                    level > 0 ? level.toString() : "",
                                                    ', "',
                                                    jsonName,
                                                    '", x',
                                                    level > 0 ? level.toString() : "",
                                                    "->",
                                                    name,
                                                    ");"
                                                );
                                            }
                                        );
                                        if (!property.isOptional && !cJSON.isNullable) {
                                            this.emitBlock(["else"], () => {
                                                this.emitLine(
                                                    cJSON.addToObject,
                                                    "(j",
                                                    level > 0 ? level.toString() : "",
                                                    ', "',
                                                    jsonName,
                                                    '", "");'
                                                );
                                            });
                                        }
                                    } else if (
                                        cJSON.cjsonType === "cJSON_Object" ||
                                        cJSON.cjsonType === "cJSON_Union"
                                    ) {
                                        if (property.isOptional || cJSON.isNullable) {
                                            this.emitBlock(
                                                ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                                () => {
                                                    this.emitLine(
                                                        cJSON.addToObject,
                                                        "(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '", ',
                                                        cJSON.createObject,
                                                        "(x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        "));"
                                                    );
                                                }
                                            );
                                        } else {
                                            this.emitLine(
                                                cJSON.addToObject,
                                                "(j",
                                                level > 0 ? level.toString() : "",
                                                ', "',
                                                jsonName,
                                                '", ',
                                                cJSON.createObject,
                                                "(x",
                                                level > 0 ? level.toString() : "",
                                                "->",
                                                name,
                                                "));"
                                            );
                                        }
                                    } else if (cJSON.cjsonType === "cJSON_Enum") {
                                        if (property.isOptional || cJSON.isNullable) {
                                            this.emitBlock(
                                                ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                                () => {
                                                    this.emitLine(
                                                        cJSON.addToObject,
                                                        "(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '", ',
                                                        cJSON.createObject,
                                                        "(*x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        "));"
                                                    );
                                                }
                                            );
                                        } else {
                                            this.emitLine(
                                                cJSON.addToObject,
                                                "(j",
                                                level > 0 ? level.toString() : "",
                                                ', "',
                                                jsonName,
                                                '", ',
                                                cJSON.createObject,
                                                "(x",
                                                level > 0 ? level.toString() : "",
                                                "->",
                                                name,
                                                "));"
                                            );
                                        }
                                    } else {
                                        if (property.isOptional || cJSON.isNullable) {
                                            this.emitBlock(
                                                ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                                () => {
                                                    this.emitLine(
                                                        cJSON.addToObject,
                                                        "(j",
                                                        level > 0 ? level.toString() : "",
                                                        ', "',
                                                        jsonName,
                                                        '", *x',
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        ");"
                                                    );
                                                }
                                            );
                                        } else {
                                            this.emitLine(
                                                cJSON.addToObject,
                                                "(j",
                                                level > 0 ? level.toString() : "",
                                                ', "',
                                                jsonName,
                                                '", x',
                                                level > 0 ? level.toString() : "",
                                                "->",
                                                name,
                                                ");"
                                            );
                                        }
                                    }
                                    if (cJSON.isNullable) {
                                        this.emitBlock(["else"], () => {
                                            this.emitLine(
                                                "cJSON_AddNullToObject(j",
                                                level > 0 ? level.toString() : "",
                                                ', "',
                                                jsonName,
                                                '");'
                                            );
                                        });
                                    }
                                });
                            }
                        };
                        recur(classType, 0);
                    });
                });
                this.emitLine("return j;");
            }
        );
        this.ensureBlankLine();

        /* Create className to string generator function */
        this.emitBlock(["char * cJSON_Print", className, "(", this.withConst(["struct ", className]), " * x)"], () => {
            this.emitLine("char * s = NULL;");
            this.emitBlock(["if (NULL != x)"], () => {
                this.emitLine("cJSON * j = cJSON_Create", className, "(x);");
                this.emitBlock(["if (NULL != j)"], () => {
                    this.emitLine(this._options.printStyle ? "s = cJSON_PrintUnformatted(j);" : "s = cJSON_Print(j);");
                    this.emitLine("cJSON_Delete(j);");
                });
            });
            this.emitLine("return s;");
        });
        this.ensureBlankLine();

        /* Create className delete function */
        this.emitBlock(["void cJSON_Delete", className, "(struct ", className, " * x)"], () => {
            this.emitBlock(["if (NULL != x)"], () => {
                const recur = (type: Type, level: number) => {
                    if (type instanceof ArrayType) {
                        const child_level = level + 1;
                        const cJSON = this.quicktypeTypeToCJSON(type.items, false);
                        this.emitLine(
                            cJSON.cType,
                            " * x",
                            child_level.toString(),
                            " = list_get_head(x",
                            level.toString(),
                            ");"
                        );
                        this.emitBlock(["while (NULL != x", child_level.toString(), ")"], () => {
                            if (cJSON.cjsonType === "cJSON_Array") {
                                recur(type.items, child_level);
                                this.emitLine(cJSON.deleteType, "(x", child_level.toString(), ");");
                            } else if (cJSON.cjsonType === "cJSON_Map") {
                                /* Not supported */
                            } else if (cJSON.cjsonType === "cJSON_Invalid" || cJSON.cjsonType === "cJSON_NULL") {
                                /* Nothing to do */
                            } else {
                                this.emitLine(cJSON.deleteType, "(x", child_level.toString(), ");");
                            }
                            this.emitLine("x", child_level.toString(), " = list_get_next(x", level.toString(), ");");
                        });
                    } else if (type instanceof ClassType) {
                        this.forEachClassProperty(type, "none", (name, _jsonName, property) => {
                            const cJSON = this.quicktypeTypeToCJSON(property.type, property.isOptional);
                            if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                                const child_level = level + 1;
                                this.emitBlock(
                                    ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                    () => {
                                        this.emitLine(
                                            cJSON.items!.cType,
                                            " * x",
                                            child_level.toString(),
                                            " = list_get_head(x",
                                            level > 0 ? level.toString() : "",
                                            "->",
                                            name,
                                            ");"
                                        );
                                        this.emitBlock(["while (NULL != x", child_level.toString(), ")"], () => {
                                            if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                if (property.type instanceof ArrayType) {
                                                    recur(property.type.items, child_level);
                                                    this.emitLine(
                                                        cJSON.items!.deleteType,
                                                        "(x",
                                                        child_level.toString(),
                                                        ");"
                                                    );
                                                } else {
                                                    panic("Invalid type");
                                                }
                                            } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                /* Not supported */
                                            } else if (
                                                cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                                cJSON.items!.cjsonType === "cJSON_NULL"
                                            ) {
                                                /* Nothing to do */
                                            } else {
                                                if (cJSON.items!.isNullable) {
                                                    this.emitBlock(
                                                        ["if ((void *)0xDEADBEEF != x", child_level.toString(), ")"],
                                                        () => {
                                                            this.emitLine(
                                                                cJSON.items!.deleteType,
                                                                "(x",
                                                                child_level.toString(),
                                                                ");"
                                                            );
                                                        }
                                                    );
                                                } else {
                                                    this.emitLine(
                                                        cJSON.items!.deleteType,
                                                        "(x",
                                                        child_level.toString(),
                                                        ");"
                                                    );
                                                }
                                            }
                                            this.emitLine(
                                                "x",
                                                child_level.toString(),
                                                " = list_get_next(x",
                                                level > 0 ? level.toString() : "",
                                                "->",
                                                name,
                                                ");"
                                            );
                                        });
                                        this.emitLine(
                                            cJSON.deleteType,
                                            "(x",
                                            level > 0 ? level.toString() : "",
                                            "->",
                                            name,
                                            ");"
                                        );
                                    }
                                );
                            } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                                const child_level = level + 1;
                                this.emitBlock(
                                    ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                    () => {
                                        this.emitLine("char **keys", child_level.toString(), " = NULL;");
                                        this.emitLine(
                                            "size_t count",
                                            child_level.toString(),
                                            " = hashtable_get_keys(x",
                                            level > 0 ? level.toString() : "",
                                            "->",
                                            name,
                                            ", &keys",
                                            child_level.toString(),
                                            ");"
                                        );
                                        this.emitBlock(["if (NULL != keys", child_level.toString(), ")"], () => {
                                            this.emitBlock(
                                                [
                                                    "for (size_t index",
                                                    child_level.toString(),
                                                    " = 0; index",
                                                    child_level.toString(),
                                                    " < count",
                                                    child_level.toString(),
                                                    "; index",
                                                    child_level.toString(),
                                                    "++)"
                                                ],
                                                () => {
                                                    this.emitLine(
                                                        cJSON.items!.cType,
                                                        " *x",
                                                        child_level.toString(),
                                                        " = hashtable_lookup(x",
                                                        level > 0 ? level.toString() : "",
                                                        "->",
                                                        name,
                                                        ", keys",
                                                        child_level.toString(),
                                                        "[index",
                                                        child_level.toString(),
                                                        "]);"
                                                    );
                                                    this.emitBlock(
                                                        ["if (NULL != x", child_level.toString(), ")"],
                                                        () => {
                                                            if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                                if (property.type instanceof MapType) {
                                                                    recur(property.type.values, child_level);
                                                                    this.emitLine(
                                                                        cJSON.items!.deleteType,
                                                                        "(x",
                                                                        child_level.toString(),
                                                                        ");"
                                                                    );
                                                                } else {
                                                                    panic("Invalid type");
                                                                }
                                                            } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                                /* Not supported */
                                                            } else if (
                                                                cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                                                cJSON.items!.cjsonType === "cJSON_NULL"
                                                            ) {
                                                                /* Nothing to do */
                                                            } else {
                                                                if (cJSON.items!.isNullable) {
                                                                    this.emitBlock(
                                                                        [
                                                                            "if ((void *)0xDEADBEEF != x",
                                                                            child_level.toString(),
                                                                            ")"
                                                                        ],
                                                                        () => {
                                                                            this.emitLine(
                                                                                cJSON.items!.deleteType,
                                                                                "(x",
                                                                                child_level.toString(),
                                                                                ");"
                                                                            );
                                                                        }
                                                                    );
                                                                } else {
                                                                    this.emitLine(
                                                                        cJSON.items!.deleteType,
                                                                        "(x",
                                                                        child_level.toString(),
                                                                        ");"
                                                                    );
                                                                }
                                                            }
                                                        }
                                                    );
                                                }
                                            );
                                            this.emitLine("cJSON_free(keys", child_level.toString(), ");");
                                        });
                                        this.emitLine(
                                            cJSON.deleteType,
                                            "(x",
                                            level > 0 ? level.toString() : "",
                                            "->",
                                            name,
                                            ");"
                                        );
                                    }
                                );
                            } else if (cJSON.cjsonType === "cJSON_Invalid" || cJSON.cjsonType === "cJSON_NULL") {
                                /* Nothing to do */
                            } else if (
                                cJSON.cjsonType === "cJSON_String" ||
                                cJSON.cjsonType === "cJSON_Object" ||
                                cJSON.cjsonType === "cJSON_Union"
                            ) {
                                this.emitBlock(
                                    ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                    () => {
                                        this.emitLine(
                                            cJSON.deleteType,
                                            "(x",
                                            level > 0 ? level.toString() : "",
                                            "->",
                                            name,
                                            ");"
                                        );
                                    }
                                );
                            } else {
                                if (property.isOptional || cJSON.isNullable) {
                                    this.emitBlock(
                                        ["if (NULL != x", level > 0 ? level.toString() : "", "->", name, ")"],
                                        () => {
                                            this.emitLine(
                                                cJSON.deleteType,
                                                "(x",
                                                level > 0 ? level.toString() : "",
                                                "->",
                                                name,
                                                ");"
                                            );
                                        }
                                    );
                                }
                            }
                        });
                    }
                };
                recur(classType, 0);
                this.emitLine("cJSON_free(x);");
            });
        });
        this.ensureBlankLine();
    }

    /**
     * Function called to create a top level header files with types and generators
     * @param type: type of the top level element
     * @param className: top level class name
     * @param includes: Array of includes
     */
    protected emitTopLevel(type: Type, className: Name, includes: string[]): void {
        /* Create file */
        const filename = this.sourcelikeToString(className).concat(".h");
        this.startFile(filename);

        /* Create includes - This create too much includes but this is safer because of specific corner cases */
        includes.forEach(name => {
            this.emitIncludeLine(name);
        });
        this.ensureBlankLine();

        /* Create types */
        this.emitTopLevelTypedef(type, className);

        /* Create prototypes */
        this.emitTopLevelPrototypes(type, className);

        /* Create functions */
        this.emitTopLevelFunctions(type, className);

        /* Close file */
        this.finishFile();
    }

    /**
     * Function called to create top level typedef
     * @param type: type of the top level element
     * @param className: top level class name
     */
    protected emitTopLevelTypedef(type: Type, className: Name): void {
        this.emitBlock(
            ["struct ", className],
            () => {
                const cJSON = this.quicktypeTypeToCJSON(type, false);
                this.emitLine(
                    cJSON.cType,
                    cJSON.optionalQualifier !== "" ? " " : "",
                    cJSON.optionalQualifier,
                    " value;"
                );
            },
            "",
            true
        );
        this.ensureBlankLine();
        this.emitTypdefAlias(type, className);
    }

    /**
     * Function called to create top level prototypes
     * @param type: type of the top level element
     * @param className: top level class name
     */
    protected emitTopLevelPrototypes(_type: Type, className: Name): void {
        this.emitLine("struct ", className, " * cJSON_Parse", className, "(", this.withConst("char"), " * s);");
        this.emitLine("struct ", className, " * cJSON_Get", className, "Value(", this.withConst("cJSON"), " * j);");
        this.emitLine("cJSON * cJSON_Create", className, "(", this.withConst(["struct ", className]), " * x);");
        this.emitLine("char * cJSON_Print", className, "(", this.withConst(["struct ", className]), " * x);");
        this.emitLine("void cJSON_Delete", className, "(struct ", className, " * x);");
        this.ensureBlankLine();
    }

    /**
     * Function called to create top level functions
     * @param type: type of the top level element
     * @param className: top level class name
     */
    protected emitTopLevelFunctions(type: Type, className: Name): void {
        /* Create string to className generator function */
        this.emitBlock(
            ["struct ", className, " * cJSON_Parse", className, "(", this.withConst("char"), " * s)"],
            () => {
                this.emitLine("struct ", className, " * x = NULL;");
                this.emitBlock(["if (NULL != s)"], () => {
                    this.emitLine("cJSON * j = cJSON_Parse(s);");
                    this.emitBlock(["if (NULL != j)"], () => {
                        this.emitLine("x = cJSON_Get", className, "Value(j);");
                        this.emitLine("cJSON_Delete(j);");
                    });
                });
                this.emitLine("return x;");
            }
        );
        this.ensureBlankLine();

        /* Create cJSON to className generator function */
        this.emitBlock(
            ["struct ", className, " * cJSON_Get", className, "Value(", this.withConst("cJSON"), " * j)"],
            () => {
                this.emitLine("struct ", className, " * x = NULL;");
                this.emitBlock(["if (NULL != j)"], () => {
                    this.emitBlock(["if (NULL != (x = cJSON_malloc(sizeof(struct ", className, "))))"], () => {
                        this.emitLine("memset(x, 0, sizeof(struct ", className, "));");
                        const cJSON = this.quicktypeTypeToCJSON(type, false);
                        if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                            this.emitLine("x->value = list_create(false, NULL);");
                            this.emitBlock(["if (NULL != x->value)"], () => {
                                this.emitLine("cJSON * e = NULL;");
                                this.emitBlock(["cJSON_ArrayForEach(e, j)"], () => {
                                    const add = (cJSON: TypeCJSON) => {
                                        if (cJSON.items!.cjsonType === "cJSON_Array") {
                                            /* Not supported */
                                        } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                            /* Not supported */
                                        } else if (
                                            cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                            cJSON.items!.cjsonType === "cJSON_NULL"
                                        ) {
                                            this.emitLine(
                                                "list_add_tail(x->value, (",
                                                cJSON.items!.cType,
                                                " *)0xDEADBEAF, sizeof(",
                                                cJSON.items!.cType,
                                                " *));"
                                            );
                                        } else if (cJSON.items!.cjsonType === "cJSON_String") {
                                            this.emitLine(
                                                "list_add_tail(x->value, strdup(",
                                                cJSON.items!.getValue,
                                                "(e)), sizeof(",
                                                cJSON.items!.cType,
                                                " *));"
                                            );
                                        } else {
                                            this.emitLine(
                                                "list_add_tail(x->value, ",
                                                cJSON.items!.getValue,
                                                "(e), sizeof(",
                                                cJSON.items!.cType,
                                                " *));"
                                            );
                                        }
                                    };
                                    if (cJSON.items!.isNullable) {
                                        this.emitBlock(["if (!cJSON_IsNull(e))"], () => {
                                            add(cJSON);
                                        });
                                        this.emitBlock(["else"], () => {
                                            this.emitLine(
                                                "list_add_tail(x->value, (void *)0xDEADBEEF, sizeof(void *));"
                                            );
                                        });
                                    } else {
                                        add(cJSON);
                                    }
                                });
                            });
                        } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                            this.emitLine("x->value = hashtable_create(", this.hashtableSize, ", false);");
                            this.emitBlock(["if (NULL != x->value)"], () => {
                                this.emitLine("cJSON * e = NULL;");
                                this.emitBlock(["cJSON_ArrayForEach(e, j)"], () => {
                                    const add = (cJSON: TypeCJSON) => {
                                        if (cJSON.items!.cjsonType === "cJSON_Array") {
                                            /* Not supported */
                                        } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                            /* Not supported */
                                        } else if (
                                            cJSON.items!.cjsonType === "cJSON_Invalid" ||
                                            cJSON.items!.cjsonType === "cJSON_NULL"
                                        ) {
                                            this.emitLine(
                                                "hashtable_add(x->value, e->string, (",
                                                cJSON.items!.cType,
                                                " *)0xDEADBEEF, sizeof(",
                                                cJSON.items!.cType,
                                                " *));"
                                            );
                                        } else if (cJSON.items!.cjsonType === "cJSON_String") {
                                            this.emitLine(
                                                "hashtable_add(x->value, e->string, strdup(",
                                                cJSON.items!.getValue,
                                                "(e)), sizeof(",
                                                cJSON.items!.cType,
                                                " *));"
                                            );
                                        } else {
                                            this.emitLine(
                                                "hashtable_add(x->value, e->string, ",
                                                cJSON.items!.getValue,
                                                "(e), sizeof(",
                                                cJSON.items!.cType,
                                                " *));"
                                            );
                                        }
                                    };
                                    if (cJSON.items!.isNullable) {
                                        this.emitBlock(["if (!cJSON_IsNull(e))"], () => {
                                            add(cJSON);
                                        });
                                        this.emitBlock(["else"], () => {
                                            this.emitLine(
                                                "hashtable_add(x->value, e->string, (void *)0xDEADBEEF, sizeof(void *));"
                                            );
                                        });
                                    } else {
                                        add(cJSON);
                                    }
                                });
                            });
                        } else if (cJSON.cjsonType === "cJSON_Invalid") {
                            /* Nothing to do */
                        } else if (cJSON.cjsonType === "cJSON_NULL") {
                            this.emitLine("x->value = (", cJSON.cType, " *)0xDEADBEEF;");
                        } else if (cJSON.cjsonType === "cJSON_String") {
                            this.emitLine("x->value = strdup(", cJSON.getValue, "(j));");
                        } else {
                            this.emitLine("x->value = ", cJSON.getValue, "(j);");
                        }
                    });
                });
                this.emitLine("return x;");
            }
        );
        this.ensureBlankLine();

        /* Create className to cJSON generator function */
        this.emitBlock(
            ["cJSON * cJSON_Create", className, "(", this.withConst(["struct ", className]), " * x)"],
            () => {
                this.emitLine("cJSON * j = NULL;");
                this.emitBlock(["if (NULL != x)"], () => {
                    const cJSON = this.quicktypeTypeToCJSON(type, false);
                    if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                        this.emitBlock(["if (NULL != x->value)"], () => {
                            this.emitLine("j = ", cJSON.createObject, "();");
                            this.emitBlock(["if (NULL != j)"], () => {
                                this.emitLine(cJSON.items!.cType, " * x1 = list_get_head(x->value);");
                                this.emitBlock(["while (NULL != x1)"], () => {
                                    const add = (cJSON: TypeCJSON) => {
                                        if (cJSON.items!.cjsonType === "cJSON_Array") {
                                            /* Not supported */
                                        } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                            /* Not supported */
                                        } else if (cJSON.items!.cjsonType === "cJSON_Invalid") {
                                            /* Nothing to do */
                                        } else if (cJSON.items!.cjsonType === "cJSON_NULL") {
                                            this.emitLine(
                                                "cJSON_AddItemToArray(j, ",
                                                cJSON.items!.createObject,
                                                "());"
                                            );
                                        } else if (
                                            cJSON.items!.cjsonType === "cJSON_String" ||
                                            cJSON.items!.cjsonType === "cJSON_Object" ||
                                            cJSON.items!.cjsonType === "cJSON_Union"
                                        ) {
                                            this.emitLine(
                                                "cJSON_AddItemToArray(j, ",
                                                cJSON.items!.createObject,
                                                "(x1));"
                                            );
                                        } else {
                                            this.emitLine(
                                                "cJSON_AddItemToArray(j, ",
                                                cJSON.items!.createObject,
                                                "(*x1));"
                                            );
                                        }
                                    };
                                    if (cJSON.items!.isNullable) {
                                        this.emitBlock(["if ((void *)0xDEADBEEF != x1)"], () => {
                                            add(cJSON);
                                        });
                                        this.emitBlock(["else"], () => {
                                            this.emitLine("cJSON_AddItemToArray(j, cJSON_CreateNull());");
                                        });
                                    } else {
                                        add(cJSON);
                                    }
                                    this.emitLine("x1 = list_get_next(x->value);");
                                });
                            });
                        });
                    } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                        this.emitBlock(["if (NULL != x->value)"], () => {
                            this.emitLine("j = ", cJSON.createObject, "();");
                            this.emitBlock(["if (NULL != j)"], () => {
                                this.emitLine("char **keys = NULL;");
                                this.emitLine("size_t count = hashtable_get_keys(x->value, &keys);");
                                this.emitBlock(["if (NULL != keys)"], () => {
                                    this.emitBlock(["for (size_t index = 0; index < count; index++)"], () => {
                                        this.emitLine(
                                            cJSON.items!.cType,
                                            " *x2 = hashtable_lookup(x->value, keys[index]);"
                                        );
                                        const add = (cJSON: TypeCJSON) => {
                                            if (cJSON.items!.cjsonType === "cJSON_Array") {
                                                /* Not supported */
                                            } else if (cJSON.items!.cjsonType === "cJSON_Map") {
                                                /* Not supported */
                                            } else if (cJSON.items!.cjsonType === "cJSON_Invalid") {
                                                /* Nothing to do */
                                            } else if (cJSON.items!.cjsonType === "cJSON_NULL") {
                                                this.emitLine(
                                                    cJSON.addToObject,
                                                    "(j, keys[index], ",
                                                    cJSON.items!.createObject,
                                                    "());"
                                                );
                                            } else if (
                                                cJSON.items!.cjsonType === "cJSON_String" ||
                                                cJSON.items!.cjsonType === "cJSON_Object" ||
                                                cJSON.items!.cjsonType === "cJSON_Union"
                                            ) {
                                                this.emitLine(
                                                    cJSON.addToObject,
                                                    "(j, keys[index], ",
                                                    cJSON.items!.createObject,
                                                    "(x2));"
                                                );
                                            } else {
                                                this.emitLine(
                                                    cJSON.addToObject,
                                                    "(j, keys[index], ",
                                                    cJSON.items!.createObject,
                                                    "(*x2));"
                                                );
                                            }
                                        };
                                        if (cJSON.items!.isNullable) {
                                            this.emitBlock(["if ((void *)0xDEADBEEF != x2)"], () => {
                                                add(cJSON);
                                            });
                                            this.emitBlock(["else"], () => {
                                                this.emitLine(
                                                    cJSON.addToObject,
                                                    "(j, keys[index], cJSON_CreateNull());"
                                                );
                                            });
                                        } else {
                                            add(cJSON);
                                        }
                                    });
                                    this.emitLine("cJSON_free(keys);");
                                });
                            });
                        });
                    } else if (cJSON.cjsonType === "cJSON_Invalid") {
                        /* Nothing to do */
                    } else if (cJSON.cjsonType === "cJSON_NULL") {
                        this.emitLine("j = ", cJSON.createObject, "();");
                    } else {
                        this.emitLine("j = ", cJSON.createObject, "(x->value);");
                    }
                });
                this.emitLine("return j;");
            }
        );
        this.ensureBlankLine();

        /* Create className to string generator function */
        this.emitBlock(["char * cJSON_Print", className, "(", this.withConst(["struct ", className]), " * x)"], () => {
            this.emitLine("char * s = NULL;");
            this.emitBlock(["if (NULL != x)"], () => {
                this.emitLine("cJSON * j = cJSON_Create", className, "(x);");
                this.emitBlock(["if (NULL != j)"], () => {
                    this.emitLine("s = cJSON_Print(j);");
                    this.emitLine("cJSON_Delete(j);");
                });
            });
            this.emitLine("return s;");
        });
        this.ensureBlankLine();

        /* Create className delete function */
        this.emitBlock(["void cJSON_Delete", className, "(struct ", className, " * x)"], () => {
            this.emitBlock(["if (NULL != x)"], () => {
                const cJSON = this.quicktypeTypeToCJSON(type, false);
                if (cJSON.cjsonType === "cJSON_Array" && cJSON.items !== undefined) {
                    this.emitBlock(["if (NULL != x->value)"], () => {
                        this.emitLine(cJSON.items!.cType, " * x1 = list_get_head(x->value);");
                        this.emitBlock(["while (NULL != x1)"], () => {
                            if (cJSON.items!.isNullable) {
                                this.emitBlock(["if ((void *)0xDEADBEEF != x1)"], () => {
                                    this.emitLine(cJSON.items!.deleteType, "(x1);");
                                });
                            } else {
                                this.emitLine(cJSON.items!.deleteType, "(x1);");
                            }
                            this.emitLine("x1 = list_get_next(x->value);");
                        });
                        this.emitLine(cJSON.deleteType, "(x->value);");
                    });
                } else if (cJSON.cjsonType === "cJSON_Map" && cJSON.items !== undefined) {
                    this.emitBlock(["if (NULL != x->value)"], () => {
                        this.emitLine("char **keys = NULL;");
                        this.emitLine("size_t count = hashtable_get_keys(x->value, &keys);");
                        this.emitBlock(["if (NULL != keys)"], () => {
                            this.emitBlock(["for (size_t index = 0; index < count; index++)"], () => {
                                this.emitLine(cJSON.items!.cType, " *x2 = hashtable_lookup(x->value, keys[index]);");
                                this.emitBlock(["if (NULL != x2)"], () => {
                                    if (cJSON.items!.isNullable) {
                                        this.emitBlock(["if ((", cJSON.items!.cType, " *)0xDEADBEEF != x2)"], () => {
                                            this.emitLine(cJSON.items!.deleteType, "(x2);");
                                        });
                                    } else {
                                        this.emitLine(cJSON.items!.deleteType, "(x2);");
                                    }
                                });
                            });
                            this.emitLine("cJSON_free(keys);");
                        });
                        this.emitLine(cJSON.deleteType, "(x->value);");
                    });
                } else if (cJSON.cjsonType === "cJSON_Invalid" || cJSON.cjsonType === "cJSON_NULL") {
                    /* Nothing to do */
                } else if (
                    cJSON.cjsonType === "cJSON_String" ||
                    cJSON.cjsonType === "cJSON_Object" ||
                    cJSON.cjsonType === "cJSON_Union"
                ) {
                    this.emitLine(cJSON.deleteType, "(x->value);");
                } else {
                    /* Nothing to do */
                }
                this.emitLine("cJSON_free(x);");
            });
        });
        this.ensureBlankLine();
    }

    /**
     * Convert quicktype type to cJSON type
     * @param t: quicktype type
     * @param isOptional: true if the field is optional
     * @param isNullable: true if the field is nullable
     * @return cJSON type
     */
    protected quicktypeTypeToCJSON(t: Type, isOptional: boolean, isNullable = false): TypeCJSON {
        /* Compute cJSON type */
        return matchType<TypeCJSON>(
            t,
            _anyType => {
                return {
                    cType: "void",
                    optionalQualifier: "*",
                    cjsonType: "cJSON_Invalid",
                    isType: "cJSON_IsInvalid",
                    getValue: "",
                    addToObject: "",
                    createObject: "",
                    deleteType: "",
                    items: undefined,
                    isNullable
                };
            },
            _nullType => {
                return {
                    cType: "void",
                    optionalQualifier: "*",
                    cjsonType: "cJSON_NULL",
                    isType: "cJSON_IsNull",
                    getValue: "",
                    addToObject: "cJSON_AddNullToObject",
                    createObject: "cJSON_CreateNull",
                    deleteType: "cJSON_free",
                    items: undefined,
                    isNullable
                };
            },
            _boolType => {
                return {
                    cType: "bool",
                    optionalQualifier: isOptional === true ? "*" : "",
                    cjsonType: "cJSON_Bool",
                    isType: "cJSON_IsBool",
                    getValue: "cJSON_IsTrue",
                    addToObject: "cJSON_AddBoolToObject",
                    createObject: "cJSON_CreateBool",
                    deleteType: "cJSON_free",
                    items: undefined,
                    isNullable
                };
            },
            _integerType => {
                return {
                    cType: this.typeIntegerSize,
                    optionalQualifier: isOptional === true ? "*" : "",
                    cjsonType: "cJSON_Number",
                    isType: "cJSON_IsNumber",
                    getValue: "cJSON_GetNumberValue",
                    addToObject: "cJSON_AddNumberToObject",
                    createObject: "cJSON_CreateNumber",
                    deleteType: "cJSON_free",
                    items: undefined,
                    isNullable
                };
            },
            _doubleType => {
                return {
                    cType: "double",
                    optionalQualifier: isOptional === true ? "*" : "",
                    cjsonType: "cJSON_Number",
                    isType: "cJSON_IsNumber",
                    getValue: "cJSON_GetNumberValue",
                    addToObject: "cJSON_AddNumberToObject",
                    createObject: "cJSON_CreateNumber",
                    deleteType: "cJSON_free",
                    items: undefined,
                    isNullable
                };
            },
            _stringType => {
                return {
                    cType: "char",
                    optionalQualifier: "*",
                    cjsonType: "cJSON_String",
                    isType: "cJSON_IsString",
                    getValue: "cJSON_GetStringValue",
                    addToObject: "cJSON_AddStringToObject",
                    createObject: "cJSON_CreateString",
                    deleteType: "cJSON_free",
                    items: undefined,
                    isNullable
                };
            },
            arrayType => {
                const items = this.quicktypeTypeToCJSON(arrayType.items, false);
                return {
                    cType: "list_t",
                    optionalQualifier: "*",
                    cjsonType: "cJSON_Array",
                    isType: "cJSON_IsArray",
                    getValue: "cJSON_GetArrayItem",
                    addToObject: "cJSON_AddItemToObject",
                    createObject: "cJSON_CreateArray",
                    deleteType: "list_release",
                    items,
                    isNullable
                };
            },
            classType => {
                return {
                    cType: ["struct ", this.nameForNamedType(classType)],
                    optionalQualifier: "*",
                    cjsonType: "cJSON_Object",
                    isType: "cJSON_IsObject",
                    getValue: ["cJSON_Get", this.nameForNamedType(classType), "Value"],
                    addToObject: "cJSON_AddItemToObject",
                    createObject: ["cJSON_Create", this.nameForNamedType(classType)],
                    deleteType: ["cJSON_Delete", this.nameForNamedType(classType)],
                    items: undefined,
                    isNullable
                };
            },
            mapType => {
                const items = this.quicktypeTypeToCJSON(mapType.values, false);
                return {
                    cType: "hashtable_t",
                    optionalQualifier: "*",
                    cjsonType: "cJSON_Map",
                    isType: "cJSON_IsObject",
                    getValue: "",
                    addToObject: "cJSON_AddItemToObject",
                    createObject: "cJSON_CreateObject",
                    deleteType: "hashtable_release",
                    items,
                    isNullable
                };
            },
            enumType => {
                return {
                    cType: ["enum ", this.nameForNamedType(enumType)],
                    optionalQualifier: isOptional === true ? "*" : "",
                    cjsonType: "cJSON_Enum",
                    isType: "cJSON_IsString",
                    getValue: ["cJSON_Get", this.nameForNamedType(enumType), "Value"],
                    addToObject: "cJSON_AddItemToObject",
                    createObject: ["cJSON_Create", this.nameForNamedType(enumType)],
                    deleteType: "cJSON_free",
                    items: undefined,
                    isNullable
                };
            },
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return this.quicktypeTypeToCJSON(nullable, true, true);
                } else {
                    return {
                        cType: ["struct ", this.nameForNamedType(unionType)],
                        optionalQualifier: "*",
                        cjsonType: "cJSON_Union",
                        isType: "",
                        getValue: ["cJSON_Get", this.nameForNamedType(unionType), "Value"],
                        addToObject: "cJSON_AddItemToObject",
                        createObject: ["cJSON_Create", this.nameForNamedType(unionType)],
                        deleteType: ["cJSON_Delete", this.nameForNamedType(unionType)],
                        items: undefined,
                        isNullable
                    };
                }
            }
        );
    }

    /**
     * Function called to create a file
     * @param proposedFilename: source filename provided from stdin
     */
    protected startFile(proposedFilename: Sourcelike): void {
        /* Check if previous file is closed, create a new file */
        assert(this.currentFilename === undefined, "Previous file wasn't finished");
        if (proposedFilename !== undefined) {
            this.currentFilename = this.sourcelikeToString(proposedFilename);
        }

        /* Check if file has been created */
        if (this.currentFilename !== undefined) {
            /* Write header */
            this.emitDescriptionBlock([
                this.currentFilename,
                "This file has been autogenerated using quicktype https://github.com/quicktype/quicktype - DO NOT EDIT",
                "This file depends of https://github.com/DaveGamble/cJSON, https://github.com/joelguittet/c-list and https://github.com/joelguittet/c-hashtable",
                "To parse json data from json string use the following: struct <type> * data = cJSON_Parse<type>(<string>);",
                "To get json data from cJSON object use the following: struct <type> * data = cJSON_Get<type>Value(<cjson>);",
                "To get cJSON object from json data use the following: cJSON * cjson = cJSON_Create<type>(<data>);",
                "To print json string from json data use the following: char * string = cJSON_Print<type>(<data>);",
                "To delete json data use the following: cJSON_Delete<type>(<data>);"
            ]);
            this.ensureBlankLine();

            /* Write include guard */
            this.emitLine(
                "#ifndef __",
                allUpperWordStyle(this.currentFilename.replace(new RegExp(/[^a-zA-Z0-9]+/, "g"), "_")),
                "__"
            );
            this.emitLine(
                "#define __",
                allUpperWordStyle(this.currentFilename.replace(new RegExp(/[^a-zA-Z0-9]+/, "g"), "_")),
                "__"
            );
            this.ensureBlankLine();

            /* Write C++ guard */
            this.emitLine("#ifdef __cplusplus");
            this.emitLine('extern "C" {');
            this.emitLine("#endif");
            this.ensureBlankLine();

            /* Write includes */
            this.emitIncludeLine("stdint.h", true);
            this.emitIncludeLine("stdbool.h", true);
            this.emitIncludeLine("stdlib.h", true);
            this.emitIncludeLine("string.h", true);
            this.emitIncludeLine("cJSON.h", true);
            this.emitIncludeLine("hashtable.h", true);
            this.emitIncludeLine("list.h", true);
            this.ensureBlankLine();

            /* Additional cJSON types */
            this.emitLine("#ifndef cJSON_Bool");
            this.emitLine("#define cJSON_Bool (cJSON_True | cJSON_False)");
            this.emitLine("#endif");
            this.emitLine("#ifndef cJSON_Map");
            this.emitLine("#define cJSON_Map (1 << 16)");
            this.emitLine("#endif");
            this.emitLine("#ifndef cJSON_Enum");
            this.emitLine("#define cJSON_Enum (1 << 17)");
            this.emitLine("#endif");
            this.ensureBlankLine();
        }
    }

    /**
     * Function called to close current file
     */
    protected finishFile(): void {
        /* Check if file has been created */
        if (this.currentFilename !== undefined) {
            /* Write C++ guard */
            this.emitLine("#ifdef __cplusplus");
            this.emitLine("}");
            this.emitLine("#endif");
            this.ensureBlankLine();

            /* Write include guard */
            this.emitLine(
                "#endif /* __",
                allUpperWordStyle(this.currentFilename.replace(new RegExp(/[^a-zA-Z0-9]+/, "g"), "_")),
                "__ */"
            );
            this.ensureBlankLine();

            /* Close file */
            super.finishFile(defined(this.currentFilename));
            this.currentFilename = undefined;
        }
    }

    /**
     * Check if type need declaration before use
     * @note If returning true, canBeForwardDeclared must be declared
     * @return Always returns true
     */
    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    /**
     * Check if type can be forward declared
     * @return true for classes, false otherwise
     */
    protected canBeForwardDeclared(type: Type): boolean {
        return type.kind === "class";
    }

    /**
     * Add const to wanted Sourcelike
     * @return Const Sourcelike
     */
    protected withConst(s: Sourcelike): Sourcelike {
        return ["const ", s];
    }

    /**
     * Emit include line
     * @param name: filename to include
     * @pram global: true if global include, false otherwise (default)
     */
    protected emitIncludeLine(name: Sourcelike, global = false): void {
        this.emitLine("#include ", global ? "<" : '"', name, global ? ">" : '"');
    }

    /**
     * Emit description block
     * @param lines: description block lines
     */
    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    /**
     * Emit code block
     * @param line: code block line
     * @param f: callback function
     * @param withName: name of the block as string
     * @param withSemicolon: true to add semicolon at the end of the block, false otherwise
     * @param withIndent: true to indent the block (default), false otherwise
     */
    protected emitBlock(
        line: Sourcelike,
        f: () => void,
        withName = "",
        withSemicolon = false,
        withIndent = true
    ): void {
        this.emitLine(line, " {");
        this.preventBlankLine();
        if (withIndent) {
            this.indent(f);
        } else {
            f();
        }
        this.preventBlankLine();
        if (withSemicolon) {
            if (withName !== "") {
                this.emitLine("} ", withName, ";");
            } else {
                this.emitLine("};");
            }
        } else {
            if (withName !== "") {
                this.emitLine("} ", withName);
            } else {
                this.emitLine("}");
            }
        }
    }

    /**
     * Emit includes
     * @param type: class, union or enum type
     * @param filename: current file name
     */
    protected emitIncludes(type: ClassType | UnionType | EnumType, filename: string): void {
        /* List required includes */
        const includes: IncludeMap = new Map();
        if (type instanceof UnionType) {
            this.updateIncludes(false, includes, type);
        } else if (type instanceof ClassType) {
            this.forEachClassProperty(type, "none", (_name, _jsonName, property) => {
                this.updateIncludes(true, includes, property.type);
            });
        }

        /* Emit includes */
        if (includes.size !== 0) {
            includes.forEach((_rec: IncludeRecord, name: string) => {
                name = name.concat(".h");
                if (name !== filename) {
                    this.emitIncludeLine(name);
                }
            });
        }
        this.ensureBlankLine();
    }

    /**
     * Compute includes
     * @param isClassMender: true if class, false otherwise
     * @param includes: include map
     * @param propertyType: property type
     */
    protected updateIncludes(isClassMember: boolean, includes: IncludeMap, propertyType: Type): void {
        const propTypes = this.generatedTypes(isClassMember, propertyType);
        for (const t of propTypes) {
            const typeName = this.sourcelikeToString(t.name);
            const propRecord: IncludeRecord = { kind: undefined, typeKind: undefined };
            if (t.type instanceof ClassType) {
                /* We can NOT forward declare direct class members, e.g. a class type is included at level#0 */
                /* HOWEVER if it is not a direct class member, then we can SURELY forward declare it */
                propRecord.typeKind = "class";
                propRecord.kind = t.level === 0 ? IncludeKind.Include : IncludeKind.ForwardDeclare;
                if (t.forceInclude) {
                    propRecord.kind = IncludeKind.Include;
                }
            } else if (t.type instanceof EnumType) {
                propRecord.typeKind = "enum";
                propRecord.kind = IncludeKind.ForwardDeclare;
            } else if (t.type instanceof UnionType) {
                propRecord.typeKind = "union";
                /* Recurse into the union */
                const [maybeNull] = removeNullFromUnion(t.type, true);
                if (maybeNull !== undefined) {
                    /* Houston this is a variant, include it */
                    propRecord.kind = IncludeKind.Include;
                } else {
                    if (t.forceInclude) {
                        propRecord.kind = IncludeKind.Include;
                    } else {
                        propRecord.kind = IncludeKind.ForwardDeclare;
                    }
                }
            }
            if (includes.has(typeName)) {
                const incKind = includes.get(typeName);
                /* If we already include the type as typed include, do not write it over with forward declare */
                if (incKind !== undefined && incKind.kind === IncludeKind.ForwardDeclare) {
                    includes.set(typeName, propRecord);
                }
            } else {
                includes.set(typeName, propRecord);
            }
        }
    }

    /**
     * Compute generated types
     * @param isClassMender: true if class, false otherwise
     * @param type: type
     * @return Type record array
     */
    protected generatedTypes(isClassMember: boolean, type: Type): TypeRecord[] {
        const result: TypeRecord[] = [];
        const recur = (forceInclude: boolean, isVariant: boolean, l: number, t: Type) => {
            if (t instanceof ArrayType) {
                recur(forceInclude, isVariant, l + 1, t.items);
            } else if (t instanceof ClassType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude
                });
            } else if (t instanceof MapType) {
                recur(forceInclude, isVariant, l + 1, t.values);
            } else if (t instanceof EnumType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude: false
                });
            } else if (t instanceof UnionType) {
                /**
                 * If we have a union as a class member and we see it as a "named union",
                 * we can safely include it as-is.
                 * HOWEVER if we define a union on its own, we must recurse into the
                 * typedefinition and include all subtypes.
                 */
                if (this.unionNeedsName(t) && isClassMember) {
                    /**
                     * This is NOT ENOUGH.
                     * We have a variant member in a class, e.g. defined with a boost::variant.
                     * The compiler can only compile the class if IT KNOWS THE SIZES
                     * OF ALL MEMBERS OF THE VARIANT.
                     * So it means that you must include ALL SUBTYPES (practically classes only)
                     * AS WELL
                     */
                    forceInclude = true;
                    result.push({
                        name: this.nameForNamedType(t),
                        type: t,
                        level: l,
                        variant: true,
                        forceInclude
                    });
                    /** intentional "fall-through", add all subtypes as well - but forced include */
                }

                const [hasNull, nonNulls] = removeNullFromUnion(t);
                isVariant = hasNull !== null;
                /** we need to collect all the subtypes of the union */
                for (const tt of nonNulls) {
                    recur(forceInclude, isVariant, l + 1, tt);
                }
            }
        };
        recur(false, false, 0, type);
        return result;
    }
}
