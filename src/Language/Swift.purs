module Language.Swift
    ( renderer
    ) where

import Doc (Doc, Namer, Renderer, blank, combineNames, forEachClass_, forEachProperty_, forEachTopLevel_, forEachUnion_, forbidNamer, getTypeNameForUnion, indent, line, lookupClassName, lookupName, lookupUnionName, renderRenderItems, simpleNamer, transformPropertyNames, unionIsNotSimpleNullable, unionNameIntercalated)
import IRGraph (IRClassData(..), IRType(..), IRUnionRep, canBeNull, forUnion_, isUnionMember, nullableFromUnion, removeNullFromUnion, unionToList)
import Prelude

import Data.Array as A
import Data.Char.Unicode (isAlphaNum, isDigit)
import Data.Foldable (for_, null)
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.String as String
import Data.String.Util (camelCase, capitalize, decapitalize, genericStringEscape, intToHex, legalizeCharacters, startWithLetter)

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

renderer :: Renderer
renderer =
    { name: "Swift"
    , aceMode: "swift"
    , extension: "swift"
    , doc: swiftDoc
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

swiftDoc :: Doc Unit
swiftDoc = do
    line "// To parse the JSON, add this file to your project and do:"
    line "//"
    forEachTopLevel_ \topLevelName topLevelType -> do
        typ <- renderType topLevelType
        line $ "//   let " <> decapitalize topLevelName <> " = " <> topLevelName <> "(fromString: jsonString)!"
    blank
    line "import Foundation"
    blank

    renderRenderItems blank (Just renderTopLevelAlias) renderClassDefinition (Just renderUnionDefinition)

    blank
    line $ "// Serialization extensions"

    forEachTopLevel_ renderTopLevelExtensions

    forEachClass_ \className properties -> do
        blank
        renderClassExtension className properties

    forEachUnion_ \unionName unionRep -> do
        blank
        renderUnionExtension unionName unionRep

    blank
    supportFunctions

supportFunctions :: Doc Unit
supportFunctions = do
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

fileprivate func checkNull(_ v: Any?) -> Any?? {
    if v != nil { return .none }
    return .some(nil)
}"""

renderUnion :: IRUnionRep -> Doc String
renderUnion ur =
    case nullableFromUnion ur of
    Just r -> do
        rendered <- renderType r
        pure $ rendered <> "?"
    Nothing -> lookupUnionName ur

renderType :: IRType -> Doc String
renderType = case _ of
    IRNothing -> pure "Any?"
    IRNull -> pure "Any?"
    IRInteger -> pure "Int"
    IRDouble -> pure "Double"
    IRBool -> pure "Bool"
    IRString -> pure "String"
    IRArray a -> do
        rendered <- renderType a
        pure $ "[" <> rendered <> "]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderType t
        pure $ "[String: " <> rendered <> "]"
    IRUnion ur -> renderUnion ur

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
convertAny IRNothing var =
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
convertToAny IRNothing var =
    pure $ var <> " ?? NSNull()"
convertToAny IRNull var =
    pure $ "NSNull() as Any"
convertToAny _ var =
    pure $ var <> " as Any"

renderTopLevelAlias :: String -> IRType -> Doc Unit
renderTopLevelAlias topLevelName topLevelType = do
    top <- renderType topLevelType
    line $ "typealias "<> topLevelName <> " = " <> top

renderClassDefinition :: String -> Map String IRType -> Doc Unit
renderClassDefinition className properties = do
    let forbidden = keywords <> ["json", "any"]
    let propertyNames = makePropertyNames properties "" forbidden
    line $ "struct " <> className <> " {"
    indent do
        forEachProperty_ properties propertyNames \_ ptype fieldName _ -> do
            rendered <- renderType ptype
            line $ "let " <> fieldName <> ": " <> rendered
    line "}"

renderTopLevelExtensions :: String -> IRType -> Doc Unit
renderTopLevelExtensions topLevelName topLevelType = do
    blank

    topLevelRendered <- renderType topLevelType
    extensionType <- case topLevelType of
        IRArray t -> ("Array where Element == " <> _) <$> renderType t
        IRMap t -> ("Dictionary where Key == String, Value == " <> _) <$> renderType t
        _ -> pure topLevelRendered

    line $ "extension " <> extensionType <> " {"
    indent do
        line $ "init?(fromString json: String, using encoding: String.Encoding = .utf8) {"
        indent do
            line "guard let data = json.data(using: encoding) else { return nil }"
            line "self.init(fromData: data)"
        line "}"
        blank
        line $ "init?(fromData data: Data) {"
        indent do
            line "guard let json = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }"
            line "self.init(fromAny: json)"
        line "}"
        
        case topLevelType of
            IRArray _ ->  do
                blank
                line $ "init?(fromAny untyped: Any) {"
                indent do
                    convertCode <- convertAny topLevelType "untyped"
                    line $ "guard let elements = " <> convertCode <> " else { return nil }"
                    line $ "self.init(elements)"
                line "}"
            IRMap _ -> do
                blank
                line $ "init?(fromAny untyped: Any) {"
                indent do
                    convertCode <- convertAny topLevelType "untyped"
                    line $ "guard let elements = " <> convertCode <> " else { return nil }"
                    line $ "self.init()"
                    line $ "elements.forEach { self[$0.key] = $0.value }"
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

renderClassExtension :: String -> Map String IRType -> Doc Unit
renderClassExtension className properties = do
    let forbidden = keywords <> ["jsonUntyped", "json"]
    let propertyNames = makePropertyNames properties "" forbidden
    line $ "extension " <> className <> " {"
    indent do
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
        blank
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

makePropertyNames :: Map String IRType -> String -> Array String -> Map String String
makePropertyNames properties suffix forbidden =
    transformPropertyNames (fieldNamer suffix) otherField forbidden properties
    where
        fieldNamer :: String -> Namer String
        fieldNamer suffix' = simpleNamer \name -> swiftNameStyle false name <> suffix'

        otherField :: String -> String
        otherField name = "other" <> capitalize name

renderUnionDefinition :: String -> IRUnionRep -> Doc Unit
renderUnionDefinition unionName unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    line $ "enum " <> unionName <> " {"
    indent do
        forUnion_ nonNullUnion \typ -> do
            name <- caseName typ
            rendered <- renderType typ
            line $ "case " <> name <> "(" <> rendered <> ")"
        when hasNull do
            name <- caseName IRNull
            line $ "case " <> name
    line "}"

renderUnionExtension :: String -> IRUnionRep -> Doc Unit
renderUnionExtension unionName unionRep = do
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

caseName :: IRType -> Doc String
caseName t = swiftNameStyle false <$> getTypeNameForUnion t
