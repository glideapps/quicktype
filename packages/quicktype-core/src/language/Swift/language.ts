import type { DateTimeRecognizer } from "../../DateTime.js";
import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
} from "../../Type/index.js";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { SwiftRenderer } from "./SwiftRenderer.js";
import { SwiftDateTimeRecognizer } from "./utils.js";

export const swiftOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    convenienceInitializers: new BooleanOption(
        "initializers",
        "Generate initializers and mutators",
        true,
    ),
    explicitCodingKeys: new BooleanOption(
        "coding-keys",
        "Explicit CodingKey values in Codable types",
        true,
    ),
    codingKeysProtocol: new StringOption(
        "coding-keys-protocol",
        "CodingKeys implements protocols",
        "protocol1, protocol2...",
        "",
        "secondary",
    ),
    alamofire: new BooleanOption("alamofire", "Alamofire extensions", false),
    namedTypePrefix: new StringOption(
        "type-prefix",
        "Prefix for type names",
        "PREFIX",
        "",
        "secondary",
    ),
    useClasses: new EnumOption(
        "struct-or-class",
        "Structs or classes",
        {
            struct: false,
            class: true,
        } as const,
        "struct",
    ),
    finalClasses: new BooleanOption(
        "final-classes",
        "Mark classes as final",
        false,
    ),
    mutableProperties: new BooleanOption(
        "mutable-properties",
        "Use var instead of let for object properties",
        false,
    ),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    dense: new EnumOption(
        "density",
        "Code density",
        {
            dense: true,
            normal: false,
        } as const,
        "normal",
        "secondary",
    ),
    linux: new BooleanOption(
        "support-linux",
        "Support Linux",
        false,
        "secondary",
    ),
    objcSupport: new BooleanOption(
        "objective-c-support",
        "Objects inherit from NSObject and @objcMembers is added to classes",
        false,
    ),
    optionalEnums: new BooleanOption(
        "optional-enums",
        "If no matching case is found enum value is set to null",
        false,
    ),
    sendable: new BooleanOption(
        "sendable",
        "Mark generated models as Sendable",
        false,
    ),
    multiFileOutput: new BooleanOption(
        "multi-file-output",
        "Renders each top-level object in its own Swift file",
        false,
    ),
    accessLevel: new EnumOption(
        "access-level",
        "Access level",
        {
            internal: "internal",
            public: "public",
        } as const,
        "internal",
        "secondary",
    ),
    protocol: new EnumOption(
        "protocol",
        "Make types implement protocol",
        {
            none: { equatable: false, hashable: false },
            equatable: { equatable: true, hashable: false },
            hashable: { equatable: false, hashable: true },
        } as const,
        "none",
        "secondary",
    ),
};

export const swiftLanguageConfig = {
    displayName: "Swift",
    names: ["swift", "swift4"],
    extension: "swift",
} as const;

export class SwiftTargetLanguage extends TargetLanguage<
    typeof swiftLanguageConfig
> {
    public constructor() {
        super(swiftLanguageConfig);
    }

    public getOptions(): typeof swiftOptions {
        return swiftOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        mapping.set("date-time", "date-time");
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer<Lang extends LanguageName = "swift">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): SwiftRenderer {
        return new SwiftRenderer(
            this,
            renderContext,
            getOptionValues(swiftOptions, untypedOptionValues),
        );
    }

    public get dateTimeRecognizer(): DateTimeRecognizer {
        return new SwiftDateTimeRecognizer();
    }
}
