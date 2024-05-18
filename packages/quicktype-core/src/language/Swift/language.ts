import { type DateTimeRecognizer } from "../../DateTime";
import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { TargetLanguage } from "../../TargetLanguage";
import { type PrimitiveStringTypeKind, type TransformedStringTypeKind } from "../../Type";
import { type StringTypeMapping } from "../../TypeBuilder";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { SwiftRenderer } from "./SwiftRenderer";
import { SwiftDateTimeRecognizer } from "./utils";

export const swiftOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    convenienceInitializers: new BooleanOption("initializers", "Generate initializers and mutators", true),
    explicitCodingKeys: new BooleanOption("coding-keys", "Explicit CodingKey values in Codable types", true),
    codingKeysProtocol: new StringOption(
        "coding-keys-protocol",
        "CodingKeys implements protocols",
        "protocol1, protocol2...",
        "",
        "secondary"
    ),
    alamofire: new BooleanOption("alamofire", "Alamofire extensions", false),
    namedTypePrefix: new StringOption("type-prefix", "Prefix for type names", "PREFIX", "", "secondary"),
    useClasses: new EnumOption("struct-or-class", "Structs or classes", [
        ["struct", false],
        ["class", true]
    ]),
    mutableProperties: new BooleanOption("mutable-properties", "Use var instead of let for object properties", false),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    dense: new EnumOption(
        "density",
        "Code density",
        [
            ["dense", true],
            ["normal", false]
        ],
        "dense",
        "secondary"
    ),
    linux: new BooleanOption("support-linux", "Support Linux", false, "secondary"),
    objcSupport: new BooleanOption(
        "objective-c-support",
        "Objects inherit from NSObject and @objcMembers is added to classes",
        false
    ),
    optionalEnums: new BooleanOption("optional-enums", "If no matching case is found enum value is set to null", false),
    swift5Support: new BooleanOption("swift-5-support", "Renders output in a Swift 5 compatible mode", false),
    sendable: new BooleanOption("sendable", "Mark generated models as Sendable", false),
    multiFileOutput: new BooleanOption(
        "multi-file-output",
        "Renders each top-level object in its own Swift file",
        false
    ),
    accessLevel: new EnumOption(
        "access-level",
        "Access level",
        [
            ["internal", "internal"],
            ["public", "public"]
        ],
        "internal",
        "secondary"
    ),
    protocol: new EnumOption(
        "protocol",
        "Make types implement protocol",
        [
            ["none", { equatable: false, hashable: false }],
            ["equatable", { equatable: true, hashable: false }],
            ["hashable", { equatable: false, hashable: true }]
        ],
        "none",
        "secondary"
    )
};

export class SwiftTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Swift", ["swift", "swift4"], "swift");
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [
            swiftOptions.justTypes,
            swiftOptions.useClasses,
            swiftOptions.dense,
            swiftOptions.convenienceInitializers,
            swiftOptions.explicitCodingKeys,
            swiftOptions.codingKeysProtocol,
            swiftOptions.accessLevel,
            swiftOptions.alamofire,
            swiftOptions.linux,
            swiftOptions.namedTypePrefix,
            swiftOptions.protocol,
            swiftOptions.acronymStyle,
            swiftOptions.objcSupport,
            swiftOptions.optionalEnums,
            swiftOptions.sendable,
            swiftOptions.swift5Support,
            swiftOptions.multiFileOutput,
            swiftOptions.mutableProperties
        ];
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        mapping.set("date-time", "date-time");
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): SwiftRenderer {
        return new SwiftRenderer(this, renderContext, getOptionValues(swiftOptions, untypedOptionValues));
    }

    public get dateTimeRecognizer(): DateTimeRecognizer {
        return new SwiftDateTimeRecognizer();
    }
}
