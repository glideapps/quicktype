module Elm 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Array as A
import Data.Char.Unicode (isLetter)
import Data.Foldable (for_, intercalate)
import Data.List (List)
import Data.List as L
import Data.Map as Map
import Data.Maybe (Maybe(..), maybe)
import Data.Set (Set)
import Data.Set as S
import Data.String as Str
import Data.String.Util (capitalize, decapitalize, camelCase, stringEscape)
import Data.Tuple (Tuple(..), fst)
import Utils (sortByKey, sortByKeyM, forEnumerated_)

forbiddenWords :: Array String
forbiddenWords =
    [ "if", "then", "else"
    , "case", "of"
    , "let", "in"
    , "type"
    , "module", "where"
    , "import", "exposing"
    , "as"
    , "port"
    , "int", "float", "bool", "string"
    , "root", "jenc", "jdec", "jpipe", "array", "dict", "maybe"
    ]

forbiddenPropertyNames :: Set String
forbiddenPropertyNames = S.fromFoldable forbiddenWords

forbiddenNames :: Array String
forbiddenNames = A.insert "Root" $ map capitalize forbiddenWords

renderer :: Renderer
renderer =
    { name: "Elm"
    , aceMode: "elm"
    , extension: "elm"
    , doc: elmDoc
    , transforms:
        { nameForClass
        , unionName: Just unionName
        , unionPredicate: Just unionPredicate
        , nextName: \s -> "Other" <> s
        , forbiddenNames: forbiddenNames
        }
    }

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = upperNameStyle $ combineNames names

unionName :: L.List String -> String
unionName s =
    L.sort s
    <#> upperNameStyle
    # intercalate "Or"

unionPredicate :: IRType -> Maybe (Set IRType)
unionPredicate = case _ of
    IRUnion ur ->
        let s = unionToSet ur
        in case nullableFromSet s of
            Nothing -> Just s
            _ -> Nothing
    _ -> Nothing

isLetterCharacter :: Char -> Boolean
isLetterCharacter c =
    isLetter c || c == '_'

legalizeIdentifier :: Boolean -> String -> String
legalizeIdentifier upper str =
    case Str.charAt 0 str of
    Nothing -> "Empty"
    Just s ->
        if isLetter s then
            Str.fromCharArray $ map (\c -> if isLetterCharacter c then c else '_') $ Str.toCharArray str
        else
            legalizeIdentifier upper ((if upper then "F_" else "f_") <> str)

lowerNameStyle :: String -> String
lowerNameStyle = camelCase >>> decapitalize >>> (legalizeIdentifier false)

upperNameStyle :: String -> String
upperNameStyle = camelCase >>> capitalize >>> (legalizeIdentifier true)

renderComment :: Maybe String -> String
renderComment (Just s) = " -- " <> s
renderComment Nothing = ""

elmDoc :: Doc Unit
elmDoc = do
    line """module QuickType exposing (Root, root)

import Json.Decode as Jdec
import Json.Decode.Pipeline as Jpipe
import Array exposing (Array)
import Dict exposing (Dict)
"""
    topLevel <- getTopLevel
    { rendered: topLevelRendered, comment: topLevelComment } <- typeStringForType topLevel
    line $ "type alias Root = " <> topLevelRendered <> renderComment topLevelComment
    blank
    line "root : Jdec.Decoder Root"
    rootDecoder <- decoderNameForType topLevel
    line $ "root = " <> rootDecoder
    blank
    classes <- getClasses
    for_ classes \(Tuple i cls) -> do
        renderTypeDefinition i cls
        blank
    unions <- getUnions
    for_ unions \types -> do
        blank
        renderUnionDefinition types

noComment :: String -> Doc { rendered :: String, comment :: Maybe String }
noComment rendered =
    pure { rendered, comment: Nothing }

typeStringForUnion :: Set IRType -> Doc { rendered :: String, comment :: Maybe String }
typeStringForUnion s =
    case nullableFromSet s of
    Just x -> do
        { rendered, comment } <- typeStringForType x
        pure { rendered: "(Maybe " <> rendered <> ")", comment: Just $ maybe "optional" ("optional " <> _) comment }
    Nothing -> do
        noComment =<< lookupUnionName s

typeStringForType :: IRType -> Doc { rendered :: String, comment :: Maybe String }
typeStringForType = case _ of
    IRNothing -> noComment "Jdec.Value"
    IRNull -> noComment "()"
    IRInteger -> noComment "Int"
    IRDouble -> noComment "Float"
    IRBool -> noComment "Bool"
    IRString -> noComment "String"
    IRArray a -> do
        { rendered, comment } <- typeStringForType a
        pure { rendered: "(Array " <> rendered <> ")", comment: map ("array of " <> _) comment }
    IRClass i -> noComment =<< lookupClassName i
    IRMap t -> do
        { rendered, comment } <- typeStringForType t
        pure { rendered: "(Dict String " <> rendered <> ")", comment: map ("map to " <> _) comment }
    IRUnion types -> typeStringForUnion $ unionToSet types

lookupClassDecoderName :: Int -> Doc String
lookupClassDecoderName i = decapitalize <$> lookupClassName i

lookupUnionDecoderName :: Set IRType -> Doc String
lookupUnionDecoderName s = decapitalize <$> lookupUnionName s

unionConstructorName :: Set IRType -> IRType -> Doc String
unionConstructorName s t = do
    typeName <- upperNameStyle <$> getTypeNameForUnion t
    unionName <- lookupUnionName s
    pure $ typeName <> "In" <> unionName

decoderNameForType :: IRType -> Doc String
decoderNameForType = case _ of
    IRNothing -> pure "Jdec.value"
    IRNull -> pure "(Jdec.null ())"
    IRInteger -> pure "Jdec.int"
    IRDouble -> pure "Jdec.float"
    IRBool -> pure "Jdec.bool"
    IRString -> pure "Jdec.string"
    IRArray a -> do
        rendered <- decoderNameForType a
        pure $ "(Jdec.array " <> rendered <> ")"
    IRClass i -> lookupClassDecoderName i
    IRMap t -> do
        rendered <- decoderNameForType t
        pure $ "(Jdec.dict " <> rendered <> ")"
    IRUnion types ->
        case nullableFromSet $ unionToSet types of
        Just t -> do
            rendered <- decoderNameForType t
            pure $ "(Jdec.nullable " <> rendered <> ")"
        Nothing -> do
            lookupUnionDecoderName $ unionToSet types

forWithPrefix_ :: forall a b p m. Applicative m => List a -> p -> p -> (p -> a -> m b) -> m Unit
forWithPrefix_ l firstPrefix restPrefix f =
    forEnumerated_ l (\i -> f $ if i == 0 then firstPrefix else restPrefix)

isOptional :: IRType -> Boolean
isOptional = case _ of
    IRUnion u ->
        case nullableFromSet $ unionToSet u of
        Just t -> true
        Nothing -> false
    -- IRNull -> true
    -- IRUnion u -> S.member IRNull $ unionToSet u
    _ -> false

renderTypeDefinition :: Int -> IRClassData -> Doc Unit
renderTypeDefinition classIndex (IRClassData { names, properties }) = do
    className <- lookupClassName classIndex
    let propertyNames = transformNames lowerNameStyle (\n -> "other" <> capitalize n) forbiddenPropertyNames $ map (\n -> Tuple n n) $ Map.keys properties
    let propsList = Map.toUnfoldable properties # sortByKey (\t -> lookupName (fst t) propertyNames)
    line $ "type alias " <> className <> " ="
    indent do
        forWithPrefix_ propsList "{ " ", " \braceOrComma (Tuple pname ptype) -> do
            let propName = lookupName pname propertyNames
            { rendered, comment } <- typeStringForType ptype
            line $ braceOrComma <> propName <> " : " <> rendered <> renderComment comment
        when (propsList == L.Nil) do
            line "{"
        line "}"
    blank
    decoderName <- lookupClassDecoderName classIndex
    line $ decoderName <> " : Jdec.Decoder " <> className
    line $ decoderName <> " ="
    indent do
        line $ "Jpipe.decode " <> className
        for_ propsList \(Tuple pname ptype) -> do
            indent do
                decoderName <- decoderNameForType ptype
                let { reqOrOpt, fallback } = if isOptional ptype then { reqOrOpt: "Jpipe.optional", fallback: " Nothing" } else { reqOrOpt: "Jpipe.required", fallback: "" }
                line $ "|> " <> reqOrOpt <> " \"" <> stringEscape pname <> "\" " <> decoderName <> fallback

renderUnionDefinition :: Set IRType -> Doc Unit
renderUnionDefinition allTypes = do
    name <- lookupUnionName allTypes
    fields <- L.fromFoldable allTypes # sortByKeyM (unionConstructorName allTypes)
    line $ "type " <> name
    forWithPrefix_ fields "=" "|" \equalsOrPipe t -> do
        indent do
            constructor <- unionConstructorName allTypes t
            when (t == IRNull) do
                line $ equalsOrPipe <> " " <> constructor
            unless (t == IRNull) do
                { rendered, comment } <- typeStringForType t
                line $ equalsOrPipe <> " " <> constructor <> " " <> rendered <> renderComment comment
    blank
    decoderName <- lookupUnionDecoderName allTypes
    line $ decoderName <> " : Jdec.Decoder " <> name
    line $ decoderName <> " ="
    indent do
        line "Jdec.oneOf"
        indent do
            forWithPrefix_ fields "[" "," \bracketOrComma t -> do
                constructor <- unionConstructorName allTypes t
                when (t == IRNull) do
                    line $ bracketOrComma <> " Jdec.null " <> constructor
                unless (t == IRNull) do
                    decoder <- decoderNameForType t
                    line $ bracketOrComma <> " Jdec.map " <> constructor <> " " <> decoder
            line "]"