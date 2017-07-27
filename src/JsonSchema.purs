module JsonSchema where

import Doc
import IRGraph
import Prelude
import Utils

import Data.Argonaut.Core (Json, fromArray, fromBoolean, fromObject, fromString, stringifyWithSpace)
import Data.Array as A
import Data.Foldable (intercalate)
import Data.List (List)
import Data.List as L
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.String.Util (camelCase, capitalize)
import Data.Tuple (Tuple(..))

forbiddenNames :: Array String
forbiddenNames = []

renderer :: Renderer
renderer =
    { name: "JSON Schema"
    , aceMode: "json"
    , extension: "json"
    , doc: jsonSchemaDoc
    , transforms:
        { nameForClass
        , unionName: Nothing
        , unionPredicate: Nothing
        , nextName: \s -> "Other" <> s
        , forbiddenNames
        }
    }

jsonNameStyle :: String -> String
jsonNameStyle =
    camelCase >>> capitalize

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = jsonNameStyle $ combineNames names

unionName :: List String -> String
unionName s =
    L.sort s
    <#> jsonNameStyle
    # intercalate "Or"

typeStrMap :: String -> Doc (StrMap Json)
typeStrMap s = pure $ SM.insert "type" (fromString s) SM.empty

strMapForType :: IRType -> Doc (StrMap Json)
strMapForType t =
    case t of
    IRNothing -> pure SM.empty
    IRNull -> typeStrMap "null"
    IRInteger -> typeStrMap "integer"
    IRDouble -> typeStrMap "number"
    IRBool -> typeStrMap "boolean"
    IRString -> typeStrMap "string"
    IRArray a -> do
        itemType <- strMapForType a
        sm <- typeStrMap "array"
        pure $ SM.insert "items" (fromObject itemType) sm
    IRClass i -> do
        name <- lookupClassName i
        pure $ SM.insert "$ref" (fromString $ "#/definitions/" <> name) SM.empty
    IRMap m -> do
        propertyType <- strMapForType m
        sm <- typeStrMap "object"
        pure $ SM.insert "additionalProperties" (fromObject propertyType) sm
    IRUnion ur -> do
        types <- mapM strMapForType $ L.fromFoldable $ unionToSet ur
        let typesJson = fromArray $ A.fromFoldable $ map fromObject types
        pure $ SM.insert "oneOf" typesJson SM.empty

definitionForClass :: Tuple Int IRClassData -> Doc (Tuple String Json)
definitionForClass (Tuple i (IRClassData { properties })) = do
    className <- lookupClassName i
    let sm = SM.insert "additionalProperties" (fromBoolean false) $ SM.insert "type" (fromString "object") SM.empty
    propsMap <- mapMapM (\_ -> strMapForType) properties
    let requiredProps = A.fromFoldable $ map fromString $ M.keys $ M.filter (\t -> not $ canBeNull t) properties
    let propsSM = SM.fromFoldable $ (M.toUnfoldable (map fromObject propsMap) :: List _)
    pure $ Tuple className (fromObject $ SM.insert "required" (fromArray requiredProps) $ SM.insert "properties" (fromObject propsSM) sm)

irToJson :: Doc Json
irToJson = do
    classes <- getClasses
    definitions <- fromObject <$> SM.fromFoldable <$> mapM definitionForClass classes
    topLevel <- strMapForType =<< getTopLevel
    let sm = SM.insert "definitions" definitions topLevel
    pure $ fromObject sm

jsonSchemaDoc :: Doc Unit
jsonSchemaDoc = do
    json <- irToJson
    line $ stringifyWithSpace "    " json
