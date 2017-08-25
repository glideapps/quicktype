module Language.Swift
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Array as A
import Data.Char.Unicode (isAlphaNum, isDigit)
import Data.Foldable (for_)
import Data.FoldableWithIndex (forWithIndex_)
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.Set as S
import Data.String.Util (camelCase, capitalize, decapitalize, genericStringEscape, intToHex, legalizeCharacters, startWithLetter)
import Data.Tuple (Tuple(..))
import Utils (removeElement)

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
        , topLevelName: noForbidNamer (swiftNameStyle true)
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (swiftNameStyle true <<< combineNames)
            , nameFromTypes: simpleNamer (unionNameIntercalated (swiftNameStyle true) "Or")
            }
        }
    }

swiftNameStyle :: Boolean -> String -> String
swiftNameStyle isUpper =
    legalizeCharacters isPartCharacter >>> camelCase >>> startWithLetter isStartCharacter isUpper
    where
        isStartCharacter :: Char -> Boolean
        isStartCharacter c = c == '_' || (isAlphaNum c && not (isDigit c))

        isPartCharacter :: Char -> Boolean
        isPartCharacter c = c == '_' || isAlphaNum c

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = swiftNameStyle true $ combineNames names

stringEscape :: String -> String
stringEscape =
    genericStringEscape unicodeEscape
    where
        unicodeEscape i =
            ['\\', 'u', '{'] <> intToHex 0 i <> ['}']

swiftDoc :: Doc Unit
swiftDoc = do
    line "import Foundation"
    forEachTopLevel_ \topLevelName topLevelType -> do
        blank
        rendered <- renderType topLevelType
        line $ "func " <> (decapitalize topLevelName) <> "(fromJSONData data: Data) -> " <> rendered <> "? {"
        indent do
            line "if let json = try? JSONSerialization.jsonObject(with: data, options: []) {"
            indent do
                convertCode <- convertAny topLevelType "json"
                line $ "return " <> convertCode
            line "}"
            line "return nil"
        line "}"
        blank
        line $ "func jsonData(from" <> topLevelName <> " x: " <> rendered <> ") -> Data? {"
        indent do
            convertCode <- convertToAny topLevelType "x"
            line $ "let json = " <> convertCode
            line "return try? JSONSerialization.data(withJSONObject: json, options: [])"
        line "}"
    forEachClass_ \className properties -> do
        blank
        renderClassDefinition className properties
    forEachUnion_ \unionName unionTypes -> do
        blank
        renderUnionDefinition unionName unionTypes
    blank
    line """func convertArray<T>(converter: (Any) -> T?, json: Any) -> [T]? {
    guard let jsonArr = json as? [Any] else { return nil }
    var arr: [T] = []
    for v in jsonArr {
        if let converted = converter(v) {
            arr.append(converted)
        } else {
            return nil
        }
    }
    return arr
}

func convertOptional<T>(converter: (Any) -> T?, json: Any?) -> T?? {
    guard let v = json
    else {
        return Optional.some(nil)
    }
    return converter(v)
}

func convertDict<T>(converter: (Any) -> T?, json: Any?) -> [String: T]? {
    guard let jsonDict = json as? [String: Any] else { return nil }
    var dict: [String: T] = [:]
    for (k, v) in jsonDict {
        if let converted = converter(v) {
            dict[k] = converted
        } else {
            return nil
        }
    }
    return dict
}

func convertToAny<T>(dictionary: [String: T], converter: (T) -> Any) -> Any {
    var result: [String: Any] = [:]
    for (k, v) in dictionary {
        result[k] = converter(v)
    }
    return result
}

func convertDouble(_ v: Any) -> Double? {
    if let w = v as? Double {
        return w
    }
    if let w = v as? Int {
        return Double(w)
    }
    return nil
}

let falseType = NSNumber(value: false).objCType
let trueNumber = NSNumber(value: true)
let trueType = trueNumber.objCType

func convertBool(_ v: Any?) -> Bool? {
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

func removeNSNull(_ v: Any?) -> Any? {
    if let w = v {
        if w is NSNull {
            return nil
        }
        return w
    }
    return nil
}

func checkNull(_ v: Any?) -> Any?? {
    if v != nil {
        return Optional.none
    }
    return Optional.some(nil)
}"""

renderUnion :: IRUnionRep -> Doc String
renderUnion ur =
    case nullableFromSet $ unionToSet ur of
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

convertAnyFunc :: IRType -> Doc String
convertAnyFunc (IRClass i) = do
    name <- lookupClassName i
    pure $ name <> ".init"
convertAnyFunc (IRUnion ur) =
    case nullableFromSet $ unionToSet ur of
    Just t -> do
        converter <- convertAnyFunc t
        pure $ "{ (json: Any) in convertOptional(converter: " <> converter <> ", json: json) }"
    Nothing -> do
        name <- lookupUnionName ur
        pure $ name <> ".fromJson"
convertAnyFunc IRDouble =
    pure "convertDouble"
convertAnyFunc IRNull =
    pure "checkNull"
convertAnyFunc t = do
    converted <- convertAny t "json"
    pure $ "{ (json: Any) in " <> converted <> " }"

convertAny :: IRType -> String -> Doc String
convertAny (IRArray a) var = do
    converter <- convertAnyFunc a
    pure $ "convertArray(converter: " <> converter <> ", json: " <> var <> ")"
convertAny (IRMap m) var = do
    converter <- convertAnyFunc m
    pure $ "convertDict(converter: " <> converter <> ", json: " <> var <> ")"
convertAny (IRUnion ur) var =
    case nullableFromSet $ unionToSet ur of
    Just t -> do
        converter <- convertAnyFunc t
        pure $ "convertOptional(converter: " <> converter <> ", json: " <> var <> ")"
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

convertToAny :: IRType -> String -> Doc String
convertToAny (IRArray a) var = do
    rendered <- renderType a
    convertCode <- convertToAny a "v"
    pure $ var <> ".map({ (v: " <> rendered <> ") in " <> convertCode <> " }) as Any"
convertToAny (IRMap m) var = do
    rendered <- renderType m
    convertCode <- convertToAny m "v"
    pure $ "convertToAny(dictionary: " <> var <> ", converter: { (v: " <> rendered <> ") in " <> convertCode <> " })"
convertToAny (IRClass i) var =
    pure $ var <> ".toJSON()"
convertToAny (IRUnion ur) var =
    case nullableFromSet $ unionToSet ur of
    Just t -> do
        rendered <- renderType t
        convertCode <- convertToAny t "v"
        pure $ var <> ".map({ (v: " <> rendered <> ") in " <> convertCode  <> " }) ?? NSNull()"
    Nothing ->
        pure $ var <> ".toJSON()"
convertToAny IRNothing var =
    pure $ var <> " ?? NSNull()"
convertToAny IRNull var =
    pure $ "NSNull() as Any"
convertToAny _ var =
    pure $ var <> " as Any"

renderClassDefinition :: String -> Map String IRType -> Doc Unit
renderClassDefinition className properties = do
    let forbidden = keywords <> ["jsonUntyped", "json"]
    let propertyNames = makePropertyNames "" forbidden
    line $ "struct " <> className <> " {"
    indent do
        forEachProperty_ properties propertyNames \_ ptype fieldName _ -> do
            rendered <- renderType ptype
            line $ "let " <> fieldName <> ": " <> rendered
        blank
        line $ "init?(_ jsonUntyped: Any) {"
        indent do
            line "guard let json = jsonUntyped as? [String: Any] else { return nil }"
            let forbiddenForUntyped = forbidden <> (A.fromFoldable $ M.keys propertyNames)
            let untypedNames = makePropertyNames "Untyped" forbiddenForUntyped
            let forbiddenForConverted = forbiddenForUntyped <> (A.fromFoldable $ M.keys untypedNames)
            let convertedNames = makePropertyNames "Converted" forbiddenForConverted
            forEachProperty_ properties untypedNames \pname ptype untypedName _ -> do
                when (canBeNull ptype) do
                    line $ "let " <> untypedName <> " = removeNSNull(json[\"" <> stringEscape pname <> "\"])"
            unless (M.isEmpty properties) do
                line "guard"
                indent do
                    forEachProperty_ properties untypedNames \pname ptype untypedName isLast -> do
                        let convertedName = lookupName pname convertedNames
                        unless (canBeNull ptype) do
                            line $ "let " <> untypedName <> " = removeNSNull(json[\"" <> stringEscape pname <> "\"]),"
                        convertCode <- convertAny ptype untypedName
                        line $ "let " <> convertedName <> " = " <> convertCode <> (if isLast then "" else ",")
                line "else {"
                indent do
                    line "return nil"
                line "}"
            forEachProperty_ properties propertyNames \pname _ fieldName _ -> do
                let convertedName = lookupName pname convertedNames
                line $ "self." <> fieldName <> " = " <> convertedName
        line "}"
        blank
        line "func toJSON() -> Any {"
        indent do
            line "var dict: [String: Any] = [:]"
            forEachProperty_ properties propertyNames \pname ptype fieldName _ -> do
                convertCode <- convertToAny ptype ("self." <> fieldName)
                line $ "dict[\"" <> stringEscape pname <> "\"] = " <> convertCode
            line "return dict"
        line "}"
    line "}"
    where
        isSimpleNullable :: IRType -> Boolean
        isSimpleNullable (IRUnion ur) = not $ unionIsNotSimpleNullable ur
        isSimpleNullable _ = false

        maybeCast :: IRType -> String
        maybeCast (IRArray _) = " as? [Any]"
        maybeCast (IRClass _) = " as? [String: Any]"
        maybeCast (IRMap _) = " as? [String: Any]"
        maybeCast _ = ""

        isBuiltInType :: IRType -> Boolean
        isBuiltInType (IRArray a) = isBuiltInType a
        isBuiltInType (IRMap m) = isBuiltInType m
        isBuiltInType (IRClass _) = false
        isBuiltInType (IRUnion ur) =
            case nullableFromSet $ unionToSet ur of
            Just t -> isBuiltInType t
            Nothing -> false
        isBuiltInType _ = true

        forEachProperty_ :: Map String IRType -> Map String String -> (String -> IRType -> String -> Boolean -> Doc Unit) -> Doc Unit
        forEachProperty_ properties propertyNames f =
            let propertyArray = M.toUnfoldable properties :: Array _
                lastIndex = (A.length propertyArray) - 1
            in
                forWithIndex_ propertyArray \i (Tuple pname ptype) -> do
                    let fieldName = lookupName pname propertyNames
                    f pname ptype fieldName (i == lastIndex)

        makePropertyNames :: String -> Array String -> Map String String
        makePropertyNames suffix forbidden =
            transformPropertyNames (fieldNamer suffix) otherField forbidden properties

        fieldNamer :: String -> Namer String
        fieldNamer suffix =
            simpleNamer \name -> swiftNameStyle false name <> suffix

        otherField :: String -> String
        otherField name =
            "other" <> capitalize name

renderUnionDefinition :: String -> Set IRType -> Doc Unit
renderUnionDefinition unionName unionTypes = do
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) unionTypes
    line $ "enum " <> unionName <> " {"
    indent do
        for_ nonNullTypes \typ -> do
            name <- caseName typ
            rendered <- renderType typ
            line $ "case " <> name <> "(" <> rendered <> ")"
        case emptyOrNull of
            Just t -> do
                name <- caseName t
                line $ "case " <> name                
            Nothing -> pure unit
        blank
        line $ "static func fromJson(_ v: Any) -> " <> unionName <> "? {"
        indent do
            case emptyOrNull of
                Just t -> do
                    name <- caseName t
                    line "guard let v = removeNSNull(v)"
                    line "else {"
                    indent do
                        line $ "return " <> unionName <> "." <> name
                    line "}"
                Nothing -> pure unit
            when (S.member IRBool unionTypes) do
                renderCase IRBool
            when (S.member IRInteger unionTypes) do
                renderCase IRInteger
            for_ (S.difference nonNullTypes $ S.fromFoldable [IRBool, IRInteger]) \typ -> do
                renderCase typ
            line "return nil"
        line "}"
        blank
        line $ "func toJSON() -> Any {"
        indent do
            line $ "switch self {"
            for_ unionTypes \typ -> do
                name <- caseName typ
                let letString = if typ == IRNull then "" else "(let x)"
                line $ "case ." <> name <> letString <> ":"
                indent do
                    convertCode <- convertToAny typ "x"
                    line $ "return " <> convertCode
            line "}"
        line "}"
    line "}"
    where
        caseName :: IRType -> Doc String
        caseName t = swiftNameStyle false <$> getTypeNameForUnion t

        renderCase :: IRType -> Doc Unit
        renderCase t = do
            convertCode <- convertAny t "v"
            line $ "if let x = " <> convertCode <> " {"
            indent do
                name <- caseName t
                line $ "return " <> unionName <> "." <> name <> "(x)"
            line "}"
