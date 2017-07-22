module CSharp 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude
import Types
import Utils (mapM)

import Data.Array (concatMap)
import Data.Char (toCharCode)
import Data.Char.Unicode (GeneralCategory(..), generalCategory, isLetter, isPrint)
import Data.Foldable (find, for_, intercalate)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromMaybe, isNothing)
import Data.Set (Set)
import Data.Set as S
import Data.String as Str
import Data.String.Util (capitalize, camelCase, intToHex)
import Data.Tuple (Tuple(..))
import Partial.Unsafe (unsafePartial)

data CSInfo = CSInfo { classNames ::  Map Int String, unionNames :: Map (Set IRType) String, unions :: List (Set IRType) }

type CSDoc = Doc CSInfo

renderer :: Renderer
renderer =
    { name: "C#"
    , aceMode: "csharp"
    , extension: "cs"
    , render: renderGraphToCSharp
    }

renderGraphToCSharp :: IRGraph -> String
renderGraphToCSharp graph =
    let classes = classesInGraph graph
        classNames = transformNames (\(IRClassData { names }) -> csNameStyle $ combineNames names) ("Other" <> _) S.empty classes
        unions = filterTypes unionPredicate graph
        unionNames = transformNames (unionName classNames graph) ("Other" <> _) (S.fromFoldable $ M.values classNames) $ map (\s -> Tuple s s) unions
    in
        runDoc csharpDoc graph (CSInfo { classNames, unionNames, unions })
    where
        unionPredicate =
            case _ of
            IRUnion s ->
                if isNothing $ nullableFromSet s then
                    Just s
                else
                    Nothing
            _ -> Nothing

unionName :: Map Int String -> IRGraph -> Set IRType -> String
unionName classNames graph s =
    "OneOf" <> (csNameStyle $ intercalate "_" $ map (typeNameForUnion classNames graph) $ L.sort $ L.fromFoldable s)

getClassNames :: CSDoc (Map Int String)
getClassNames = do
    CSInfo { classNames } <- getRendererInfo
    pure classNames

getUnions :: CSDoc (List (Set IRType))
getUnions = do
    CSInfo { unions } <- getRendererInfo
    pure unions

getUnionNames :: CSDoc (Map (Set IRType) String)
getUnionNames = do
    CSInfo { unionNames } <- getRendererInfo
    pure unionNames

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType _ = false

isLetterCharacter :: Char -> Boolean
isLetterCharacter c =
    isLetter c || (generalCategory c == Just LetterNumber)

isStartCharacter :: Char -> Boolean
isStartCharacter c =
    isLetterCharacter c || c == '_'

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    case generalCategory c of
    Nothing -> false
    Just DecimalNumber -> true
    Just ConnectorPunctuation -> true
    Just NonSpacingMark -> true
    Just SpacingCombiningMark -> true
    Just Format -> true
    _ -> isLetterCharacter c

legalizeIdentifier :: String -> String
legalizeIdentifier str =
    case Str.charAt 0 str of
    -- FIXME: use the type to infer a name?
    Nothing -> "Empty"
    Just s ->
        if isStartCharacter s then
            Str.fromCharArray $ map (\c -> if isLetterCharacter c then c else '_') $ Str.toCharArray str
        else
            legalizeIdentifier ("_" <> str)

stringify :: String -> String
stringify str =
    "\"" <> (Str.fromCharArray $ concatMap charRep $ Str.toCharArray str) <> "\""
    where
        charRep c =
            case c of
            '\\' -> ['\\', '\\']
            '\"' -> ['\\', '\"']
            '\n' -> ['\\', 'n']
            '\t' -> ['\\', 't']
            _ ->
                if isPrint c then
                    [c]
                else
                    let i = toCharCode c
                    in
                        if i <= 0xffff then
                            Str.toCharArray $ "\\u" <> intToHex 4 i
                        else
                            Str.toCharArray $ "\\U" <> intToHex 8 i

nullableFromSet :: Set IRType -> Maybe IRType
nullableFromSet s =
    case L.fromFoldable s of
    IRNull : x : L.Nil -> Just x
    x : IRNull : L.Nil -> Just x
    _ -> Nothing

renderUnionToCSharp :: Set IRType -> CSDoc String
renderUnionToCSharp s =
    case nullableFromSet s of
    Just x -> do
        rendered <- renderTypeToCSharp x
        pure if isValueType x then rendered <> "?" else rendered
    Nothing -> lookupUnionName s

lookupName :: forall a. Ord a => a -> Map a String -> String
lookupName original nameMap =
    fromMaybe "NAME_NOT_PROCESSED" $ M.lookup original nameMap

lookupClassName :: Int -> CSDoc String
lookupClassName i = do
    classNames <- getClassNames
    pure $ lookupName i classNames

lookupUnionName :: Set IRType -> CSDoc String
lookupUnionName s = do
    unionNames <- getUnionNames
    pure $ lookupName s unionNames

renderTypeToCSharp :: IRType -> CSDoc String
renderTypeToCSharp = case _ of
    IRNothing -> pure "object"
    IRNull -> pure "object"
    IRInteger -> pure "int"
    IRDouble -> pure "double"
    IRBool -> pure "bool"
    IRString -> pure "string"
    IRArray a -> do
        rendered <- renderTypeToCSharp a
        pure $ rendered <> "[]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderTypeToCSharp t
        pure $ "Dictionary<string, " <> rendered <> ">"
    IRUnion types -> renderUnionToCSharp types

csNameStyle :: String -> String
csNameStyle = camelCase >>> capitalize >>> legalizeIdentifier

typeNameForUnion :: Map Int String -> IRGraph -> IRType -> String
typeNameForUnion classNames graph = case _ of
    IRNothing -> "nothing"
    IRNull -> "null"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> typeNameForUnion classNames graph a <> "_array"
    IRClass i ->
        let IRClassData { names } = getClassFromGraph graph i
        in
            combineNames names
    IRMap t -> typeNameForUnion classNames graph t <> "_map"
    IRUnion _ -> "union"

csharpDoc :: CSDoc Unit
csharpDoc = do
    lines """// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do:
             //
             //   var data = QuickType.TopLevel.FromJson(jsonString);
             //
             namespace QuickType
             {"""
    blank
    indent do
        unionNames <- getUnionNames
        let needConverter = not $ M.isEmpty unionNames
        lines """using System;
                 using System.Net;
                 using System.Collections.Generic;

                 using Newtonsoft.Json;"""
        blank
        classes <- getClasses
        for_ classes \(Tuple i cls) -> do
            renderCSharpClass i cls needConverter
            blank
        unions <- getUnions
        for_ unions \types -> do
            renderCSharpUnion types
            blank
        when needConverter do
            renderJsonConverter
    lines "}"

renderJsonConverter :: CSDoc Unit
renderJsonConverter = do
    unionNames <- getUnionNames
    let names = M.values unionNames
    lines "class Converter : JsonConverter {"
    indent do
        lines "public override bool CanConvert(Type t) {"
        indent $ lines $ "return " <> intercalate " || " (map (\n -> "t == typeof(" <> n <> ")") names) <> ";"
        lines "}"
        blank
        lines "public override object ReadJson(JsonReader reader, Type t, object existingValue, JsonSerializer serializer) {"
        indent do
            -- FIXME: call the constructor via reflection?
            for_ names \name -> do
                lines $ "if (t == typeof(" <> name <> "))"
                indent $ lines $ "return new " <> name <> "(reader, serializer);"
            lines "throw new Exception(\"Unknown type\");"
        lines "}"
        blank
        lines "public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer) {"
        indent $ lines "throw new NotImplementedException();"
        lines "}"
        blank
        lines "public override bool CanWrite { get { return false; } }"
    lines "}"

tokenCase :: String -> CSDoc Unit
tokenCase tokenType =
    lines $ "case JsonToken." <> tokenType <> ":"

renderNullDeserializer :: Set IRType -> CSDoc Unit
renderNullDeserializer types =
    when (S.member IRNull types) do
        tokenCase "Null"
        indent do
            lines "break;"

unionFieldName :: IRType -> CSDoc String
unionFieldName t = do
    classNames <- getClassNames
    graph <- getGraph
    let typeName = typeNameForUnion classNames graph t
    pure $ csNameStyle typeName

deserialize :: String -> String -> CSDoc Unit
deserialize fieldName typeName = do
    lines $ fieldName <> " = serializer.Deserialize<" <> typeName <> ">(reader);"
    lines "break;"

deserializeType :: IRType -> CSDoc Unit
deserializeType t = do
    fieldName <- unionFieldName t
    renderedType <- renderTypeToCSharp t
    deserialize fieldName renderedType

renderPrimitiveDeserializer :: String -> IRType -> Set IRType -> CSDoc Unit
renderPrimitiveDeserializer tokenType t types =
    when (S.member t types) do
        tokenCase tokenType
        indent do
            deserializeType t

renderDoubleDeserializer :: Set IRType -> CSDoc Unit
renderDoubleDeserializer types =
    when (S.member IRDouble types) do
        unless (S.member IRInteger types) do
            tokenCase "Integer"
        tokenCase "Float"
        indent do
            deserializeType IRDouble

renderGenericDeserializer :: (IRType -> Boolean) -> String -> Set IRType -> CSDoc Unit
renderGenericDeserializer predicate tokenType types = unsafePartial $
    case find predicate types of
    Nothing -> pure unit
    Just t -> do
        tokenCase tokenType
        indent do
            deserializeType t

renderCSharpUnion :: Set IRType -> CSDoc Unit
renderCSharpUnion allTypes = do
    name <- lookupUnionName allTypes
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) allTypes
    graph <- getGraph
    line $ words ["struct", name, "{"]
    indent do
        for_ nonNullTypes \t -> do
            typeString <- renderTypeToCSharp $ IRUnion $ S.union (S.singleton t) (S.singleton IRNull)
            field <- unionFieldName t
            lines $ "public " <> typeString <> " " <> field <> ";"
        blank
        lines $ "public " <> name <> "(JsonReader reader, JsonSerializer serializer) {"
        indent do
            for_ (L.fromFoldable nonNullTypes) \field -> do
                fieldName <- unionFieldName field
                lines $ fieldName <> " = null;"
            lines "switch (reader.TokenType) {"
            indent do
                renderNullDeserializer allTypes
                renderPrimitiveDeserializer "Integer" IRInteger allTypes
                renderDoubleDeserializer allTypes
                renderPrimitiveDeserializer "Boolean" IRBool allTypes
                renderPrimitiveDeserializer "String" IRString allTypes
                renderGenericDeserializer isArray "StartArray" allTypes
                renderGenericDeserializer isClass "StartObject" allTypes
                renderGenericDeserializer isMap "StartObject" allTypes
                lines $ "default: throw new Exception(\"Cannot convert " <> name <> "\");"
            lines "}"
        lines "}"
    lines "}"

renderCSharpClass :: Int -> IRClassData -> Boolean -> CSDoc Unit
renderCSharpClass classIndex (IRClassData { names, properties }) needConverter = do
    className <- lookupClassName classIndex
    let propertyNames = transformNames csNameStyle ("Other" <> _) (S.singleton className) $ map (\n -> Tuple n n) $ M.keys properties
    line $ words ["class", className]

    lines "{"
    indent do
        for_ (M.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
            line do
                string "[JsonProperty("
                string $ stringify pname
                string ")]"
            line do
                string "public "
                rendered <- renderTypeToCSharp ptype
                string rendered
                let csPropName = lookupName pname propertyNames
                words ["", csPropName, "{ get; set; }"]
            blank
        
        -- TODO don't rely on 'TopLevel'
        when (names == S.singleton "TopLevel") do
            IRGraph { toplevel } <- getGraph
            toplevelType <- renderTypeToCSharp toplevel
            lines "// Loading helpers"
            let converterParam = if needConverter then ", new Converter()" else ""
            lines $ "public static " <> toplevelType <> " FromJson(string json) => JsonConvert.DeserializeObject<" <> toplevelType <> ">(json" <> converterParam <> ");"
    lines "}"
