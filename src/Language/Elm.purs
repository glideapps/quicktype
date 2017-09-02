module Language.Elm 
    ( renderer
    ) where

import Doc (Doc, Namer, Renderer, blank, combineNames, forEachTopLevel_, getClasses, getModuleName, getTopLevelNames, getTopLevels, getTypeNameForUnion, getUnions, indent, line, lookupClassName, lookupName, lookupUnionName, renderRenderItems, simpleNamer, transformPropertyNames, unionIsNotSimpleNullable, unionNameIntercalated)
import IRGraph (IRClassData(..), IRType(..), IRUnionRep, isArray, nullableFromUnion, unionToList)
import Prelude

import Data.Array as A
import Data.Foldable (for_, intercalate)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.String.Util (camelCase, capitalize, decapitalize, isLetterOrUnderscore, isLetterOrUnderscoreOrDigit, legalizeCharacters, startWithLetter, stringEscape)
import Data.Tuple (Tuple(..), fst)
import Utils (forEnumerated_, sortByKey, sortByKeyM, mapM)

forbiddenNames :: Array String
forbiddenNames =
    [ "if", "then", "else"
    , "case", "of"
    , "let", "in"
    , "type"
    , "module", "where"
    , "import", "exposing"
    , "as"
    , "port"
    , "int", "float", "bool", "string"
    , "Jenc", "Jdec", "Jpipe"
    , "always", "identity"
    , "Array", "Dict", "Maybe", "map", "toList"
    , "makeArrayEncoder", "makeDictEncoder", "makeNullableEncoder"
    ]

renderer :: Renderer
renderer =
    { name: "Elm"
    , aceMode: "elm"
    , extension: "elm"
    , doc: elmDoc
    , options: M.empty
    , transforms:
        { nameForClass: elmNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames
        , topLevelName: elmNamer upperNameStyle
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: elmNamer (upperNameStyle <<< combineNames)
            , nameFromTypes: elmNamer (unionNameIntercalated upperNameStyle "Or")
            }
        }
    }

decoderNameFromTypeName :: String -> String
decoderNameFromTypeName = decapitalize

encoderNameFromTypeName :: String -> String
encoderNameFromTypeName className = "encode" <> className

alsoForbiddenForTypeName :: String -> Array String
alsoForbiddenForTypeName n = [decoderNameFromTypeName n, encoderNameFromTypeName n]

elmNamer :: forall a. Ord a => (a -> String) -> Namer a
elmNamer namer thing = case _ of
    Just name -> result name
    Nothing -> result $ namer thing
    where
        result name = { name, forbid: A.cons name $ alsoForbiddenForTypeName name }

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = upperNameStyle $ combineNames names

typeNameForTopLevelNameGiven :: String -> String
typeNameForTopLevelNameGiven = upperNameStyle

namesFromTopLevelNameGiven :: String -> Array String
namesFromTopLevelNameGiven given =
    let name = typeNameForTopLevelNameGiven given
    in A.cons name $ alsoForbiddenForTypeName name

legalize :: String -> String
legalize = legalizeCharacters isLetterOrUnderscoreOrDigit

elmNameStyle :: Boolean -> String -> String
elmNameStyle upper = legalize >>> camelCase >>> (startWithLetter isLetterOrUnderscore upper)

lowerNameStyle :: String -> String
lowerNameStyle = elmNameStyle false

upperNameStyle :: String -> String
upperNameStyle = elmNameStyle true

renderComment :: Maybe String -> String
renderComment (Just s) = " -- " <> s
renderComment Nothing = ""

elmDoc :: Doc Unit
elmDoc = do
    topLevels <- getTopLevels
    -- givenTopLevel <- typeNameForTopLevelNameGiven <$> getTopLevelNameGiven
    -- let topLevelDecoder = decoderNameFromTypeName givenTopLevel
    -- let topLevelEncoder = encoderNameFromTypeName givenTopLevel
    classes <- getClasses
    unions <- getUnions
    classNames <- mapM (\t -> lookupClassName $ fst t) classes
    unionNames <- mapM lookupUnionName unions
    topLevelNames <- M.values <$> getTopLevelNames
    let topLevelDecoders = map decoderNameFromTypeName topLevelNames
    let alsoTopLevelExports = L.concat $ map (alsoForbiddenForTypeName >>> L.fromFoldable) topLevelNames
    let exports = L.concat $ topLevelNames : alsoTopLevelExports : classNames : unionNames : L.Nil
    moduleName <- getModuleName upperNameStyle
    line """-- To decode the JSON data, add this file to your project, run
--
--     elm-package install NoRedInk/elm-decode-pipeline
--
-- add these imports
--
--     import Json.Decode exposing (decodeString)"""
    line $ "--     import " <> moduleName <> " exposing (" <> (intercalate ", " topLevelDecoders) <> ")"
    line """--
-- and you're off to the races with
--"""
    forEachTopLevel_ \topLevelName topLevelType -> do
        let topLevelDecoder = decoderNameFromTypeName topLevelName
        line $ "--     decodeString " <> topLevelDecoder <> " myJsonString"
    blank
    line $ "module " <> moduleName <> " exposing"
    indent do
        forWithPrefix_ exports "( " ", " \parenOrComma name ->
            line $ parenOrComma <> name
        line ")"
    blank
    line """import Json.Decode as Jdec
import Json.Decode.Pipeline as Jpipe
import Json.Encode as Jenc
import Array exposing (Array, map)
import Dict exposing (Dict, map, toList)
"""
    renderRenderItems blank (Just renderTopLevelDefinition) (typeRenderer renderTypeDefinition) (Just renderUnionDefinition)
    blank
    line "-- decoders and encoders"
    blank
    renderRenderItems blank (Just renderTopLevelFunctions) (typeRenderer renderTypeFunctions) (Just renderUnionFunctions)
    blank
    line """--- encoder helpers

makeArrayEncoder : (a -> Jenc.Value) -> Array a -> Jenc.Value
makeArrayEncoder f arr =
    Jenc.array (Array.map f arr)

makeDictEncoder : (a -> Jenc.Value) -> Dict String a -> Jenc.Value
makeDictEncoder f dict =
    Jenc.object (toList (Dict.map (\k -> f) dict))

makeNullableEncoder : (a -> Jenc.Value) -> Maybe a -> Jenc.Value
makeNullableEncoder f m =
    case m of
    Just x -> f x
    Nothing -> Jenc.null"""

renderTopLevelDefinition :: String -> IRType -> Doc Unit
renderTopLevelDefinition topLevelName topLevel = do
    { rendered: topLevelRendered } <- typeStringForType topLevel
    line $ "type alias " <> topLevelName <> " = " <> topLevelRendered

renderTopLevelFunctions :: String -> IRType -> Doc Unit
renderTopLevelFunctions topLevelName topLevel = do
    let topLevelDecoder = decoderNameFromTypeName topLevelName
    let topLevelEncoder = encoderNameFromTypeName topLevelName
    { rendered: rootDecoder } <- decoderNameForType topLevel
    line $ topLevelDecoder <> " : Jdec.Decoder " <> topLevelName
    line $ topLevelDecoder <> " = " <> rootDecoder
    blank
    { rendered: rootEncoder } <- encoderNameForType topLevel
    line $ topLevelEncoder <> " : " <> topLevelName <> " -> String"
    line $ topLevelEncoder <> " r = Jenc.encode 0 (" <> rootEncoder <> " r)"

singleWord :: String -> Doc { rendered :: String, multiWord :: Boolean }
singleWord w = pure { rendered: w, multiWord: false }

multiWord :: String -> String -> Doc { rendered :: String, multiWord :: Boolean }
multiWord s1 s2 = pure { rendered: s1 <> " " <> s2, multiWord: true }

parenIfNeeded :: { rendered :: String, multiWord :: Boolean } -> String
parenIfNeeded { rendered, multiWord: false } = rendered
parenIfNeeded { rendered, multiWord: true } = "(" <> rendered <> ")"

typeStringForType :: IRType -> Doc { rendered :: String, multiWord :: Boolean }
typeStringForType = case _ of
    IRNothing -> singleWord "Jdec.Value"
    IRNull -> singleWord "()"
    IRInteger -> singleWord "Int"
    IRDouble -> singleWord "Float"
    IRBool -> singleWord "Bool"
    IRString -> singleWord "String"
    IRArray a -> do
        ts <- typeStringForType a
        multiWord "Array" $ parenIfNeeded ts
    IRClass i -> singleWord =<< lookupClassName i
    IRMap t -> do
        ts <- typeStringForType t
        multiWord "Dict String" $ parenIfNeeded ts
    IRUnion u ->
        case nullableFromUnion u of
        Just x -> do
            ts <- typeStringForType x
            multiWord "Maybe" $ parenIfNeeded ts
        Nothing -> do
            singleWord =<< lookupUnionName u

unionConstructorName :: String -> IRType -> Doc String
unionConstructorName unionName t = do
    typeName <- upperNameStyle <$> getTypeNameForUnion t
    pure $ typeName <> "In" <> unionName

decoderNameForType :: IRType -> Doc { rendered :: String, multiWord :: Boolean }
decoderNameForType = case _ of
    IRNothing -> singleWord "Jdec.value"
    IRNull -> multiWord "Jdec.null" "()"
    IRInteger -> singleWord "Jdec.int"
    IRDouble -> singleWord "Jdec.float"
    IRBool -> singleWord "Jdec.bool"
    IRString -> singleWord "Jdec.string"
    IRArray a -> do
        dn <- decoderNameForType a
        multiWord "Jdec.array" $ parenIfNeeded dn
    IRClass i -> singleWord =<< decoderNameFromTypeName <$> lookupClassName i
    IRMap t -> do
        dn <- decoderNameForType t
        multiWord "Jdec.dict" $ parenIfNeeded dn
    IRUnion u ->
        case nullableFromUnion u of
        Just t -> do
            dn <- decoderNameForType t
            multiWord "Jdec.nullable" $ parenIfNeeded dn
        Nothing -> do
            singleWord =<< decoderNameFromTypeName <$> lookupUnionName u

encoderNameForType :: IRType -> Doc { rendered :: String, multiWord :: Boolean }
encoderNameForType = case _ of
    IRNothing -> singleWord "identity"
    IRNull -> multiWord "always" "Jenc.null"
    IRInteger -> singleWord "Jenc.int"
    IRDouble -> singleWord "Jenc.float"
    IRBool -> singleWord "Jenc.bool"
    IRString -> singleWord "Jenc.string"
    IRArray a -> do
        rendered <- encoderNameForType a
        multiWord "makeArrayEncoder" $ parenIfNeeded rendered
    IRClass i -> singleWord =<< encoderNameFromTypeName <$> lookupClassName i
    IRMap t -> do
        rendered <- encoderNameForType t
        multiWord "makeDictEncoder" $ parenIfNeeded rendered
    IRUnion u ->
        case nullableFromUnion u of
        Just t -> do
            rendered <- encoderNameForType t
            multiWord "makeNullableEncoder" $ parenIfNeeded rendered
        Nothing ->
            singleWord =<< encoderNameFromTypeName <$> lookupUnionName u

forWithPrefix_ :: forall a b p m. Applicative m => List a -> p -> p -> (p -> a -> m b) -> m Unit
forWithPrefix_ l firstPrefix restPrefix f =
    forEnumerated_ l (\i -> f $ if i == 0 then firstPrefix else restPrefix)

isOptional :: IRType -> Boolean
isOptional = case _ of
    IRUnion u -> not $ unionIsNotSimpleNullable u
    _ -> false

renderTypeDefinition :: String -> Map String String -> List (Tuple String IRType) -> Doc Unit
renderTypeDefinition className propertyNames propsList = do
    line $ "type alias " <> className <> " ="
    indent do
        forWithPrefix_ propsList "{ " ", " \braceOrComma (Tuple pname ptype) -> do
            let propName = lookupName pname propertyNames
            { rendered } <- typeStringForType ptype
            line $ braceOrComma <> propName <> " : " <> rendered
        when (propsList == L.Nil) do
            line "{"
        line "}"

renderTypeFunctions :: String -> Map String String -> List (Tuple String IRType) -> Doc Unit
renderTypeFunctions className propertyNames propsList = do
    let decoderName = decoderNameFromTypeName className
    line $ decoderName <> " : Jdec.Decoder " <> className
    line $ decoderName <> " ="
    indent do
        line $ "Jpipe.decode " <> className
        for_ propsList \(Tuple pname ptype) -> do
            indent do
                propDecoder <- decoderNameForType ptype
                let { reqOrOpt, fallback } = if isOptional ptype then { reqOrOpt: "Jpipe.optional", fallback: " Nothing" } else { reqOrOpt: "Jpipe.required", fallback: "" }
                line $ "|> " <> reqOrOpt <> " \"" <> stringEscape pname <> "\" " <> (parenIfNeeded propDecoder) <> fallback
    blank
    let encoderName = encoderNameFromTypeName className
    line $ encoderName <> " : " <> className <> " -> Jenc.Value"
    line $ encoderName <> " x ="
    indent do
        line "Jenc.object"
        indent do
            forWithPrefix_ propsList "[ " ", " \bracketOrComma (Tuple pname ptype) -> do
                let propName = lookupName pname propertyNames
                { rendered: propEncoder } <- encoderNameForType ptype
                line $ bracketOrComma <> "(\"" <> stringEscape pname <> "\", " <> propEncoder <> " x." <> propName <> ")"
            when (propsList == L.Nil) do
                line "["
            line "]"

typeRenderer :: (String -> Map String String -> List (Tuple String IRType) -> Doc Unit) -> String -> Map String IRType -> Doc Unit
typeRenderer renderer' className properties = do
    let propertyNames = transformPropertyNames (simpleNamer lowerNameStyle) (\n -> "other" <> capitalize n) forbiddenNames properties
    let propsList = M.toUnfoldable properties # sortByKey (\t -> lookupName (fst t) propertyNames)
    renderer' className propertyNames propsList

renderUnionDefinition :: String -> IRUnionRep -> Doc Unit
renderUnionDefinition unionName unionRep = do
    fields <- unionToList unionRep # sortByKeyM (unionConstructorName unionName)
    line $ "type " <> unionName
    forWithPrefix_ fields "=" "|" \equalsOrPipe t -> do
        indent do
            constructor <- unionConstructorName unionName t
            when (t == IRNull) do
                line $ equalsOrPipe <> " " <> constructor
            unless (t == IRNull) do
                ts <- typeStringForType t
                line $ equalsOrPipe <> " " <> constructor <> " " <> (parenIfNeeded ts)

renderUnionFunctions :: String -> IRUnionRep -> Doc Unit
renderUnionFunctions unionName unionRep = do
    let decoderName = decoderNameFromTypeName unionName
    line $ decoderName <> " : Jdec.Decoder " <> unionName
    line $ decoderName <> " ="
    indent do
        let decFields = L.sortBy arrayFirstOrder $ unionToList unionRep
        line "Jdec.oneOf"
        indent do
            forWithPrefix_ decFields "[" "," \bracketOrComma t -> do
                constructor <- unionConstructorName unionName t
                when (t == IRNull) do
                    line $ bracketOrComma <> " Jdec.null " <> constructor
                unless (t == IRNull) do
                    decoder <- decoderNameForType t
                    line $ bracketOrComma <> " Jdec.map " <> constructor <> " " <> parenIfNeeded decoder
            line "]"
    blank
    let encoderName = encoderNameFromTypeName unionName
    line $ encoderName <> " : " <> unionName <> " -> Jenc.Value"
    line $ encoderName <> " x = case x of"
    indent do
        fields <- unionToList unionRep # sortByKeyM (unionConstructorName unionName)
        for_ fields \t -> do
            constructor <- unionConstructorName unionName t
            when (t == IRNull) do
                line $ constructor <> " -> Jenc.null"
            unless (t == IRNull) do
                { rendered: encoder } <- encoderNameForType t
                line $ constructor <> " y -> " <> encoder <> " y"
    where
        arrayFirstOrder a b =
            if isArray a then
                if isArray b then
                    compare a b
                else
                    LT
            else
                if isArray b then
                    GT
                else
                    compare a b
