export {
    type Options,
    type QuicktypeTiming,
    getTargetLanguage,
    quicktypeMultiFile,
    quicktypeMultiFileSync,
    quicktype,
    combineRenderResults,
    type RunContext,
} from "./Run.js";
export {
    inferenceFlags,
    inferenceFlagNames,
    defaultInferenceFlags,
    inferenceFlagsObject,
    type InferenceFlags,
    type InferenceFlagName,
} from "./Inference.js";
export { CompressedJSON, type Value } from "./input/CompressedJSON.js";
export {
    INT8_RANGE,
    INT16_RANGE,
    INT32_RANGE,
    INT64_RANGE,
    type IntegerRange,
    JS_SAFE_INTEGER_RANGE,
    integerStringInRange,
} from "./support/IntegerRange.js";
export {
    type Input,
    InputData,
    JSONInput,
    type JSONSourceData,
    jsonInputForTargetLanguage,
} from "./input/Inputs.js";
export {
    JSONSchemaInput,
    type JSONSchemaSourceData,
} from "./input/JSONSchemaInput.js";
export {
    Ref,
    type JSONSchemaType,
    type JSONSchemaAttributes,
} from "./input/JSONSchemaInput.js";
export type { RenderContext } from "./Renderer.js";
export {
    Option,
    type OptionDefinition,
    getOptionValues,
    type OptionValues,
} from "./RendererOptions/index.js";
export {
    TargetLanguage,
    type MultiFileRenderResult,
} from "./TargetLanguage.js";

export {
    type MultiWord,
    type Sourcelike,
    type SerializedRenderResult,
    type Annotation,
    modifySource,
    singleWord,
    parenIfNeeded,
} from "./Source.js";
export { Name, funPrefixNamer, Namer } from "./Naming.js";
export { IssueAnnotationData } from "./Annotation.js";
export {
    panic,
    assert,
    defined,
    assertNever,
    checkStringMap,
    checkArray,
} from "./support/Support.js";
export { parseJSON } from "./support/ParseJSON.js";
export {
    splitIntoWords,
    capitalize,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    legalizeCharacters,
    isLetterOrDigit,
} from "./support/Strings.js";
export { train as trainMarkovChain } from "./MarkovChain.js";
export { QuickTypeError, messageError, messageAssert } from "./Messages.js";
export {
    Type,
    PrimitiveType,
    ArrayType,
    ClassType,
    ClassProperty,
    EnumType,
    MapType,
    UnionType,
    ObjectType,
    type TypeKind,
    type TransformedStringTypeKind,
    type PrimitiveStringTypeKind,
} from "./Type/index.js";
export { getStream } from "./input/io/get-stream/index.js";

export { readableFromFileOrURL, readFromFileOrURL } from "./input/io/NodeIO.js";

export { FetchingJSONSchemaStore } from "./input/FetchingJSONSchemaStore.js";
export { JSONSchemaStore, type JSONSchema } from "./input/JSONSchemaStore.js";
export { sourcesFromPostmanCollection } from "./input/PostmanCollection.js";
export { TypeBuilder } from "./Type/TypeBuilder.js";
export type { StringTypeMapping } from "./Type/TypeBuilderUtils.js";
export { type TypeRef, derefTypeRef } from "./Type/TypeRef.js";
export {
    TypeAttributeKind,
    type TypeAttributes,
    emptyTypeAttributes,
} from "./attributes/TypeAttributes.js";
export {
    TypeNames,
    makeNamesTypeAttributes,
    namesTypeAttributeKind,
} from "./attributes/TypeNames.js";
export { StringTypes } from "./attributes/StringTypes.js";
export {
    removeNullFromUnion,
    matchType,
    nullableFromUnion,
} from "./Type/TypeUtils.js";
export { ConvenienceRenderer } from "./ConvenienceRenderer.js";
export { uriTypeAttributeKind } from "./attributes/URIAttributes.js";

export * from "./language/index.js";
