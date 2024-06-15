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
 * TODO list for future enhancements:
 * - Management of Class, Union and TopLevel should be mutualized to reduce code size and to permit Union and TopLevel having recursive Array/Map
 * - Types check should be added to verify unwanted inputs (for example a Number passed while a String is expected, etc)
 * - Constraints should be implemented (verification of Enum values, min/max values for Numbers and min/max length for Strings, regex)
 * - Support of pure Any type for example providing a callback from the application to handle these cases dynamically
 * See test/languages.ts for the test cases which are not implmented/checked.
 */

import { type RenderContext } from "../../Renderer";
import { EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { type NamingStyle } from "../../support/Strings";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { CJSONRenderer } from "./CJSONRenderer";

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
    ]),
    headerOnly: new EnumOption(
        "header-only",
        "Generate headers only",
        [
            ["true", true],
            ["false", false]
        ],
        "true",
        "secondary"
    )
};

/* cJSON generator target language */
export class CJSONTargetLanguage extends TargetLanguage {
    /**
     * Constructor
     * @param displayName: display name
     * @params names: names
     * @param extension: extension of files
     */
    public constructor(displayName = "C (cJSON)", names: string[] = ["cjson", "cJSON"], extension = "h") {
        super(displayName, names, extension);
    }

    /**
     * Return cJSON generator options
     * @return cJSON generator options array
     */
    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [
            cJSONOptions.typeSourceStyle,
            cJSONOptions.typeIntegerSize,
            cJSONOptions.addTypedefAlias,
            cJSONOptions.printStyle,
            cJSONOptions.hashtableSize,
            cJSONOptions.typeNamingStyle,
            cJSONOptions.memberNamingStyle,
            cJSONOptions.enumeratorNamingStyle,
            cJSONOptions.headerOnly
        ];
    }

    /**
     * Indicate if language support union with both number types
     * @return true
     */
    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    /**
     * Indicate if language support optional class properties
     * @return true
     */
    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    /**
     * Create renderer
     * @param renderContext: render context
     * @param untypedOptionValues
     * @return cJSON renderer
     */
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): CJSONRenderer {
        return new CJSONRenderer(this, renderContext, getOptionValues(cJSONOptions, untypedOptionValues));
    }
}
