module Language.Swift
    ( swift3Renderer
    , swift4Renderer
    ) where

import Prelude

import Data.Array as A
import Data.Char.Unicode (isAlphaNum, isDigit)
import Data.Foldable (for_, null)
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.Set as S
import Data.String as String
import Data.String.Util (camelCase, capitalize, decapitalize, genericStringEscape, intToHex, legalizeCharacters, startWithLetter)
import Data.Tuple (Tuple(..))
import Doc (Doc, Namer, Renderer, blank, combineNames, forEachClass_, forEachProperty_, forEachTopLevel_, forEachUnion_, forbidNamer, getGraph, getOptionValue, getTypeNameForUnion, indent, line, lookupClassName, lookupName, lookupUnionName, renderRenderItems, simpleNamer, transformPropertyNames, unionIsNotSimpleNullable, unionNameIntercalated, unlessOption)
import IRGraph (IRClassData(..), IRType(..), IRUnionRep, canBeNull, forUnion_, isUnionMember, nullableFromUnion, removeNullFromUnion, unionToList, filterTypes)
import Options (Option, booleanOption)

keywords :: Array String
keywords =
    [ "associatedtype", "class", "deinit", "enum", "extension", "fileprivate", "func", "import", "init", "inout", "internal", "let", "open", "operator", "private", "protocol", "public", "static", "struct", "subscript", "typealias", "var"
    , "break", "case", "continue", "default", "defer", "do", "else", "fallthrough", "for", "guard", "if", "in", "repeat", "return", "switch", "where", "while"
    , "as", "Any", "catch", "false", "is", "nil", "rethrows", "super", "self", "Self", "throw", "throws", "true", "try"
    , "_"
    , "associativity", "convenience", "dynamic", "didSet", "final", "get", "infix", "indirect", "lazy", "left", "mutating", "nonmutating", "optional", "override", "postfix", "precedence", "prefix", "Protocol", "required", "right", "set", "Type", "unowned", "weak", "willSet"
    , "String", "Int", "Double", "Bool", "Data", "CommandLine", "FileHandle", "JSONSerialization"
    , "checkNull", "removeNSNull", "nilToNSNull", "convertArray", "convertOptional", "convertDict", "convertDouble"
    ]

data Variant = Swift3 | Swift4

derive instance eqVariant :: Eq Variant

justTypesOption :: Option Boolean
justTypesOption = booleanOption "just-types" "Plain types only" false

swift3Renderer :: Renderer
swift3Renderer =
    { displayName: "Swift 3"
    , names: [ "swift3" ]
    , aceMode: "swift"
    , extension: "swift"
    , doc: swift3Doc
    , options: [justTypesOption.specification]
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames: keywords
        , topLevelName: forbidNamer (swiftNameStyle true) (\n -> [swiftNameStyle true n])
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (swiftNameStyle true <<< combineNames)
            , nameFromTypes: simpleNamer (unionNameIntercalated (swiftNameStyle true) "Or")
            }
        }
    }

swift4Renderer :: Renderer
swift4Renderer =
    { displayName: "Swift 4"
    , names: [ "swift4", "swift" ]
    , aceMode: "swift"
    , extension: "swift"
    , doc: swift4Doc
    , options: [justTypesOption.specification]
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames: keywords
        , topLevelName: forbidNamer (swiftNameStyle true) (\n -> [swiftNameStyle true n])
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (swiftNameStyle true <<< combineNames)
            , nameFromTypes: simpleNamer (unionNameIntercalated (swiftNameStyle true) "Or")
            }
        }
    }

legalize :: String -> String
legalize = legalizeCharacters isPartCharacter
    where
        isPartCharacter :: Char -> Boolean
        isPartCharacter c = c == '_' || isAlphaNum c

swiftNameStyle :: Boolean -> String -> String
swiftNameStyle isUpper =
    legalize >>> camelCase >>> startWithLetter isStartCharacter isUpper
    where
        isStartCharacter :: Char -> Boolean
        isStartCharacter c = c == '_' || (isAlphaNum c && not (isDigit c))

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = swiftNameStyle true $ combineNames names

stringEscape :: String -> String
stringEscape =
    genericStringEscape unicodeEscape
    where
        unicodeEscape i =
            "\\u{" <> (String.fromCharArray $ intToHex 0 i) <> "}"

renderHeader :: Doc Unit
renderHeader = do
    unlessOption justTypesOption do
        line "// To parse the JSON, add this file to your project and do:"
        line "//"
        forEachTopLevel_ \topLevelName topLevelType -> do
            typ <- renderType Swift3 topLevelType
            line $ "//   let " <> decapitalize topLevelName <> " = " <> topLevelName <> ".from(json: jsonString)!"
        blank
    line "import Foundation"
    blank

swift3Doc :: Doc Unit
swift3Doc = do
    renderHeader

    renderRenderItems blank (Just $ renderTopLevelAlias Swift3) (renderClassDefinition Swift3 false) (Just $ renderUnionDefinition Swift3 false)

    unlessOption justTypesOption do
        blank
        line $ "// Serialization extensions"

        forEachTopLevel_ renderTopLevelExtensions3

        forEachClass_ \className properties -> do
            blank
            renderClassExtension3 className properties

        forEachUnion_ \unionName unionRep -> do
            blank
            renderUnionExtension3 unionName unionRep

        blank
        supportFunctions3

swift4Doc :: Doc Unit
swift4Doc = do
    renderHeader

    renderRenderItems blank (Just $ renderTopLevelAlias Swift4) (renderClassDefinition Swift4 true) (Just $ renderUnionDefinition Swift4 true)

    unlessOption justTypesOption do
        blank
        line $ "// Serialization extensions"

        forEachTopLevel_ renderTopLevelExtensions4

        forEachClass_ \className properties -> do
            blank
            renderClassExtension4 className properties

        forEachUnion_ \unionName unionRep -> do
            blank
            renderUnionExtension4 unionName unionRep
        
        blank
        supportFunctions4

supportFunctions3 :: Doc Unit
supportFunctions3 = do
    line """// Helpers

fileprivate func convertArray<T>(_ converter: (Any) -> T?, _ json: Any) -> [T]? {
    guard let jsonArr = json as? [Any] else { return nil }
    var arr = [T]()
    for v in jsonArr {
        if let converted = converter(v) {
            arr.append(converted)
        } else {
            return nil
        }
    }
    return arr
}

fileprivate func convertOptional<T>(_ converter: (Any) -> T?, _ json: Any?) -> T?? {
    guard let v = json else { return .some(nil) }
    return converter(v)
}

fileprivate func convertDict<T>(_ converter: (Any) -> T?, _ json: Any?) -> [String: T]? {
    guard let jsonDict = json as? [String: Any] else { return nil }
    var dict = [String: T]()
    for (k, v) in jsonDict {
        if let converted = converter(v) {
            dict[k] = converted
        } else {
            return nil
        }
    }
    return dict
}

fileprivate func convertToAny<T>(_ dictionary: [String: T], _ converter: (T) -> Any) -> Any {
    var result = [String: Any]()
    for (k, v) in dictionary {
        result[k] = converter(v)
    }
    return result
}

fileprivate func convertDouble(_ v: Any) -> Double? {
    if let w = v as? Double { return w }
    if let w = v as? Int { return Double(w) }
    return nil
}

fileprivate let falseType = NSNumber(value: false).objCType
fileprivate let trueNumber = NSNumber(value: true)
fileprivate let trueType = trueNumber.objCType

fileprivate func convertBool(_ v: Any?) -> Bool? {
    guard let number = v as? NSNumber
    else {
        if let b = v as? Bool {
            return b
        }
        return nil
    }
    
    if number.objCType != falseType && number.objCType != trueType {
        return nil
    }
    return number.isEqual(trueNumber)
}

fileprivate func removeNSNull(_ v: Any?) -> Any? {
    if let w = v {
        if w is NSNull {
            return nil
        }
        return w
    }
    return nil
}

fileprivate func checkNull(_ v: Any?) -> NSNull? {
    if v != nil { return .none }
    return .some(NSNull())
}"""

anyAndNullPredicate :: IRType -> Maybe IRType
anyAndNullPredicate IRNull = Just IRNull
anyAndNullPredicate IRAnyType = Just IRAnyType
anyAndNullPredicate _ = Nothing

supportFunctions4 :: Doc Unit
supportFunctions4 = do
    graph <- getGraph
    let anyAndNullSet = filterTypes anyAndNullPredicate graph
    let needAny = S.member IRAnyType anyAndNullSet
    let needNull = needAny || S.member IRNull anyAndNullSet

    when (needAny || needNull) do
        line "// Helpers"
        blank
    
    when needNull do
        line """class JSONNull: Codable {
    public init() {
    }
    
    public required init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if !container.decodeNil() {
            throw DecodingError.typeMismatch(JSONNull.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for JSONNull"))
        }
    }
    
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encodeNil()
    }
}"""

    when needAny do
        blank
        line """class JSONCodingKey : CodingKey {
    let key: String
    
    required init?(intValue: Int) {
        return nil
    }
    
    required init?(stringValue: String) {
        key = stringValue
    }
    
    var intValue: Int? {
        return nil
    }
    
    var stringValue: String {
        return key
    }
}

class JSONAny: Codable {
    public let value: Any
    
    static func decodingError(forCodingPath codingPath: [CodingKey]) -> DecodingError {
        let context = DecodingError.Context(codingPath: codingPath, debugDescription: "Cannot decode JSONAny")
        return DecodingError.typeMismatch(JSONAny.self, context)
    }
    
    static func encodingError(forValue value: Any, codingPath: [CodingKey]) -> EncodingError {
        let context = EncodingError.Context(codingPath: codingPath, debugDescription: "Cannot encode JSONAny")
        return EncodingError.invalidValue(value, context)
    }

    static func decode(from container: SingleValueDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if container.decodeNil() {
            return JSONNull()
        }
        throw decodingError(forCodingPath: container.codingPath)
    }
    
    static func decode(from container: inout UnkeyedDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if let value = try? container.decodeNil() {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer() {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }
    
    static func decode(from container: inout KeyedDecodingContainer<JSONCodingKey>, forKey key: JSONCodingKey) throws -> Any {
        if let value = try? container.decode(Bool.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int64.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(String.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeNil(forKey: key) {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer(forKey: key) {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }
    
    static func decodeArray(from container: inout UnkeyedDecodingContainer) throws -> [Any] {
        var arr: [Any] = []
        while !container.isAtEnd {
            let value = try decode(from: &container)
            arr.append(value)
        }
        return arr
    }

    static func decodeDictionary(from container: inout KeyedDecodingContainer<JSONCodingKey>) throws -> [String: Any] {
        var dict = [String: Any]()
        for key in container.allKeys {
            let value = try decode(from: &container, forKey: key)
            dict[key.stringValue] = value
        }
        return dict
    }
    
    static func encode(to container: inout UnkeyedEncodingContainer, array: [Any]) throws {
        for value in array {
            if let value = value as? Bool {
                try container.encode(value)
            } else if let value = value as? Int64 {
                try container.encode(value)
            } else if let value = value as? Double {
                try container.encode(value)
            } else if let value = value as? String {
                try container.encode(value)
            } else if value is JSONNull {
                try container.encodeNil()
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer()
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }
    
    static func encode(to container: inout KeyedEncodingContainer<JSONCodingKey>, dictionary: [String: Any]) throws {
        for (key, value) in dictionary {
            let key = JSONCodingKey(stringValue: key)!
            if let value = value as? Bool {
                try container.encode(value, forKey: key)
            } else if let value = value as? Int64 {
                try container.encode(value, forKey: key)
            } else if let value = value as? Double {
                try container.encode(value, forKey: key)
            } else if let value = value as? String {
                try container.encode(value, forKey: key)
            } else if value is JSONNull {
                try container.encodeNil(forKey: key)
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer(forKey: key)
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout SingleValueEncodingContainer, value: Any) throws {
        if let value = value as? Bool {
            try container.encode(value)
        } else if let value = value as? Int64 {
            try container.encode(value)
        } else if let value = value as? Double {
            try container.encode(value)
        } else if let value = value as? String {
            try container.encode(value)
        } else if value is JSONNull {
            try container.encodeNil()
        } else {
            throw encodingError(forValue: value, codingPath: container.codingPath)
        }
    }
    
    public required init(from decoder: Decoder) throws {
        if var arrayContainer = try? decoder.unkeyedContainer() {
            self.value = try JSONAny.decodeArray(from: &arrayContainer)
        } else if var container = try? decoder.container(keyedBy: JSONCodingKey.self) {
            self.value = try JSONAny.decodeDictionary(from: &container)
        } else {
            let container = try decoder.singleValueContainer()
            self.value = try JSONAny.decode(from: container)
        }
    }
    
    public func encode(to encoder: Encoder) throws {
        if let arr = self.value as? [Any] {
            var container = encoder.unkeyedContainer()
            try JSONAny.encode(to: &container, array: arr)
        } else if let dict = self.value as? [String: Any] {
            var container = encoder.container(keyedBy: JSONCodingKey.self)
            try JSONAny.encode(to: &container, dictionary: dict)
        } else {
            var container = encoder.singleValueContainer()
            try JSONAny.encode(to: &container, value: self.value)
        }
    }
}"""

renderUnion :: Variant -> IRUnionRep -> Doc String
renderUnion variant ur =
    case nullableFromUnion ur of
    Just r -> do
        rendered <- renderType variant r
        pure $ rendered <> "?"
    Nothing -> lookupUnionName ur

swift3OrPlainCase :: forall a. Variant -> a -> a -> Doc a
swift3OrPlainCase variant swift3OrPlain swift4NonPlain = do
    justTypes <- getOptionValue justTypesOption
    if (justTypes || variant == Swift3)
        then
            pure swift3OrPlain
        else
            pure swift4NonPlain

renderType :: Variant -> IRType -> Doc String
renderType variant = case _ of
    IRNoInformation -> pure "FIXME_THIS_SHOULD_NOT_HAPPEN"
    IRAnyType -> swift3OrPlainCase variant "Any?" "JSONAny"
    IRNull -> swift3OrPlainCase variant "NSNull" "JSONNull"
    IRInteger -> pure "Int"
    IRDouble -> pure "Double"
    IRBool -> pure "Bool"
    IRString -> pure "String"
    IRArray a -> do
        rendered <- renderType variant a
        pure $ "[" <> rendered <> "]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderType variant t
        pure $ "[String: " <> rendered <> "]"
    IRUnion ur -> renderUnion variant ur

convertAny :: IRType -> String -> Doc String
convertAny (IRArray a) var = do
    converter <- convertAnyFunc a
    pure $ "convertArray(" <> converter <> ", " <> var <> ")"
convertAny (IRMap m) var = do
    converter <- convertAnyFunc m
    pure $ "convertDict(" <> converter <> ", " <> var <> ")"
convertAny (IRUnion ur) var =
    case nullableFromUnion ur of
    Just t -> do
        converter <- convertAnyFunc t
        pure $ "convertOptional(" <> converter <> ", " <> var <> ")"
    Nothing -> do
        name <- lookupUnionName ur
        pure $ name <> ".fromJson(" <> var <> ")"
convertAny IRAnyType var =
    pure var
convertAny IRBool var =
    pure $ "convertBool(" <> var <> ")"
convertAny IRInteger var =
    pure $ var <> " as? Int"
convertAny IRString var =
    pure $ var <> " as? String"
convertAny t var = do
    converter <- convertAnyFunc t
    pure $ converter <> "(" <> var <> ")"

convertAnyFunc :: IRType -> Doc String
convertAnyFunc = case _ of
    IRClass i -> do
        name <- lookupClassName i
        pure $ name <> ".init(fromAny:)"
    IRUnion ur ->
        case nullableFromUnion ur of
        Just t -> do
            converter <- convertAnyFunc t
            pure $ "{ (json: Any) in convertOptional(" <> converter <> ", json) }"
        Nothing -> do
            name <- lookupUnionName ur
            pure $ name <> ".fromJson"
    IRDouble -> pure "convertDouble"
    IRNull -> pure "checkNull"
    t -> do
        converted <- convertAny t "$0"
        pure $ "{ " <> converted <> " }"

convertToAny :: IRType -> String -> Doc String
convertToAny (IRArray a) var = do
    convertCode <- convertToAny a "$0"
    pure $ var <> ".map({ " <> convertCode <> " }) as Any"
convertToAny (IRMap m) var = do
    convertCode <- convertToAny m "$0"
    pure $ "convertToAny(" <> var <> ", { "<> convertCode <> " })"
convertToAny (IRClass i) var =
    pure $ var <> ".any"
convertToAny (IRUnion ur) var =
    case nullableFromUnion ur of
    Just t -> do
        convertCode <- convertToAny t "$0"
        pure $ var <> ".map({ " <> convertCode  <> " }) ?? NSNull()"
    Nothing ->
        pure $ var <> ".any"
convertToAny IRAnyType var =
    pure $ var <> " ?? NSNull()"
convertToAny IRNull var =
    pure $ "NSNull()"
convertToAny _ var =
    pure $ var <> " as Any"

renderTopLevelAlias :: Variant -> String -> IRType -> Doc Unit
renderTopLevelAlias variant topLevelName topLevelType = do
    top <- renderType variant topLevelType
    line $ "typealias "<> topLevelName <> " = " <> top

codableString :: Boolean -> String
codableString true = ": Codable"
codableString false = ""

renderClassDefinition :: Variant -> Boolean -> String -> Map String IRType -> Doc Unit
renderClassDefinition variant codable className properties = do
    let forbidden = keywords <> ["json", "any"]
    -- FIXME: we compute these here, and later again when rendering the extension
    let propertyNames = makePropertyNames properties "" forbidden
    line $ "class " <> className <> codableString codable <> " {"
    indent do
        forEachProperty_ properties propertyNames \_ ptype fieldName _ -> do
            rendered <- renderType variant ptype
            line $ "let " <> fieldName <> ": " <> rendered
        justTypes <- getOptionValue justTypesOption
        when ((variant == Swift3) && (not justTypes)) do
            blank
            line $ "fileprivate init?(fromAny any: Any) {"
            unless (M.isEmpty properties) $ indent do
                line "guard let json = any as? [String: Any] else { return nil }"
                let forbiddenForUntyped = forbidden <> (A.fromFoldable $ M.keys propertyNames)
                let untypedNames = makePropertyNames properties "Any" forbiddenForUntyped
                let forbiddenForConverted = forbiddenForUntyped <> (A.fromFoldable $ M.keys untypedNames)
                forEachProperty_ properties untypedNames \pname ptype untypedName _ -> do
                    when (canBeNull ptype) do
                        line $ "let " <> untypedName <> " = removeNSNull(json[\"" <> stringEscape pname <> "\"])"
                line "guard"
                indent do
                    forEachProperty_ properties untypedNames \pname ptype untypedName isLast -> do
                        let convertedName = lookupName pname propertyNames
                        unless (canBeNull ptype) do
                            line $ "let " <> untypedName <> " = removeNSNull(json[\"" <> stringEscape pname <> "\"]),"
                        convertCode <- convertAny ptype untypedName
                        line $ "let " <> convertedName <> " = " <> convertCode <> (if isLast then "" else ",")
                    line "else { return nil }"
                forEachProperty_ properties propertyNames \pname _ fieldName _ -> do
                    let convertedName = lookupName pname propertyNames
                    line $ "self." <> fieldName <> " = " <> convertedName
            line "}"
    line "}"

renderExtensionType :: Variant -> IRType -> Doc String
renderExtensionType variant (IRArray t) = ("Array where Element == " <> _) <$> renderType variant t
renderExtensionType variant (IRMap t) = ("Dictionary where Key == String, Value == " <> _) <$> renderType variant t
renderExtensionType variant t = renderType variant t

renderTopLevelExtensions3 :: String -> IRType -> Doc Unit
renderTopLevelExtensions3 topLevelName topLevelType = do
    blank

    topLevelRendered <- renderType Swift3 topLevelType
    extensionType <- renderExtensionType Swift3 topLevelType

    line $ "extension " <> extensionType <> " {"
    indent do
        line $ "static func from(json: String, using encoding: String.Encoding = .utf8) -> " <> topLevelRendered <> "? {"
        indent do
            line "guard let data = json.data(using: encoding) else { return nil }"
            line $ "return " <> topLevelRendered <> ".from(data: data)"
        line "}"
        blank
        line $ "static func from(data: Data) -> " <> topLevelRendered <> "? {"
        indent do
            line "guard let json = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }"
            line $ "return " <> topLevelRendered <> ".from(any: json)"
        line "}"
        
        case topLevelType of
            IRArray _ ->  do
                blank
                line $ "static func from(any untyped: Any) -> " <> topLevelRendered <> "? {"
                indent do
                    convertCode <- convertAny topLevelType "untyped"
                    line $ "guard let elements = " <> convertCode <> " else { return nil }"
                    line $ "return " <> topLevelRendered <> "(elements)"
                line "}"
            IRMap _ -> do
                blank
                line $ "static func from(any untyped: Any) -> " <> topLevelRendered <> "? {"
                indent do
                    convertCode <- convertAny topLevelType "untyped"
                    line $ "guard let elements = " <> convertCode <> " else { return nil }"
                    line $ "var result = " <> topLevelRendered <> "()"
                    line "elements.forEach { result[$0.key] = $0.value }"
                    line "return result"
                line "}"
            IRClass _ -> do
                blank
                line $ "static func from(any untyped: Any) -> " <> topLevelRendered <> "? {"
                indent do
                    line $ "return " <> topLevelRendered <> "(fromAny: untyped)"
                line "}"
            _ -> pure unit

        blank
        line $ "var jsonData: Data? {"
        indent do
            convertCode <- convertToAny topLevelType "self"
            line $ "let json = " <> convertCode
            line "return try? JSONSerialization.data(withJSONObject: json, options: [])"
        line "}"
            
        blank
        line $ "var jsonString: String? {"
        indent do
            line $ "guard let data = self.jsonData else { return nil }"
            line $ "return String(data: data, encoding: .utf8)"
        line "}"

    line "}"

renderTopLevelExtensions4 :: String -> IRType -> Doc Unit
renderTopLevelExtensions4 topLevelName topLevelType = do
    blank

    topLevelRendered <- renderType Swift4 topLevelType
    extensionType <- renderExtensionType Swift4 topLevelType

    line $ "extension " <> extensionType <> " {"
    indent do
        line $ "static func from(json: String, using encoding: String.Encoding = .utf8) -> " <> topLevelRendered <> "? {"
        indent do
            line "guard let data = json.data(using: encoding) else { return nil }"
            line $ "return " <> topLevelRendered <> ".from(data: data)"
        line "}"
        blank
        line $ "static func from(data: Data) -> " <> topLevelRendered <> "? {"
        indent do
            line "let decoder = JSONDecoder()"
            line $ "return try? decoder.decode(" <> topLevelRendered <> ".self, from: data)"
        line "}"

        blank
        line $ "var jsonData: Data? {"
        indent do
            line "let encoder = JSONEncoder()"
            line "return try? encoder.encode(self)"
        line "}"
            
        blank
        line $ "var jsonString: String? {"
        indent do
            line $ "guard let data = self.jsonData else { return nil }"
            line $ "return String(data: data, encoding: .utf8)"
        line "}"
    line "}"

renderClassExtension3 :: String -> Map String IRType -> Doc Unit
renderClassExtension3 className properties = do
    let forbidden = keywords <> ["jsonUntyped", "json"]
    let propertyNames = makePropertyNames properties "" forbidden
    line $ "extension " <> className <> " {"
    indent do
        line "fileprivate var any: Any {"
        indent do
            if null properties
                then line "return [String: Any]()"
                else do
                    line "return ["
                    indent do
                        forEachProperty_ properties propertyNames \pname ptype fieldName _ -> do
                            convertCode <- convertToAny ptype ("self." <> fieldName)
                            line $ "\"" <> stringEscape pname <> "\": " <> convertCode <> ","
                    line "]"
        line "}"
    line "}"

renderClassExtension4 :: String -> Map String IRType -> Doc Unit
renderClassExtension4 className properties = do
    let propertyNames = makePropertyNames properties "" keywords
    when (M.size propertyNames > 0) do
        line $ "extension " <> className <> " {"
        indent do
            line "enum CodingKeys: String, CodingKey {"
            indent do
                for_ (M.toUnfoldable propertyNames :: Array (Tuple String String)) \(Tuple jsonName swiftName) -> do
                    if jsonName == swiftName
                        then line $ "case " <> swiftName
                        else line $ "case " <> swiftName <> " = \"" <> stringEscape jsonName <> "\""
            line "}"
        line "}"

makePropertyNames :: Map String IRType -> String -> Array String -> Map String String
makePropertyNames properties suffix forbidden =
    transformPropertyNames (fieldNamer suffix) otherField forbidden properties
    where
        fieldNamer :: String -> Namer String
        fieldNamer suffix' = simpleNamer \name -> swiftNameStyle false name <> suffix'

        otherField :: String -> String
        otherField name = "other" <> capitalize name

renderUnionDefinition :: Variant -> Boolean -> String -> IRUnionRep -> Doc Unit
renderUnionDefinition variant codable unionName unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    line $ "enum " <> unionName <> codableString codable <> " {"
    indent do
        forUnion_ nonNullUnion \typ -> do
            name <- caseName typ
            rendered <- renderType variant typ
            line $ "case " <> name <> "(" <> rendered <> ")"
        when hasNull do
            name <- caseName IRNull
            line $ "case " <> name
    line "}"

renderUnionExtension3 :: String -> IRUnionRep -> Doc Unit
renderUnionExtension3 unionName unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    line $ "extension " <> unionName <> " {"
    indent do
        line $ "fileprivate static func fromJson(_ v: Any) -> " <> unionName <> "? {"
        indent do
            when hasNull do
                name <- caseName IRNull
                line "guard let v = removeNSNull(v)"
                line "else {"
                indent do
                    line $ "return ." <> name
                line "}"
            when (isUnionMember IRBool nonNullUnion) do
                renderCase IRBool
            when (isUnionMember IRInteger nonNullUnion) do
                renderCase IRInteger
            -- FIXME: this is ugly and inefficient
            for_ (L.difference (unionToList nonNullUnion) $ L.fromFoldable [IRBool, IRInteger]) \typ -> do
                renderCase typ
            line "return nil"
        line "}"
        blank
        line $ "fileprivate var any: Any {"
        indent do
            line $ "switch self {"
            forUnion_ unionRep \typ -> do
                name <- caseName typ
                let letString = if typ == IRNull then "" else "(let x)"
                convertCode <- convertToAny typ "x"
                line $ "case ." <> name <> letString <> ": return " <> convertCode
            line "}"
        line "}"
    line "}"
    where
    renderCase :: IRType -> Doc Unit
    renderCase t = do
        convertCode <- convertAny t "v"
        name <- caseName t
        line $ "if let x = " <> convertCode <> " { return ." <> name <> "(x) }"

renderUnionExtension4 :: String -> IRUnionRep -> Doc Unit
renderUnionExtension4 unionName unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    line $ "extension " <> unionName <> " {"
    indent do
        line "init(from decoder: Decoder) throws {"
        indent do
            line "let container = try decoder.singleValueContainer()"
            when (isUnionMember IRBool nonNullUnion) do
                renderCase IRBool
            when (isUnionMember IRInteger nonNullUnion) do
                renderCase IRInteger
            -- FIXME: this is ugly and inefficient
            for_ (L.difference (unionToList nonNullUnion) $ L.fromFoldable [IRBool, IRInteger]) \typ -> do
                renderCase typ
            when hasNull do
                name <- caseName IRNull
                line "if container.decodeNil() {"
                indent do
                    line $ "self = ." <> name
                    line "return"
                line "}"
            line $ "throw DecodingError.typeMismatch(" <> unionName <> ".self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: \"Wrong type for " <> unionName <> "\"))"
        line "}"
        blank
        line "func encode(to encoder: Encoder) throws {"
        indent do
            line "var container = encoder.singleValueContainer()"
            line "switch self {"
            for_ (unionToList nonNullUnion) \t -> do
                name <- caseName t
                line $ "case ." <> name <> "(let x):"
                indent do
                    line "try container.encode(x)"
            when hasNull do
                name <- caseName IRNull
                line $ "case ." <> name <> ":"
                indent do
                    line "try container.encodeNil()"
            line "}"
        line "}"
    line "}"
    where
        renderCase :: IRType -> Doc Unit
        renderCase t = do
            name <- caseName t
            typeName <- renderType Swift4 t
            line $ "if let x = try? container.decode(" <> typeName <> ".self) {"
            indent do
                line $ "self = ." <> name <> "(x)"
                line "return"
            line "}"

caseName :: IRType -> Doc String
caseName t = swiftNameStyle false <$> getTypeNameForUnion t
