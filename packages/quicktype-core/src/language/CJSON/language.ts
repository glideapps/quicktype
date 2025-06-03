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

import type { RenderContext } from "../../Renderer";
import {
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type { LanguageName, RendererOptions } from "../../types";

import { CJSONRenderer } from "./CJSONRenderer";

/* Naming styles */
const namingStyles = {
    "pascal-case": "pascal",
    "underscore-case": "underscore",
    "camel-case": "camel",
    "upper-underscore-case": "upper-underscore",
    "pascal-case-upper-acronyms": "pascal-upper-acronyms",
    "camel-case-upper-acronyms": "camel-upper-acronyms",
} as const;

/* cJSON generator options */
export const cJSONOptions = {
    typeSourceStyle: new EnumOption(
        "source-style",
        "Source code generation type, whether to generate single or multiple source files",
        {
            "single-source": true,
            "multi-source": false,
        } as const,
        "single-source",
        "secondary",
    ),
    typeIntegerSize: new EnumOption(
        "integer-size",
        "Integer code generation type (int64_t by default)",
        {
            int8_t: "int8_t",
            int16_t: "int16_t",
            int32_t: "int32_t",
            int64_t: "int64_t",
        } as const,
        "int64_t",
        "secondary",
    ),
    hashtableSize: new StringOption(
        "hashtable-size",
        "Hashtable size, used when maps are created (64 by default)",
        "SIZE",
        "64",
    ),
    addTypedefAlias: new EnumOption(
        "typedef-alias",
        "Add typedef alias to unions, structs, and enums (no typedef by default)",
        {
            "no-typedef": false,
            "add-typedef": true,
        } as const,
        "no-typedef",
        "secondary",
    ),
    printStyle: new EnumOption(
        "print-style",
        "Which cJSON print should be used (formatted by default)",
        {
            "print-formatted": false,
            "print-unformatted": true,
        } as const,
        "print-formatted",
        "secondary",
    ),
    typeNamingStyle: new EnumOption(
        "type-style",
        "Naming style for types",
        namingStyles,
        "pascal-case",
    ),
    memberNamingStyle: new EnumOption(
        "member-style",
        "Naming style for members",
        namingStyles,
        "underscore-case",
    ),
    enumeratorNamingStyle: new EnumOption(
        "enumerator-style",
        "Naming style for enumerators",
        namingStyles,
        "upper-underscore-case",
    ),
};

/* cJSON generator target language */
export const cJSONLanguageConfig = {
    displayName: "C (cJSON)",
    names: ["cjson", "cJSON"],
    extension: "h",
} as const;

export class CJSONTargetLanguage extends TargetLanguage<
    typeof cJSONLanguageConfig
> {
    public constructor() {
        super(cJSONLanguageConfig);
    }

    /**
     * Return cJSON generator options
     * @return cJSON generator options array
     */
    public getOptions(): typeof cJSONOptions {
        return cJSONOptions;
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
    protected makeRenderer<Lang extends LanguageName = "cjson">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): CJSONRenderer {
        return new CJSONRenderer(
            this,
            renderContext,
            getOptionValues(cJSONOptions, untypedOptionValues),
        );
    }
}
